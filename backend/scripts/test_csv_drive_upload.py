#!/usr/bin/env python3
"""
test_csv_drive_upload.py
========================
Standalone test script: Supabase attendance data → CSV in memory → Google Drive upload.

This script does NOT require the FastAPI server to be running.
It validates the full data → CSV → Drive pipeline end to end.

Usage
-----
1. Copy backend/.env.example to backend/.env and fill in real values.
2. Install deps:
       pip install -r requirements.txt
3. Run:
       cd backend
       python scripts/test_csv_drive_upload.py --event-id <supabase-event-uuid>

   Or without a real Supabase project (uses built-in mock data):
       python scripts/test_csv_drive_upload.py --mock

Outputs
-------
- Prints progress to stdout.
- Uploads a CSV file to the Drive folder configured in GOOGLE_DRIVE_ROOT_FOLDER_ID.
- Prints the uploaded file's web link on success.

Security notes
--------------
- SUPABASE_SERVICE_ROLE_KEY and Google credentials must NEVER go into the mobile app.
- This script reads from backend/.env which must never be committed.
- No participant PII is logged — only counts and IDs.
"""

import argparse
import csv
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Load .env from backend/ directory (one level up from scripts/)
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed. Run: pip install -r requirements.txt")
    sys.exit(1)

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"

if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
    print(f"[env] Loaded {ENV_FILE}")
else:
    print(f"[env] WARNING: {ENV_FILE} not found. Using environment variables only.")
    print(f"      Copy backend/.env.example to backend/.env and fill in your credentials.")


# ---------------------------------------------------------------------------
# Mock data — used when --mock flag is passed or Supabase is not configured
# ---------------------------------------------------------------------------
MOCK_ROWS = [
    {
        "record_id": "rec-001",
        "participant_name": "Juan Dela Cruz",
        "student_id": "2023104921",
        "email": "juan@example.com",
        "year_level": 2,
        "method": "qr",
        "recorded_at": "2026-08-26T08:15:00+00:00",
        "recorded_by": "Wayne Admin",
        "event_name": "ICPEP Regional Convention 2026",
        "event_date": "2026-08-26",
    },
    {
        "record_id": "rec-002",
        "participant_name": "Maria Santos",
        "student_id": "2022884912",
        "email": "maria@example.com",
        "year_level": 3,
        "method": "qr",
        "recorded_at": "2026-08-26T08:22:00+00:00",
        "recorded_by": "Wayne Admin",
        "event_name": "ICPEP Regional Convention 2026",
        "event_date": "2026-08-26",
    },
    {
        "record_id": "rec-003",
        "participant_name": "Carlos Reyes",
        "student_id": "2024551023",
        "email": None,
        "year_level": 1,
        "method": "manual",
        "recorded_at": "2026-08-26T08:30:00+00:00",
        "recorded_by": "Alex Organizer",
        "event_name": "ICPEP Regional Convention 2026",
        "event_date": "2026-08-26",
    },
    {
        "record_id": "rec-004",
        "participant_name": "Ana Torres",
        "student_id": "2021441824",
        "email": "ana@example.com",
        "year_level": 4,
        "method": "qr",
        "recorded_at": "2026-08-26T09:01:00+00:00",
        "recorded_by": "Wayne Admin",
        "event_name": "ICPEP Regional Convention 2026",
        "event_date": "2026-08-26",
    },
    {
        "record_id": "rec-005",
        "participant_name": "Rico Gomez",
        "student_id": None,
        "email": None,
        "year_level": None,
        "method": "manual",
        "recorded_at": "2026-08-26T09:10:00+00:00",
        "recorded_by": "Maria Volunteer",
        "event_name": "ICPEP Regional Convention 2026",
        "event_date": "2026-08-26",
    },
]

CSV_FIELDNAMES = [
    "record_id",
    "participant_name",
    "student_id",
    "program_course",
    "year_level",
    "method",
    "recorded_at",
    "recorded_by",
    "event_name",
    "event_date",
]


