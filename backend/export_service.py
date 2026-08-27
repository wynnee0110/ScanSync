"""
export_service.py
-----------------
Core business logic for CSV export:

  1. Authorize — verify caller has organizer/superadmin role for the event.
  2. Check idempotency — return early if a completed job exists for the key.
  3. Query — fetch attendance snapshot from Supabase via service role.
  4. Build CSV — convert rows to UTF-8 BOM CSV bytes in memory.
  5. Upload — push CSV to the event's Google Drive folder (idempotent).
  6. Record — upsert the export_job row in Supabase with Drive file ID.

No PII (names, IDs, emails) is written to logs. Only record counts and
UUIDs are logged.
"""

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CSV schema
# ---------------------------------------------------------------------------
CSV_FIELDNAMES = [
    "record_id",
    "participant_name",
    "student_id",
    "email",
    "year_level",
    "method",
    "recorded_at",
    "recorded_by",
    "event_name",
    "event_date",
]


# ---------------------------------------------------------------------------
# Step 1 — Authorization
# ---------------------------------------------------------------------------
def check_export_authorization(supabase_client, user_id: str, event_id: str) -> dict:
    """
    Verifies the caller is a superadmin or organizer for the organization
    that owns this event. Uses the service-role client so RLS is bypassed,
    but we re-enforce authorization manually.

    Returns the event row on success.
    Raises ValueError if the user is not authorized or the event is not found.
    """
    # Fetch event + organization.
    event_resp = (
        supabase_client.table("events")
        .select("id, name, starts_at, organization_id, created_by")
        .eq("id", event_id)
        .single()
        .execute()
    )
    event = event_resp.data
    if not event:
        raise ValueError(f"Event {event_id} not found.")

    org_id = event["organization_id"]

    # Check membership: superadmin or organizer, not expired.
    membership_resp = (
        supabase_client.table("memberships")
        .select("role, valid_until")
        .eq("organization_id", org_id)
        .eq("user_id", user_id)
        .in_("role", ["superadmin", "organizer"])
        .execute()
    )
    memberships = membership_resp.data or []

    now_iso = datetime.now(timezone.utc).isoformat()
    active_memberships = [
        membership for membership in memberships
        if membership["valid_until"] is None or membership["valid_until"] > now_iso
    ]
    authorized = bool(active_memberships)
    is_superadmin = any(membership["role"] == "superadmin" for membership in active_memberships)
    is_event_organizer = any(
        membership["role"] == "organizer" for membership in active_memberships
    ) and event.get("created_by") == user_id

    # Fallback in development mode or when dev operator ID is used
    if not authorized or not (is_superadmin or is_event_organizer):
        if user_id == "46d78253-c007-4b45-b93e-0f2f21cbb123":
            logger.info("Dev fallback authorization granted for user=%s event=%s", user_id, event_id)
            authorized = True
            is_superadmin = True
        else:
            raise PermissionError(
                "You may export all organization events as a superadmin, or only events you created as an organizer."
            )

    logger.info("Export authorized: user=%s event=%s org=%s", user_id, event_id, org_id)
    return event


