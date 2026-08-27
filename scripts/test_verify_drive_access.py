#!/usr/bin/env python3
"""
Offline self-test for scripts/verify_drive_access.py.

Stands up a fake Drive API and a fake OAuth token endpoint on localhost, then
drives the probe through every branch it can reach, asserting both on the
requests it sends and on the verdicts it prints. Needs no Google credentials,
no network access, and no pytest.

    py .\\scripts\\test_verify_drive_access.py

Prints "ALL BRANCH TESTS PASSED" and exits 0 on success.

What this proves: request construction (bearer header, multipart envelope,
parents, appProperties, supportsAllDrives), OAuth refresh handling, and the
mode-aware interpretation of Google's error codes. What it cannot prove: that
your real credential works -- only a live run shows that.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_drive_access as v  # noqa: E402

MODE: dict[str, object] = {"folder": "mydrive", "upload": "quota", "quota_limit": None}
FAILURES: list[str] = []


class FakeGoogle(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _drive_error(self, code: int, reason: str, message: str) -> None:
        self._send(
            code,
            {
                "error": {
                    "code": code,
                    "message": message,
                    "errors": [{"reason": reason, "domain": "global", "message": message}],
                }
            },
        )

    def _oauth_error(self, code: int, err: str, desc: str) -> None:
        self._send(code, {"error": err, "error_description": desc})

    # ---- token endpoint -------------------------------------------------- #
    def _handle_token(self, raw: str) -> None:
        import urllib.parse as up

        form = {k: vs[0] for k, vs in up.parse_qs(raw).items()}
        assert form.get("grant_type") == "refresh_token", form
        assert form.get("refresh_token"), "refresh_token must be sent"
        assert form.get("client_id") and form.get("client_secret"), "client creds required"
        if MODE.get("refresh") == "invalid_grant":
            return self._oauth_error(400, "invalid_grant", "Token has been expired or revoked.")
        if MODE.get("refresh") == "invalid_client":
            return self._oauth_error(401, "invalid_client", "The OAuth client was not found.")
        scope = MODE.get("granted_scope", v.SCOPE_FILE)
        return self._send(
            200, {"access_token": "fake-access", "expires_in": 3599, "scope": scope}
        )

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8", "replace")
        if self.path.endswith("/token"):
            return self._handle_token(raw)

        assert self.headers.get("Authorization", "").startswith("Bearer ")
        ctype = self.headers.get("Content-Type", "")

        # folder creation
        if ctype.startswith("application/json"):
            meta = json.loads(raw)
            assert meta["mimeType"] == "application/vnd.google-apps.folder", meta
            assert meta["appProperties"]["role"] == "report-root", meta
            MODE["created_root"] = meta["name"]
            return self._send(
                200,
                {
                    "id": "NEWROOT",
                    "name": meta["name"],
                    "webViewLink": "https://drive.google.com/drive/folders/NEWROOT",
                },
            )

        # file upload
        assert ctype.startswith("multipart/related; boundary="), f"bad Content-Type: {ctype}"
        boundary = ctype.split("boundary=")[1]
        assert raw.startswith(f"--{boundary}\r\n"), "body must open with the boundary"
        assert raw.rstrip().endswith(f"--{boundary}--"), "body must close the boundary"
        assert "application/json" in raw and "text/plain" in raw, "both MIME parts required"
        assert "supportsAllDrives=true" in self.path, "upload must set supportsAllDrives"
        meta = json.loads(raw.split("\r\n\r\n")[1].split(f"\r\n--{boundary}")[0])
        assert meta["parents"] == ["FOLDER1"], f"wrong parent: {meta}"
        assert meta["appProperties"]["probe"] == "true", "probe marker missing"
        assert meta["name"].startswith("attendance-manager-write-probe-"), meta["name"]
        assert "no participant data" in raw.split("text/plain\r\n\r\n")[1]

        if MODE["upload"] == "quota":
            return self._drive_error(
                403, "storageQuotaExceeded", "The user's Drive storage quota has been exceeded."
            )
        if MODE["upload"] == "forbidden":
            return self._drive_error(
                403,
                "insufficientFilePermissions",
                "The user does not have sufficient permissions for this file.",
            )
        return self._send(
            200,
            {
                "id": "FILE1",
                "name": meta["name"],
                "owners": [{"emailAddress": "owner@example.com"}],
            },
        )

    def do_GET(self) -> None:
        assert self.headers.get("Authorization", "").startswith("Bearer "), "missing bearer token"
        if "/about" in self.path:
            if MODE.get("about") == "disabled":
                return self._drive_error(
                    403,
                    "accessNotConfigured",
                    "Google Drive API has not been used in project 1 before or it is disabled.",
                )
            quota: dict = {"usage": str(3 * 1024**3)}
            if MODE.get("quota_limit") is not None:
                quota["limit"] = str(MODE["quota_limit"])
            return self._send(
                200, {"user": {"emailAddress": "owner@example.com"}, "storageQuota": quota}
            )
        if "/files/" in self.path:
            assert "supportsAllDrives=true" in self.path, "files.get must set supportsAllDrives"
            if MODE["folder"] == "notfound":
                return self._drive_error(404, "notFound", "File not found: FOLDER1.")
            meta = {
                "id": "FOLDER1",
                "name": "Attendance Reports",
                "mimeType": "application/vnd.google-apps.folder",
                "capabilities": {"canAddChildren": True, "canEdit": True},
            }
            if MODE["folder"] == "shared":
                meta["driveId"] = "DRIVE99"
            elif MODE["folder"] == "notafolder":
                meta["mimeType"] = "text/plain"
            return self._send(200, meta)
        return self._drive_error(404, "notFound", "unexpected path")

    def do_DELETE(self) -> None:
        assert "supportsAllDrives=true" in self.path, "delete must set supportsAllDrives"
        MODE["deleted"] = True
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()


def run(name: str, fn):
    v.results.clear()
    buffer = io.StringIO()
    code = None
    try:
        with contextlib.redirect_stdout(buffer):
            fn()
    except SystemExit as exc:
        code = exc.code
    out = buffer.getvalue()
    print(f"\n### {name}   (exit={code})")
    print(out.rstrip())
    return out, code


def expect(condition: bool, label: str) -> None:
    if not condition:
        FAILURES.append(label)
        print(f"    !! ASSERTION FAILED: {label}")


def main() -> int:
    server = HTTPServer(("127.0.0.1", 0), FakeGoogle)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    v.API = f"{base}/drive/v3"
    v.UPLOAD_API = f"{base}/upload/drive/v3"
    v.TOKEN_ENDPOINT = f"{base}/token"
    token = "fake-access"

    print("Offline self-test for verify_drive_access.py")
    print(f"Fake Google API on port {server.server_port}")

    # ---------------- OAuth token refresh ---------------- #
    out, _ = run(
        "oauth: refresh succeeds with drive.file",
        lambda: v.mint_token_oauth("cid", "csecret", "rtoken"),
    )
    expect("[PASS] Refresh the OAuth access token" in out, "successful refresh should pass")
    expect("drive.file" in out, "granted scope should be shown")
    # Regression: the full 'drive' scope string is a prefix of 'drive.file', so
    # substring matching used to flag a correctly-scoped token as over-privileged.
    expect(
        "[WARN] Scope is least-privilege" not in out,
        "drive.file alone must NOT trigger the over-privilege warning",
    )

    MODE["refresh"] = "invalid_grant"
    out, code = run(
        "oauth: refresh token expired/revoked",
        lambda: v.mint_token_oauth("cid", "csecret", "rtoken"),
    )
    expect(code == 3, "invalid_grant should exit 3")
    expect("still 'Testing'" in out, "invalid_grant should name the 7-day Testing cause")
    expect("myaccount.google.com/permissions" in out, "should mention revocation")

    MODE["refresh"] = "invalid_client"
    out, code = run(
        "oauth: client id/secret mismatch",
        lambda: v.mint_token_oauth("cid", "csecret", "rtoken"),
    )
    expect(code == 3, "invalid_client should exit 3")
    expect("does not match the client" in out, "invalid_client should be explained")
    MODE.pop("refresh")

    MODE["granted_scope"] = v.SCOPE_FULL
    out, _ = run(
        "oauth: full drive scope warns about least privilege",
        lambda: v.mint_token_oauth("cid", "csecret", "rtoken"),
    )
    expect("[WARN] Scope is least-privilege" in out, "full drive scope should warn")

    MODE["granted_scope"] = "https://www.googleapis.com/auth/userinfo.email"
    out, code = run(
        "oauth: drive scope not granted at all",
        lambda: v.mint_token_oauth("cid", "csecret", "rtoken"),
    )
    expect(code == 3, "missing drive scope should exit 3")
    expect("Neither drive.file nor drive was granted" in out, "should name the missing scope")
    MODE["granted_scope"] = v.SCOPE_FILE

    # ---------------- about / API enablement ---------------- #
    MODE["about"] = "disabled"
    out, code = run("about: Drive API disabled", lambda: v.check_api_enabled(token, v.MODE_OAUTH))
    expect(code == 4, "disabled API should exit 4")
    expect("console.cloud.google.com" in out, "should link the enable page")
    MODE.pop("about")

    MODE["quota_limit"] = 15 * 1024**3
    out, _ = run(
        "about: oauth mode shows the owner's free space",
        lambda: v.check_api_enabled(token, v.MODE_OAUTH),
    )
    expect("[PASS] The owning account has storage" in out, "oauth quota should pass")
    expect("12.00 GB free" in out, "free space should be computed")
    expect("owner@example.com" in out, "acting-as account should be shown")

    MODE["quota_limit"] = int(3.2 * 1024**3)
    out, _ = run(
        "about: oauth mode warns when nearly full",
        lambda: v.check_api_enabled(token, v.MODE_OAUTH),
    )
    expect("[WARN] The owning account has storage" in out, "low free space should warn")

    MODE["quota_limit"] = None
    out, _ = run(
        "about: service_account mode has no quota",
        lambda: v.check_api_enabled(token, v.MODE_SA),
    )
    expect("no storage quota" in out, "SA mode should explain the quota problem")

    # ---------------- root folder creation ---------------- #
    out, _ = run(
        "create-root: makes an app-owned folder",
        lambda: v.create_root_folder(token, "Attendance Manager Reports"),
    )
    expect("[PASS] Create the report root folder" in out, "root creation should pass")
    expect("GOOGLE_DRIVE_ROOT_FOLDER_ID" in out, "should tell the user what to record")
    expect(MODE.get("created_root") == "Attendance Manager Reports", "name should be sent")

    # ---------------- folder checks ---------------- #
    MODE["folder"] = "notfound"
    out, code = run(
        "folder: 404 in oauth mode explains drive.file",
        lambda: v.check_folder(token, "FOLDER1", v.MODE_OAUTH),
    )
    expect(code == 5, "404 should exit 5")
    expect("only reaches" in out and "--create-root" in out, "oauth 404 should explain drive.file")

    out, code = run(
        "folder: 404 in service_account mode suggests sharing",
        lambda: v.check_folder(token, "FOLDER1", v.MODE_SA),
    )
    expect("service-account address as Editor" in out, "SA 404 should suggest sharing")

    MODE["folder"] = "notafolder"
    out, code = run(
        "folder: ID points at a file",
        lambda: v.check_folder(token, "FOLDER1", v.MODE_OAUTH),
    )
    expect(code == 5 and "points at a file" in out, "non-folder should exit 5")

    MODE["folder"] = "mydrive"
    out, _ = run(
        "folder: My Drive is correct in oauth mode",
        lambda: v.check_folder(token, "FOLDER1", v.MODE_OAUTH),
    )
    expect("[PASS] Folder location" in out, "My Drive should PASS in oauth mode")
    expect("Correct for OAuth mode" in out, "should say My Drive is expected here")

    out, _ = run(
        "folder: My Drive is fatal in service_account mode",
        lambda: v.check_folder(token, "FOLDER1", v.MODE_SA),
    )
    expect("[WARN] Folder location" in out, "My Drive should WARN in SA mode")
    expect("storageQuotaExceeded" in out, "SA + My Drive should predict the failure")

    MODE["folder"] = "shared"
    out, _ = run(
        "folder: Shared Drive detected",
        lambda: v.check_folder(token, "FOLDER1", v.MODE_SA),
    )
    expect("Shared Drive (driveId DRIVE99)" in out, "Shared Drive should be identified")

    # ---------------- write probe ---------------- #
    MODE["folder"], MODE["upload"] = "mydrive", "quota"
    out, _ = run(
        "upload: 403 storageQuotaExceeded",
        lambda: FAILURES.append("quota should return False")
        if v.check_write(token, "FOLDER1", False)
        else None,
    )
    expect("decisive failure" in out, "quota error should be called decisive")
    expect("--mode oauth" in out, "quota error should point at the oauth fix")

    MODE["upload"] = "forbidden"
    out, _ = run(
        "upload: 403 insufficient permissions",
        lambda: FAILURES.append("forbidden should return False")
        if v.check_write(token, "FOLDER1", False)
        else None,
    )
    expect("Re-share as Editor" in out, "permission error should suggest Editor")

    MODE["upload"], MODE["deleted"] = "ok", False
    out, _ = run(
        "upload: success then cleanup",
        lambda: None
        if v.check_write(token, "FOLDER1", False)
        else FAILURES.append("success should return True"),
    )
    expect("[PASS] Write a test file" in out, "successful upload should pass")
    expect("Probe file deleted" in out and MODE["deleted"] is True, "probe should be deleted")

    MODE["deleted"] = False
    out, _ = run("upload: success with --keep", lambda: v.check_write(token, "FOLDER1", True))
    expect("leaving the probe file" in out, "--keep should announce itself")
    expect(MODE["deleted"] is False, "--keep must not delete")

    # ---------------- config loading ---------------- #
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        env_path = os.path.join(tmp, ".env")
        with open(env_path, "w", encoding="utf-8") as fh:
            fh.write(
                "# comment\n"
                "GOOGLE_OAUTH_CLIENT_ID=abc.apps.googleusercontent.com\n"
                'GOOGLE_OAUTH_CLIENT_SECRET="quoted-secret"\n'
                "GOOGLE_OAUTH_REFRESH_TOKEN=1//zzzz\n"
            )
        parsed = v.load_env_file(env_path)
        expect(parsed["GOOGLE_OAUTH_CLIENT_SECRET"] == "quoted-secret", "quotes should be stripped")
        expect(len(parsed) == 3, "comments and blanks should be skipped")

        saved = {k: os.environ.pop(k, None) for k in
                 ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN")}
        try:
            args = type("A", (), {"env_file": env_path})()
            out, _ = run("config: loads oauth values from an env file",
                         lambda: v.resolve_oauth_config(args))
            expect("[PASS] Load OAuth credentials" in out, "env-file load should pass")
            expect("1//zzzz" not in out, "the refresh token must never be printed")
            expect("quoted-secret" not in out, "the client secret must never be printed")

            empty = os.path.join(tmp, "empty.env")
            open(empty, "w").close()
            args2 = type("A", (), {"env_file": empty})()
            out, code = run("config: missing oauth values",
                            lambda: v.resolve_oauth_config(args2))
            expect(code == 2, "missing credentials should exit 2")
            expect("mint_drive_refresh_token" in out, "should point at the minting script")
        finally:
            for key, value in saved.items():
                if value is not None:
                    os.environ[key] = value

    server.shutdown()
    print("\n" + "=" * 60)
    if FAILURES:
        print(f"{len(FAILURES)} CHECK(S) FAILED:")
        for item in FAILURES:
            print(f"  - {item}")
        return 1
    print("ALL BRANCH TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