# ---------------------------------------------------------------------------
# Step 1: Fetch attendance records from Supabase
# ---------------------------------------------------------------------------
def fetch_from_supabase(event_id: str) -> list[dict]:
    """
    Query attendance_records joined with participants, events, and profiles.
    Uses the service role key — this bypasses RLS but is safe because:
    - This script runs on the backend only.
    - A real FastAPI endpoint would additionally verify the caller's role first.
    """
    try:
        from supabase import create_client
    except ImportError:
        print("ERROR: supabase-py not installed. Run: pip install -r requirements.txt")
        sys.exit(1)

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key or "replace-me" in (url + key):
        print("ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured in backend/.env")
        print("       Run with --mock to test with built-in sample data instead.")
        sys.exit(1)

    print(f"[supabase] Connecting to {url}")
    client = create_client(url, key)

    print(f"[supabase] Querying attendance for event: {event_id}")

    # Join attendance_records → participants → profiles for recorded_by name.
    # Note: Supabase JS-style select syntax for nested joins.
    response = (
        client.table("attendance_records")
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

    rows = response.data
    print(f"[supabase] Fetched {len(rows)} attendance records.")

    # Flatten the nested join response into flat dicts.
    flat = []
    for r in rows:
        event_starts = r.get("event", {}) or {}
        participant = r.get("participant", {}) or {}
        recorder = r.get("recorder", {}) or {}

        event_date_raw = event_starts.get("starts_at", "")
        try:
            event_date = datetime.fromisoformat(event_date_raw).strftime("%Y-%m-%d") if event_date_raw else ""
        except ValueError:
            event_date = event_date_raw

        flat.append({
            "record_id": r.get("id", ""),
            "participant_name": participant.get("display_name", ""),
            "student_id": participant.get("external_reference") or "",
            "email": participant.get("email") or "",
            "year_level": r.get("year_level") or "",
            "method": r.get("method", ""),
            "recorded_at": r.get("recorded_at", ""),
            "recorded_by": recorder.get("full_name", ""),
            "event_name": event_starts.get("name", ""),
            "event_date": event_date,
        })

    return flat


# ---------------------------------------------------------------------------
# Step 2: Build CSV bytes in memory
# ---------------------------------------------------------------------------
def build_csv(rows: list[dict]) -> bytes:
    """
    Converts flat attendance row dicts to UTF-8 CSV bytes.
    Returns bytes suitable for direct Drive upload or file writing.
    """
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=CSV_FIELDNAMES,
        extrasaction="ignore",
        lineterminator="\r\n",  # RFC 4180 line endings
    )
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8-sig")  # UTF-8 BOM for Excel compatibility


# ---------------------------------------------------------------------------
# Step 3: Upload CSV to Google Drive
# ---------------------------------------------------------------------------
def get_drive_service():
    """
    Returns an authenticated Google Drive API service.
    Supports both oauth_user and service_account auth modes,
    as configured in backend/.env.
    """
    try:
        from google.oauth2 import service_account
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import Flow
        from googleapiclient.discovery import build
        import google.auth.transport.requests
    except ImportError:
        print("ERROR: google-api-python-client not installed. Run: pip install -r requirements.txt")
        sys.exit(1)

    auth_mode = os.environ.get("GOOGLE_DRIVE_AUTH_MODE", "oauth_user")
    print(f"[drive] Auth mode: {auth_mode}")

    SCOPES = ["https://www.googleapis.com/auth/drive.file"]

    if auth_mode == "service_account":
        sa_json_raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
        if not sa_json_raw or "replace-me" in sa_json_raw:
            print("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON not set in backend/.env")
            print("       Set it to the full service account JSON as a single-line string.")
            sys.exit(1)
        try:
            sa_info = json.loads(sa_json_raw)
        except json.JSONDecodeError as exc:
            print(f"ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {exc}")
            sys.exit(1)
        creds = service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)

    else:  # oauth_user
        client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
        refresh_token = os.environ.get("GOOGLE_OAUTH_REFRESH_TOKEN", "")

        if not client_id or not client_secret or not refresh_token or "replace-me" in (client_id + client_secret + refresh_token):
            print("ERROR: Google OAuth credentials not configured in backend/.env")
            print("       Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN.")
            print("\nTo get a refresh token:")
            print("  1. Create OAuth 2.0 credentials in Google Cloud Console (type: Desktop app).")
            print("  2. Download the JSON and run:")
            print("       python scripts/get_oauth_token.py")
            sys.exit(1)

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES,
        )
        # Refresh the access token now so failures surface early.
        request = google.auth.transport.requests.Request()
        creds.refresh(request)

    from googleapiclient.discovery import build
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return service


def ensure_event_folder(service, root_folder_id: str, event_name: str, event_date: str) -> str:
    """
    Looks for an existing subfolder named '<event_date> - <event_name>' inside
    root_folder_id. Creates it if it doesn't exist. Returns the folder ID.

    Uses Drive appProperties to identify folders by event_name rather than
    relying on display names alone (avoids duplicates on rename).
    """
    safe_name = f"{event_date} - {event_name}" if event_date else event_name

    # Search for an existing folder with the same name in the root folder.
    query = (
        f"'{root_folder_id}' in parents"
        f" and mimeType = 'application/vnd.google-apps.folder'"
        f" and name = '{safe_name.replace(chr(39), chr(39)+chr(39))}'"
        f" and trashed = false"
    )
    result = service.files().list(
        q=query,
        fields="files(id, name)",
        spaces="drive",
    ).execute()

    existing = result.get("files", [])
    if existing:
        folder_id = existing[0]["id"]
        print(f"[drive] Re-using existing event folder: {safe_name} ({folder_id})")
        return folder_id

    # Create new folder.
    folder_meta = {
        "name": safe_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [root_folder_id],
    }
    folder = service.files().create(body=folder_meta, fields="id").execute()
    folder_id = folder["id"]
    print(f"[drive] Created event folder: {safe_name} ({folder_id})")
    return folder_id