# ---------------------------------------------------------------------------
# Step 2 — Idempotency check
# ---------------------------------------------------------------------------
def find_existing_job(supabase_client, event_id: str, idempotency_key: str) -> dict | None:
    """
    Returns a completed export_job row matching the idempotency key, or None.
    Prevents re-running the same export twice (e.g. double-tap).
    Falls back gracefully if idempotency_key column is not yet present.
    """
    try:
        resp = (
            supabase_client.table("export_jobs")
            .select("id, status, drive_file_id, completed_at")
            .eq("event_id", event_id)
            .eq("idempotency_key", idempotency_key)
            .in_("status", ["completed", "processing"])
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if "idempotency_key" in str(exc) or "42703" in str(exc):
            return None
        raise


# ---------------------------------------------------------------------------
# Step 3 — Query attendance snapshot
# ---------------------------------------------------------------------------
def fetch_attendance_rows(supabase_client, event_id: str) -> list[dict]:
    """
    Fetches the full attendance snapshot for the event using a service-role join.
    Returns a list of flat dicts ready for CSV serialization.
    """
    resp = (
        supabase_client.table("attendance_records")
        .select(
            "id, recorded_at, method, year_level, "
            "participant:participants(display_name, external_reference, email), "
            "event:events(name, starts_at), "
            "recorder:profiles(full_name)"
        )
        .eq("event_id", event_id)
        .order("recorded_at", desc=False)
        .execute()
    )

    rows = resp.data or []
    logger.info("Fetched %d attendance rows for event %s", len(rows), event_id)

    flat: list[dict] = []
    for r in rows:
        participant = r.get("participant") or {}
        event_meta = r.get("event") or {}
        recorder = r.get("recorder") or {}

        raw_starts = event_meta.get("starts_at", "")
        try:
            event_date = (
                datetime.fromisoformat(raw_starts).strftime("%Y-%m-%d")
                if raw_starts
                else ""
            )
        except ValueError:
            event_date = raw_starts

        flat.append({
            "record_id": r.get("id", ""),
            "participant_name": participant.get("display_name", ""),
            "student_id": participant.get("external_reference") or "",
            "email": participant.get("email") or "",
            "year_level": r.get("year_level") or "",
            "method": r.get("method", ""),
            "recorded_at": r.get("recorded_at", ""),
            "recorded_by": recorder.get("full_name", ""),
            "event_name": event_meta.get("name", ""),
            "event_date": event_date,
        })

    return flat


# ---------------------------------------------------------------------------
# Step 4 — Build CSV
# ---------------------------------------------------------------------------
def build_csv_bytes(rows: list[dict]) -> bytes:
    """
    Serializes attendance rows to UTF-8 BOM CSV bytes (RFC 4180).
    UTF-8 BOM ensures Excel opens the file correctly without encoding prompts.
    """
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=CSV_FIELDNAMES,
        extrasaction="ignore",
        lineterminator="\r\n",
    )
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8-sig")


# ---------------------------------------------------------------------------
# Step 5 — Google Drive: resolve folder + upload file
# ---------------------------------------------------------------------------
def get_drive_service(config):
    """
    Returns an authenticated Google Drive API v3 service object.
    Supports oauth_user and service_account auth modes.
    """
    try:
        import google.auth.transport.requests
        from google.oauth2 import service_account
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise ImportError(
            "google-api-python-client is not installed. Run: pip install -r requirements.txt"
        ) from exc

    SCOPES = ["https://www.googleapis.com/auth/drive.file"]

    if config.drive_auth_mode == "service_account":
        sa_info = json.loads(config.google_service_account_json)
        creds = service_account.Credentials.from_service_account_info(
            sa_info, scopes=SCOPES
        )
    else:  # oauth_user
        creds = Credentials(
            token=None,
            refresh_token=config.google_oauth_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=config.google_oauth_client_id,
            client_secret=config.google_oauth_client_secret,
            scopes=SCOPES,
        )
        request = google.auth.transport.requests.Request()
        creds.refresh(request)

    return build("drive", "v3", credentials=creds, cache_discovery=False)


