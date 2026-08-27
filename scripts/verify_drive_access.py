#!/usr/bin/env python3
"""
Attendance Manager -- Google Drive access verification.

Probes a Drive credential end to end and reports, per check, whether the backend
will actually be able to write report files. Supports both authorization models:

  --mode oauth            (default) Backend acts as a human account via a stored
                          refresh token. Works with personal/consumer Drive.
  --mode service_account  Backend acts as a GCP service account. Only viable
                          against a Google Workspace Shared Drive, because
                          service accounts have no storage quota of their own.

The decisive check is the write probe. A folder can report canAddChildren=true
and still reject every upload, because sharing permission and storage quota are
independent gates in Drive.

Usage (PowerShell, from the repository root):

  # OAuth mode -- reads credentials from the environment or backend/.env
  py .\\scripts\\verify_drive_access.py --mode oauth --create-root "Attendance Manager Reports"
  py .\\scripts\\verify_drive_access.py --mode oauth --folder-id "<id the app created>"

  # Service-account mode
  py .\\scripts\\verify_drive_access.py --mode service_account `
      --key-file ".\\key.json" --folder-id "<shared drive folder id>"

Only dependency: cryptography, and only for --mode service_account.
    py -m pip install --upgrade cryptography

Note on --mode oauth and folder IDs: the drive.file scope only reaches files and
folders this application created. Passing --folder-id for a folder made by hand
in the Drive UI returns 404 by design. Use --create-root once, record the ID it
prints as GOOGLE_DRIVE_ROOT_FOLDER_ID, and pass that afterwards.

Exit codes
  0  the credential can write into the target folder
  1  the write probe failed, or --no-write was used
  2  local configuration problem (missing file, missing credentials, bad args)
  3  could not mint an access token
  4  the Drive API is not enabled on the project
  5  the target folder is unusable
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

SCOPE_FULL = "https://www.googleapis.com/auth/drive"
SCOPE_FILE = "https://www.googleapis.com/auth/drive.file"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"

MODE_SA = "service_account"
MODE_OAUTH = "oauth"

PASS, FAIL, WARN, INFO = "PASS", "FAIL", "WARN", "INFO"

results: list[tuple[str, str, str]] = []


def record(status: str, check: str, detail: str = "") -> None:
    results.append((status, check, detail))
    print(f"  [{status}] {check}")
    for line in detail.splitlines():
        if line:
            print(f"         {line}")


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


class ApiError(Exception):
    def __init__(self, status_code: int, reason: str, message: str):
        self.status_code = status_code
        self.reason = reason
        self.message = message
        super().__init__(f"{status_code} {reason}: {message}")


def _parse_error(raw: str, code: int) -> ApiError:
    reason, message = "", raw[:400]
    try:
        payload = json.loads(raw).get("error", {})
        if isinstance(payload, str):  # OAuth-style error envelope
            return ApiError(code, payload, json.loads(raw).get("error_description", ""))
        message = payload.get("message", message)
        errors = payload.get("errors") or []
        if errors:
            reason = errors[0].get("reason", "")
    except (ValueError, AttributeError):
        pass
    return ApiError(code, reason, message)


def call(
    token: str,
    url: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if content_type:
        request.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raise _parse_error(exc.read().decode("utf-8", errors="replace"), exc.code) from None
    except urllib.error.URLError as exc:
        raise ApiError(0, "network", f"Could not reach Google: {exc.reason}") from None


def post_form(url: str, fields: dict[str, str]) -> dict[str, Any]:
    body = urllib.parse.urlencode(fields).encode("ascii")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise _parse_error(exc.read().decode("utf-8", errors="replace"), exc.code) from None
    except urllib.error.URLError as exc:
        raise ApiError(0, "network", f"Could not reach {url}: {exc.reason}") from None


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

def load_env_file(path: str) -> dict[str, str]:
    """Parse a KEY=VALUE .env file. Values are not unquoted beyond simple quotes."""
    values: dict[str, str] = {}
    if not os.path.isfile(path):
        return values
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def resolve_oauth_config(args: argparse.Namespace) -> tuple[str, str, str]:
    """Credentials come from the environment or backend/.env, never from argv.

    Passing a refresh token on the command line would leave a long-lived
    credential in shell history, so this script deliberately offers no flag
    for it.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    env_path = args.env_file or os.path.join(here, os.pardir, "backend", ".env")
    from_file = load_env_file(env_path)

    def pick(key: str) -> tuple[str, str]:
        if os.environ.get(key):
            return os.environ[key], "environment"
        if from_file.get(key):
            return from_file[key], os.path.relpath(env_path)
        return "", ""

    client_id, id_src = pick("GOOGLE_OAUTH_CLIENT_ID")
    client_secret, secret_src = pick("GOOGLE_OAUTH_CLIENT_SECRET")
    refresh_token, token_src = pick("GOOGLE_OAUTH_REFRESH_TOKEN")

    missing = [
        name
        for name, value in (
            ("GOOGLE_OAUTH_CLIENT_ID", client_id),
            ("GOOGLE_OAUTH_CLIENT_SECRET", client_secret),
            ("GOOGLE_OAUTH_REFRESH_TOKEN", refresh_token),
        )
        if not value
    ]
    if missing:
        record(
            FAIL,
            "Load OAuth credentials",
            "Missing: " + ", ".join(missing) + "\n"
            f"Looked in the environment and in {os.path.relpath(env_path)}\n"
            "Mint a refresh token first:\n"
            "  py .\\scripts\\mint_drive_refresh_token.py",
        )
        sys.exit(2)

    record(
        PASS,
        "Load OAuth credentials",
        f"client_id:     {client_id} (from {id_src})\n"
        f"client_secret: {len(client_secret)} chars, starts {client_secret[:7]!r} "
        f"(from {secret_src})\n"
        f"refresh_token: {len(refresh_token)} chars, starts {refresh_token[:3]!r} "
        f"(from {token_src})",
    )

    # Structural checks. A malformed value fails later as 'invalid_grant', which
    # reads as an expiry or revocation problem rather than the paste error it is.
    complaints: list[str] = []
    if not client_id.endswith(".apps.googleusercontent.com"):
        complaints.append(
            "client_id does not end in '.apps.googleusercontent.com' -- wrong value copied"
        )
    if not refresh_token.startswith("1//"):
        complaints.append(
            "refresh_token does not start with '1//'. Google's refresh tokens do.\n"
            "  You may have copied the access_token, a partial line, or the wrong field."
        )
    if len(refresh_token) < 50:
        complaints.append(
            f"refresh_token is only {len(refresh_token)} chars. Real ones are ~100 or more,\n"
            "  so this looks TRUNCATED -- a wrapped terminal line is the usual cause."
        )
    if not client_secret.startswith("GOCSPX-"):
        complaints.append(
            "client_secret does not start with 'GOCSPX-' -- check you copied the secret"
        )
    for value, name in (
        (client_id, "client_id"),
        (client_secret, "client_secret"),
        (refresh_token, "refresh_token"),
    ):
        if any(ch.isspace() for ch in value):
            complaints.append(
                f"{name} contains whitespace inside the value -- it was probably pasted\n"
                "  across two lines. Put it on ONE line with no breaks."
            )

    if complaints:
        record(
            WARN,
            "Credential values look well-formed",
            "\n".join(f"- {item}" for item in complaints),
        )
    else:
        record(PASS, "Credential values look well-formed", "Shapes and lengths are plausible.")

    return client_id, client_secret, refresh_token