def upload_csv_to_drive(service, csv_bytes: bytes, filename: str, folder_id: str) -> dict:
    """
    Uploads csv_bytes as a new file in folder_id.
    If a file with the same name already exists in that folder, it is updated
    (idempotent — same export job re-run produces the same file, not a duplicate).
    Returns the Drive file metadata dict with 'id' and 'webViewLink'.
    """
    from googleapiclient.http import MediaIoBaseUpload

    mime_type = "text/csv"

    # Check for existing file with same name.
    query = (
        f"'{folder_id}' in parents"
        f" and name = '{filename}'"
        f" and trashed = false"
    )
    result = service.files().list(q=query, fields="files(id, name)").execute()
    existing = result.get("files", [])

    media = MediaIoBaseUpload(io.BytesIO(csv_bytes), mimetype=mime_type, resumable=False)

    if existing:
        file_id = existing[0]["id"]
        print(f"[drive] Updating existing file: {filename} ({file_id})")
        updated = service.files().update(
            fileId=file_id,
            media_body=media,
            fields="id, name, webViewLink, size",
        ).execute()
        return updated
    else:
        print(f"[drive] Uploading new file: {filename}")
        file_meta = {
            "name": filename,
            "parents": [folder_id],
        }
        uploaded = service.files().create(
            body=file_meta,
            media_body=media,
            fields="id, name, webViewLink, size",
        ).execute()
        return uploaded


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Test: Supabase attendance → CSV → Google Drive upload"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--event-id", metavar="UUID", help="Supabase event UUID to export")
    group.add_argument("--mock", action="store_true", help="Use built-in mock data (no Supabase needed)")
    parser.add_argument("--out", metavar="PATH", help="Also save CSV to a local file path (optional)")
    parser.add_argument("--skip-drive", action="store_true", help="Generate CSV but skip Drive upload (dry run)")
    args = parser.parse_args()

    print("=" * 60)
    print("  ScanSync — CSV → Google Drive Upload Test")
    print("=" * 60)

    # ── Step 1: Get attendance rows ──────────────────────────────────────
    if args.mock:
        print("\n[step 1/3] Using built-in mock attendance data.")
        rows = MOCK_ROWS
        event_label = "ICPEP Regional Convention 2026"
        event_date_label = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    else:
        print(f"\n[step 1/3] Fetching attendance from Supabase (event: {args.event_id})")
        rows = fetch_from_supabase(args.event_id)
        if not rows:
            print("WARNING: No attendance records found for this event. Nothing to export.")
            sys.exit(0)
        event_label = rows[0].get("event_name", "Event")
        event_date_label = rows[0].get("event_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    print(f"         → {len(rows)} record(s) ready for export.")

    # ── Step 2: Build CSV ────────────────────────────────────────────────
    print("\n[step 2/3] Building CSV...")
    csv_bytes = build_csv(rows)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{event_label} - Attendance - {timestamp}.csv"
    print(f"         → {len(csv_bytes):,} bytes | {len(rows)} data rows | filename: {filename}")

    # Optionally save locally.
    if args.out:
        out_path = Path(args.out)
        out_path.write_bytes(csv_bytes)
        print(f"         → Saved locally to: {out_path.resolve()}")

    # ── Step 3: Upload to Drive ──────────────────────────────────────────
    if args.skip_drive:
        print("\n[step 3/3] --skip-drive flag set. Skipping Drive upload.")
        print("\n✅ Dry run complete. CSV generated successfully.")
        return

    root_folder_id = os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID", "")
    if not root_folder_id or "replace-me" in root_folder_id:
        print("\nERROR: GOOGLE_DRIVE_ROOT_FOLDER_ID not set in backend/.env")
        print("       The known root folder ID is: 1jBU2Jg_XbnvW2M4mPL7Rv3S5UEeoKFu8")
        print("       Add it to backend/.env: GOOGLE_DRIVE_ROOT_FOLDER_ID=1jBU2Jg_XbnvW2M4mPL7Rv3S5UEeoKFu8")
        sys.exit(1)

    print(f"\n[step 3/3] Uploading to Google Drive (root: {root_folder_id})")
    service = get_drive_service()

    # Resolve or create the event subfolder.
    folder_id = ensure_event_folder(service, root_folder_id, event_label, event_date_label)

    # Upload the CSV (idempotent — updates existing file if same name exists).
    file_info = upload_csv_to_drive(service, csv_bytes, filename, folder_id)

    print()
    print("=" * 60)
    print("  ✅ UPLOAD SUCCESSFUL")
    print("=" * 60)
    print(f"  File name   : {file_info.get('name')}")
    print(f"  Drive ID    : {file_info.get('id')}")
    print(f"  Size        : {int(file_info.get('size', 0)):,} bytes")
    print(f"  Web link    : {file_info.get('webViewLink', 'N/A')}")
    print(f"  Event folder: https://drive.google.com/drive/folders/{folder_id}")
    print("=" * 60)


if __name__ == "__main__":
    main()