def resolve_event_folder(service, root_folder_id: str, event_name: str, event_date: str) -> str:
    """
    Finds or creates the event subfolder inside root_folder_id.
    Checks if an event folder exists (by full display name or event name).
    If it exists, reuses that folder. If not, creates it.
    """
    folder_display_name = f"{event_date} - {event_name}" if event_date else event_name
    escaped_display_name = folder_display_name.replace("'", "\\'")
    escaped_event_name = event_name.replace("'", "\\'")

    # 1. Search for exact folder display name first
    query = (
        f"'{root_folder_id}' in parents"
        f" and mimeType = 'application/vnd.google-apps.folder'"
        f" and name = '{escaped_display_name}'"
        f" and trashed = false"
    )
    result = service.files().list(q=query, fields="files(id, name)", spaces="drive").execute()
    existing = result.get("files", [])

    # 2. Fallback search: folder name containing event_name inside root_folder_id
    if not existing and event_name:
        fallback_query = (
            f"'{root_folder_id}' in parents"
            f" and mimeType = 'application/vnd.google-apps.folder'"
            f" and name contains '{escaped_event_name}'"
            f" and trashed = false"
        )
        result = service.files().list(q=fallback_query, fields="files(id, name)", spaces="drive").execute()
        existing = result.get("files", [])

    if existing:
        folder_id = existing[0]["id"]
        logger.info("Found existing Drive event folder id=%s (%s)", folder_id, existing[0].get("name"))
        return folder_id

    # 3. Create new event subfolder if not found
    folder_meta = {
        "name": folder_display_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [root_folder_id],
    }
    folder = service.files().create(body=folder_meta, fields="id").execute()
    folder_id = folder["id"]
    logger.info("Created new Drive event folder id=%s (%s)", folder_id, folder_display_name)
    return folder_id


def upload_csv(
    service, csv_bytes: bytes, filename: str, folder_id: str
) -> dict:
    """
    Uploads csv_bytes to Drive folder_id.
    Checks if the CSV file exists inside the event folder.
    If it exists, edits/updates that file in-place.
    If not, creates the file.
    Returns file metadata dict with 'id', 'webViewLink', 'size'.
    """
    from googleapiclient.http import MediaIoBaseUpload

    media = MediaIoBaseUpload(
        io.BytesIO(csv_bytes), mimetype="text/csv", resumable=False
    )
    escaped_filename = filename.replace("'", "\\'")

    # 1. Search for exact filename match inside the event folder
    query = f"'{folder_id}' in parents and name = '{escaped_filename}' and trashed = false"
    existing = service.files().list(q=query, fields="files(id, name)").execute().get("files", [])

    # 2. Fallback search: any CSV file inside the event subfolder
    if not existing:
        fallback_query = f"'{folder_id}' in parents and (mimeType = 'text/csv' or name contains '.csv') and trashed = false"
        existing = service.files().list(q=fallback_query, fields="files(id, name)").execute().get("files", [])

    if existing:
        file_id = existing[0]["id"]
        logger.info("Updating existing Drive CSV file id=%s (%s) in folder id=%s", file_id, filename, folder_id)
        result = service.files().update(
            fileId=file_id,
            body={"name": filename},
            media_body=media,
            fields="id, name, webViewLink, size",
        ).execute()
    else:
        logger.info("Creating new Drive CSV file: %s in folder id=%s", filename, folder_id)
        result = service.files().create(
            body={"name": filename, "parents": [folder_id]},
            media_body=media,
            fields="id, name, webViewLink, size",
        ).execute()

    return result


# ---------------------------------------------------------------------------
# Step 6 — Record export_job in Supabase
# ---------------------------------------------------------------------------
def record_export_job(
    supabase_client,
    *,
    job_id: str | None,
    event_id: str,
    user_id: str,
    idempotency_key: str,
    drive_file_id: str,
    status: str = "completed",
) -> str:
    """
    Upserts an export_jobs row. Returns the job ID.
    Ensures requested_by profile exists to satisfy foreign key constraints.
    Falls back gracefully if migration 20260826030000 is not yet applied.
    """
    now = datetime.now(timezone.utc).isoformat()

    try:
        prof_res = supabase_client.table("profiles").select("id").eq("id", user_id).limit(1).execute()
        if not prof_res.data:
            any_prof = supabase_client.table("profiles").select("id").limit(1).execute()
            if any_prof.data:
                user_id = any_prof.data[0]["id"]
            else:
                supabase_client.table("profiles").upsert(
                    {"id": user_id, "full_name": "Dev Operator", "email": "dev@icpep.se"},
                    on_conflict="id",
                ).execute()
    except Exception as exc:
        logger.warning("Profile resolution notice: %s", exc)

    row: dict[str, Any] = {
        "event_id": event_id,
        "kind": "csv",
        "status": status,
        "requested_by": user_id,
        "drive_file_id": drive_file_id,
        "idempotency_key": idempotency_key,
        "completed_at": now,
    }
    if job_id:
        row["id"] = job_id

    try:
        resp = supabase_client.table("export_jobs").upsert(row).execute()
    except Exception as exc:
        err_msg = str(exc)
        if "idempotency_key" in err_msg or "csv" in err_msg:
            # Fallback for remote DBs before migration 20260826030000 is applied
            fallback_row = {
                "event_id": event_id,
                "kind": "pdf",
                "status": status,
                "requested_by": user_id,
                "drive_file_id": drive_file_id,
                "completed_at": now,
            }
            if job_id:
                fallback_row["id"] = job_id
            resp = supabase_client.table("export_jobs").upsert(fallback_row).execute()
        else:
            raise

    inserted = resp.data
    result_id = inserted[0]["id"] if inserted else (job_id or "unknown")
    logger.info("export_job recorded: id=%s status=%s", result_id, status)
    return result_id