def load_service_account(key_file: str) -> dict[str, str]:
    if not key_file:
        record(FAIL, "Read the key file", "--key-file is required for --mode service_account.")
        sys.exit(2)
    try:
        with open(key_file, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        record(FAIL, "Read the key file", f"No file at: {key_file}")
        sys.exit(2)
    except ValueError as exc:
        record(FAIL, "Read the key file", f"Not valid JSON: {exc}")
        sys.exit(2)

    if data.get("type") != "service_account":
        record(
            FAIL,
            "Key file is a service account",
            f"type is {data.get('type')!r}, expected 'service_account'.\n"
            "An OAuth client_secret file belongs in --mode oauth instead.",
        )
        sys.exit(2)

    email = data.get("client_email", "")
    record(
        PASS,
        "Read the key file",
        f"identity: {email}\nproject:  {data.get('project_id', '')}",
    )
    if "firebase-adminsdk" in email:
        record(
            WARN,
            "Credential provenance",
            "This is a Firebase Admin SDK key. It carries much broader Google Cloud\n"
            "permissions than a Drive uploader needs. Prefer a dedicated service\n"
            "account with no project roles.",
        )
    return data


# --------------------------------------------------------------------------- #
# Token minting
# --------------------------------------------------------------------------- #

def _b64url(raw: bytes) -> bytes:
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def mint_token_service_account(info: dict[str, str]) -> str:
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
    except ImportError:
        record(
            FAIL,
            "Mint an access token",
            "The 'cryptography' package is not installed. Run:\n"
            "  py -m pip install --upgrade cryptography",
        )
        sys.exit(2)

    token_uri = info.get("token_uri", TOKEN_ENDPOINT)
    now = int(datetime.now(timezone.utc).timestamp())
    header = {"alg": "RS256", "typ": "JWT", "kid": info.get("private_key_id", "")}
    claims = {
        "iss": info["client_email"],
        "scope": SCOPE_FULL,
        "aud": token_uri,
        "iat": now,
        "exp": now + 3600,
    }
    try:
        key = serialization.load_pem_private_key(
            info["private_key"].encode("utf-8"), password=None
        )
        if not isinstance(key, rsa.RSAPrivateKey):
            raise ValueError("private_key is not an RSA key")
        signing_input = (
            _b64url(json.dumps(header, separators=(",", ":")).encode())
            + b"."
            + _b64url(json.dumps(claims, separators=(",", ":")).encode())
        )
        signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        assertion = (signing_input + b"." + _b64url(signature)).decode("ascii")
    except (KeyError, ValueError, TypeError) as exc:
        record(
            FAIL,
            "Mint an access token",
            f"Could not sign with the private key in this file: {exc}\n"
            "The key material looks malformed or truncated.",
        )
        sys.exit(3)

    try:
        payload = post_form(
            token_uri,
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
    except ApiError as exc:
        hint = ""
        if exc.reason == "invalid_grant":
            hint = (
                "\nGoogle rejected the signed assertion. Usual causes:\n"
                "  - the key was deleted or disabled in IAM\n"
                "  - the service account itself was deleted\n"
                "  - this machine's clock is more than a few minutes off"
            )
        record(FAIL, "Mint an access token", f"{exc.status_code} {exc.reason}: {exc.message}{hint}")
        sys.exit(3)

    token = payload.get("access_token")
    if not token:
        record(FAIL, "Mint an access token", "Response contained no access_token.")
        sys.exit(3)
    record(
        PASS,
        "Mint an access token",
        "Signed a JWT assertion and exchanged it for an access token.\n"
        f"Valid for about {int(payload.get('expires_in', 0)) // 60} minutes.",
    )
    return token


def mint_token_oauth(client_id: str, client_secret: str, refresh_token: str) -> str:
    try:
        payload = post_form(
            TOKEN_ENDPOINT,
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    except ApiError as exc:
        hint = ""
        if exc.reason == "invalid_grant":
            hint = (
                "\nGoogle rejected the refresh token. Which cause applies depends on how\n"
                "old the token is.\n"
                "\nIf you minted it MINUTES ago, it is one of these:\n"
                "  1. CLIENT MISMATCH -- the GOOGLE_OAUTH_CLIENT_ID / _SECRET here are not\n"
                "     the ones you minted with. If you created a new 'Desktop app' client\n"
                "     to fix redirect_uri_mismatch, backend/.env must hold the NEW client's\n"
                "     ID and secret, not the old Web application client's. A token is bound\n"
                "     to the exact client that issued it.\n"
                "  2. The token was TRUNCATED or line-wrapped when pasted. Check the\n"
                "     character count reported above: real tokens are ~100+ chars and\n"
                "     start with '1//'.\n"
                "  3. The code was exchanged twice, so the first token was invalidated.\n"
                "\nIf the token is more than a WEEK old:\n"
                "  4. The OAuth app's audience is still 'Testing', which expires tokens\n"
                "     after 7 days. Publish to 'In production' and re-mint.\n"
                "\nEither age:\n"
                "  5. Access was revoked at myaccount.google.com/permissions\n"
                "  6. The owning account's password changed"
            )
        elif exc.reason == "invalid_client":
            hint = "\nThe client ID or secret does not match the client that issued the token."
        record(
            FAIL,
            "Refresh the OAuth access token",
            f"{exc.status_code} {exc.reason}: {exc.message}{hint}",
        )
        sys.exit(3)

    token = payload.get("access_token")
    if not token:
        record(FAIL, "Refresh the OAuth access token", "Response contained no access_token.")
        sys.exit(3)

    granted = payload.get("scope", "")
    # Scopes come back space-delimited. Compare whole tokens: the full 'drive'
    # scope string is a prefix of 'drive.file', so substring matching would
    # misclassify a correctly least-privileged token as over-privileged.
    granted_scopes = set(granted.split())
    record(
        PASS,
        "Refresh the OAuth access token",
        f"Exchanged the refresh token for an access token.\n"
        f"Valid for about {int(payload.get('expires_in', 0)) // 60} minutes.\n"
        f"Granted scope: {granted or '(not reported)'}",
    )
    if granted and not granted_scopes & {SCOPE_FILE, SCOPE_FULL}:
        record(
            FAIL,
            "Granted scope covers Drive writes",
            "Neither drive.file nor drive was granted. The backend cannot create\n"
            "files. Re-mint the token and accept the Drive permission.",
        )
        sys.exit(3)
    if SCOPE_FULL in granted_scopes:
        record(
            WARN,
            "Scope is least-privilege",
            "This token carries the full 'drive' scope, which grants read/write over\n"
            "the entire account's Drive. drive.file is sufficient for this backend and\n"
            "limits access to files the app itself creates. Consider re-minting.",
        )
    return token


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #

def check_api_enabled(token: str, mode: str) -> None:
    try:
        about = call(token, f"{API}/about?fields=user(emailAddress),storageQuota")
    except ApiError as exc:
        if exc.status_code == 403 and (
            "accessNotConfigured" in exc.reason or "has not been used" in exc.message
        ):
            record(
                FAIL,
                "Drive API is enabled on the project",
                "The Drive API is not enabled for this Google Cloud project.\n"
                "Enable it here, then wait about a minute:\n"
                "  https://console.cloud.google.com/apis/library/drive.googleapis.com",
            )
            sys.exit(4)
        record(
            FAIL,
            "Drive API is enabled on the project",
            f"{exc.status_code} {exc.reason}: {exc.message}",
        )
        sys.exit(4)

    record(PASS, "Drive API is enabled on the project", "about.get() returned successfully.")

    quota = about.get("storageQuota") or {}
    account = (about.get("user") or {}).get("emailAddress", "(not reported)")
    limit = quota.get("limit")

    if mode == MODE_OAUTH:
        if limit is None:
            record(
                WARN,
                "The owning account has storage",
                f"Acting as: {account}\n"
                "No storage limit reported, which is unusual for a human account.",
            )
        else:
            used = int(quota.get("usage", "0")) / (1024**3)
            total = int(limit) / (1024**3)
            free = total - used
            record(
                PASS if free > 0.5 else WARN,
                "The owning account has storage",
                f"Acting as: {account}\n"
                f"{used:.2f} GB used of {total:.2f} GB -- {free:.2f} GB free.\n"
                "Report files will be owned by this account and consume this quota.",
            )
    else:
        if limit is None:
            record(
                WARN,
                "This identity has Drive storage",
                "No storage limit reported, which is what a service account looks like.\n"
                "Service accounts have no storage quota of their own and cannot own files\n"
                "in My Drive. They can only write into a Shared Drive, whose quota\n"
                "belongs to the organization.",
            )
        else:
            used = int(quota.get("usage", "0")) / (1024**3)
            record(INFO, "This identity has Drive storage", f"{used:.2f} GB used.")


def create_root_folder(token: str, name: str) -> str:
    body = json.dumps(
        {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "appProperties": {"app": "attendance-manager", "role": "report-root"},
        }
    ).encode("utf-8")
    try:
        created = call(
            token,
            f"{API}/files?supportsAllDrives=true&fields=id,name,webViewLink",
            method="POST",
            body=body,
            content_type="application/json",
        )
    except ApiError as exc:
        record(
            FAIL,
            "Create the report root folder",
            f"{exc.status_code} {exc.reason}: {exc.message}",
        )
        sys.exit(5)

    record(
        PASS,
        "Create the report root folder",
        f"name: {created.get('name')!r}\n"
        f"id:   {created.get('id')}\n"
        f"link: {created.get('webViewLink', '(none)')}\n\n"
        ">>> Record this as GOOGLE_DRIVE_ROOT_FOLDER_ID in your backend secrets. <<<\n"
        "Because the app created it, the drive.file scope keeps access to it and\n"
        "everything beneath it, permanently and without wider Drive access.",
    )
    return created["id"]


def check_folder(token: str, folder_id: str, mode: str) -> dict[str, Any]:
    fields = "id,name,mimeType,driveId,ownedByMe,capabilities(canAddChildren,canEdit)"
    try:
        meta = call(
            token,
            f"{API}/files/{urllib.parse.quote(folder_id)}"
            f"?fields={urllib.parse.quote(fields)}&supportsAllDrives=true",
        )
    except ApiError as exc:
        if exc.status_code == 404:
            detail = (
                "404 notFound.\n"
                f"Folder ID: {folder_id}\n"
            )
            if mode == MODE_OAUTH:
                detail += (
                    "In OAuth mode with the drive.file scope this is expected for any\n"
                    "folder created by hand in the Drive UI -- the scope only reaches\n"
                    "files this app created. That is by design, not a misconfiguration.\n"
                    "Run once with --create-root \"Attendance Manager Reports\" and use\n"
                    "the ID it prints from then on."
                )
            else:
                detail += (
                    "For Drive this usually means 'exists but you have no access'.\n"
                    "Share the folder with the service-account address as Editor."
                )
            record(FAIL, "The target folder is reachable", detail)
        else:
            record(
                FAIL,
                "The target folder is reachable",
                f"{exc.status_code} {exc.reason}: {exc.message}",
            )
        sys.exit(5)

    if meta.get("mimeType") != "application/vnd.google-apps.folder":
        record(
            FAIL,
            "The target ID is a folder",
            f"mimeType is {meta.get('mimeType')!r}. That ID points at a file, not a folder.",
        )
        sys.exit(5)

    record(PASS, "The target folder is reachable", f"name: {meta.get('name')!r}")

    drive_id = meta.get("driveId")
    if drive_id:
        record(
            PASS,
            "Folder location",
            f"Shared Drive (driveId {drive_id}).\n"
            "Files are owned by the drive, so quota belongs to the organization.\n"
            "This is the only location a service account can write to.",
        )
    elif mode == MODE_OAUTH:
        record(
            PASS,
            "Folder location",
            "My Drive, owned by the account this token acts as.\n"
            "Correct for OAuth mode -- that account's quota covers the uploads.",
        )
    else:
        record(
            WARN,
            "Folder location",
            "My Drive, not a Shared Drive. A service account cannot own files here,\n"
            "so the upload below is expected to fail with 403 storageQuotaExceeded\n"
            "even though the folder is readable and canAddChildren may be true.",
        )

    caps = meta.get("capabilities") or {}
    record(
        INFO if caps.get("canAddChildren") else WARN,
        "Reported permission to add children",
        f"canAddChildren={caps.get('canAddChildren')}, canEdit={caps.get('canEdit')}\n"
        "Note: this reflects sharing permission only, never storage quota.",
    )
    return meta


def check_write(token: str, folder_id: str, keep: bool) -> bool:
    marker = f"attendance-manager-write-probe-{uuid.uuid4().hex[:12]}.txt"
    payload = (
        "Attendance Manager Drive write probe.\n"
        "Contains no participant data. Safe to delete.\n"
        f"Created {datetime.now(timezone.utc).isoformat()}\n"
    ).encode("utf-8")
    metadata = {
        "name": marker,
        "parents": [folder_id],
        "appProperties": {"probe": "true", "app": "attendance-manager"},
    }
    boundary = f"===={uuid.uuid4().hex}===="
    body = b"".join(
        [
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode(),
            json.dumps(metadata).encode("utf-8"),
            f"\r\n--{boundary}\r\nContent-Type: text/plain\r\n\r\n".encode(),
            payload,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )

    try:
        created = call(
            token,
            f"{UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true"
            "&fields=id,name,owners(emailAddress),webViewLink",
            method="POST",
            body=body,
            content_type=f"multipart/related; boundary={boundary}",
        )
    except ApiError as exc:
        if exc.reason == "storageQuotaExceeded" or "storage quota" in exc.message.lower():
            record(
                FAIL,
                "Write a test file into the folder",
                "403 storageQuotaExceeded -- the decisive failure.\n"
                "The uploading identity has no storage to charge the new file against.\n"
                "If this is a service account writing to My Drive, no amount of\n"
                "re-sharing will fix it: use a Shared Drive, or switch to --mode oauth.\n"
                "If this is OAuth mode, the owning account's Drive is genuinely full.",
            )
        elif exc.status_code == 403:
            record(
                FAIL,
                "Write a test file into the folder",
                f"403 {exc.reason}: {exc.message}\n"
                "The identity can see the folder but may not add to it.\n"
                "Re-share as Editor (not Viewer or Commenter).",
            )
        else:
            record(
                FAIL,
                "Write a test file into the folder",
                f"{exc.status_code} {exc.reason}: {exc.message}",
            )
        return False

    owners = ", ".join(o.get("emailAddress", "?") for o in created.get("owners") or [])
    record(
        PASS,
        "Write a test file into the folder",
        f"Created file {created.get('id')}\nOwner: {owners or 'the Shared Drive'}",
    )

    if keep:
        record(INFO, "Clean up the test file", "--keep set; leaving the probe file in place.")
        return True
    try:
        call(token, f"{API}/files/{created['id']}?supportsAllDrives=true", method="DELETE")
        record(PASS, "Clean up the test file", "Probe file deleted.")
    except ApiError as exc:
        record(
            WARN,
            "Clean up the test file",
            f"Upload worked but delete failed ({exc.status_code} {exc.reason}).\n"
            f"Remove {marker} from the folder by hand.",
        )
    return True


# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify Google Drive access for the Attendance Manager backend.",
    )
    parser.add_argument(
        "--mode",
        choices=[MODE_OAUTH, MODE_SA],
        default=MODE_OAUTH,
        help="Authorization model to test. Default: oauth.",
    )
    parser.add_argument("--key-file", default="", help="Service-account JSON (service_account mode).")
    parser.add_argument("--folder-id", default="", help="Target Drive folder ID.")
    parser.add_argument(
        "--create-root",
        default="",
        metavar="NAME",
        help="Create a new root folder with this name and probe inside it (oauth mode).",
    )
    parser.add_argument("--env-file", default="", help="Path to a .env holding OAuth values.")
    parser.add_argument("--no-write", action="store_true", help="Skip the upload probe.")
    parser.add_argument("--keep", action="store_true", help="Do not delete the probe file.")
    args = parser.parse_args()

    if not args.folder_id and not args.create_root:
        print("Specify either --folder-id or --create-root.\n")
        if args.mode == MODE_OAUTH:
            print("First time through, create the root the backend will own:")
            print('  py .\\scripts\\verify_drive_access.py --create-root "Attendance Manager Reports"')
        parser.print_usage()
        return 2
    if args.create_root and args.mode == MODE_SA and not args.folder_id:
        print("--create-root in service_account mode would create a folder the service")
        print("account cannot own. Pass --folder-id pointing into a Shared Drive instead.")
        return 2

    print("Attendance Manager -- Google Drive access verification")
    print(f"Mode: {args.mode}")
    print(f"Run at {datetime.now(timezone.utc).isoformat()}")

    section("1. Credential")
    if args.mode == MODE_SA:
        token = mint_token_service_account(load_service_account(args.key_file))
    else:
        token = mint_token_oauth(*resolve_oauth_config(args))

    section("2. Google Cloud project")
    check_api_enabled(token, args.mode)

    section("3. Target folder")
    folder_id = args.folder_id
    if args.create_root:
        folder_id = create_root_folder(token, args.create_root)
    check_folder(token, folder_id, args.mode)

    section("4. Write access")
    if args.no_write:
        record(INFO, "Write a test file into the folder", "--no-write set; skipped.")
        writable = False
    else:
        writable = check_write(token, folder_id, args.keep)

    section("Verdict")
    counts = {level: len([r for r in results if r[0] == level]) for level in (PASS, WARN, FAIL)}
    print(f"  {counts[FAIL]} failed, {counts[WARN]} warnings, {counts[PASS]} passed")

    if args.no_write:
        print("\n  Read-only run. Nothing was proven about write access.")
        return 1
    if writable:
        print("\n  This credential can write reports into that folder.")
        if args.create_root:
            print(f"  Set GOOGLE_DRIVE_ROOT_FOLDER_ID={folder_id}")
        print("  Store the credential in the hosting secret store and proceed with")
        print("  the backend Drive folder resolver.")
        return 0

    print("\n  This credential CANNOT write reports into that folder.")
    print("  Do not build the Drive uploader against it. See docs/DRIVE_SETUP.md.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(130)