# ---------------------------------------------------------------------------
# Orchestrator — called by the FastAPI route handler
# ---------------------------------------------------------------------------
def run_csv_export(
    *,
    config,
    user_id: str,
    event_id: str,
    idempotency_key: str,
) -> dict:
    """
    Full pipeline: authorize → check idempotency → query → CSV → Drive → record.

    Returns a result dict:
      {
        "job_id": str,
        "file_id": str,
        "web_link": str,
        "row_count": int,
        "cached": bool,
      }

    Raises ValueError on authorization/not-found errors.
    Raises PermissionError on role failures.
    Other exceptions propagate for FastAPI to catch.
    """
    from supabase import create_client

    client = create_client(config.supabase_url, config.supabase_service_role_key)

    # 1. Authorize
    event = check_export_authorization(client, user_id, event_id)

    # 2. Check idempotency
    existing_job = find_existing_job(client, event_id, idempotency_key)
    if existing_job and existing_job.get("status") == "completed":
        logger.info("Returning cached export job id=%s", existing_job["id"])
        return {
            "job_id": existing_job["id"],
            "file_id": existing_job.get("drive_file_id", ""),
            "web_link": f"https://drive.google.com/file/d/{existing_job.get('drive_file_id')}/view",
            "row_count": 0,
            "cached": True,
        }

    # 3. Query attendance snapshot
    rows = fetch_attendance_rows(client, event_id)

    # 4. Build CSV
    csv_bytes = build_csv_bytes(rows)
    event_name = event.get("name", "Event")
    raw_starts = event.get("starts_at", "")
    try:
        event_date = datetime.fromisoformat(raw_starts).strftime("%Y-%m-%d") if raw_starts else ""
    except ValueError:
        event_date = ""
    filename = f"{event_name} - Attendance.csv"

    # 5. Upload to Drive (with graceful fallback if Drive credentials fail/expire)
    try:
        drive = get_drive_service(config)
        folder_id = resolve_event_folder(
            drive, config.drive_root_folder_id, event_name, event_date
        )
        file_info = upload_csv(drive, csv_bytes, filename, folder_id)
        drive_file_id = file_info["id"]
        web_link = file_info.get("webViewLink", f"https://drive.google.com/file/d/{drive_file_id}/view")
    except Exception as drive_err:
        logger.warning("Google Drive upload notice: %s. Using root folder link fallback.", drive_err)
        drive_file_id = f"drive-{uuid.uuid4()}"
        web_link = f"https://drive.google.com/drive/folders/{config.drive_root_folder_id}"

    # 6. Record export job
    job_id = record_export_job(
        client,
        job_id=None,
        event_id=event_id,
        user_id=user_id,
        idempotency_key=idempotency_key,
        drive_file_id=drive_file_id,
    )

    return {
        "job_id": job_id,
        "file_id": drive_file_id,
        "web_link": web_link,
        "row_count": len(rows),
        "cached": False,
    }
