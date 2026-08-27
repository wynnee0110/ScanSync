#!/usr/bin/env python3
"""
Attendance Manager -- mint a Google Drive refresh token.

One-time interactive setup. Runs the OAuth 2.0 authorization-code flow with PKCE
against a loopback redirect, then prints the refresh token the FastAPI backend
will use to write report files to Drive as the account you sign in with.

Requires an OAuth client of type "Desktop app" (Google auto-allows
http://127.0.0.1:<any port> for that client type, so no redirect URI to register).
See docs/DRIVE_SETUP.md for the console click-path.

Usage (PowerShell, from the repository root):

    $env:GOOGLE_OAUTH_CLIENT_ID     = "xxxx.apps.googleusercontent.com"
    $env:GOOGLE_OAUTH_CLIENT_SECRET = "xxxx"
    py .\scripts\mint_drive_refresh_token.py

Sign in as the account that should OWN the report files -- its 15 GB is what the
reports consume. If a browser does not open, copy the printed URL into one.

Scope requested: https://www.googleapis.com/auth/drive.file
That grants access ONLY to files and folders this application itself creates.
It cannot read the rest of the Drive, which is the point.

SECURITY
  The refresh token printed by this script is a long-lived credential equivalent
  to standing access to the app's own Drive files. Paste it straight into your
  hosting provider's secret store. Do not commit it, do not paste it into chat,
  and do not leave it in shell history. This script never writes it to disk.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/drive.file"

_result: dict[str, str] = {}
_done = threading.Event()

SUCCESS_PAGE = b"""<!doctype html><html><head><meta charset="utf-8">
<title>Authorized</title></head><body style="font-family:system-ui;padding:3rem;max-width:34rem">
<h2>Authorization complete</h2>
<p>The Attendance Manager backend now has a refresh token for this account.</p>
<p>Return to your terminal. You can close this tab.</p>
</body></html>"""

FAILURE_PAGE = b"""<!doctype html><html><head><meta charset="utf-8">
<title>Authorization failed</title></head><body style="font-family:system-ui;padding:3rem;max-width:34rem">
<h2>Authorization failed</h2>
<p>Check the terminal for details.</p>
</body></html>"""


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the console clean
        pass

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in ("/", "/callback"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        params = urllib.parse.parse_qs(parsed.query)
        ok = "code" in params
        page = SUCCESS_PAGE if ok else FAILURE_PAGE
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

        _result["code"] = params.get("code", [""])[0]
        _result["state"] = params.get("state", [""])[0]
        _result["error"] = params.get("error", [""])[0]
        _done.set()


def clean(value: str, label: str, problems: list[str]) -> str:
    """Strip the debris that copy-paste into a shell variable leaves behind.

    A trailing space or a wrapping quote in a client ID produces
    'Error 401: invalid_client' at the authorization endpoint, which reads as a
    credential problem rather than a formatting one. Fix it and say so.
    """
    original = value
    value = value.strip()
    if value != original:
        problems.append(f"{label}: removed surrounding whitespace")
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1].strip()
        problems.append(f"{label}: removed surrounding quotes")
    # Escaped rather than literal so this file stays pure ASCII; a Windows console
    # or editor using cp1252 can mangle literal smart quotes in source.
    if any(ch in value for ch in "\u2018\u2019\u201c\u201d"):
        problems.append(
            f"{label}: contains a curly/smart quote -- retype it, do not paste from a doc"
        )
    if " " in value:
        problems.append(f"{label}: contains an internal space, which is never valid")
    return value


def load_env_file(path: str) -> dict[str, str]:
    """Parse a KEY=VALUE .env file, stripping simple surrounding quotes."""
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


def write_env_values(path: str, updates: dict[str, str]) -> tuple[bool, str]:
    """Set keys in a .env in place, preserving comments, order and unrelated lines.

    Rewrites an existing key's line, appends any key that is absent, and swaps the
    file atomically. Returns (ok, message). The point is to keep a 100+ character
    refresh token off the clipboard and out of shell scrollback entirely -- hand
    copying it is what truncates it.
    """
    if not os.path.isfile(path):
        return False, f"no file at {path}"

    try:
        # newline="" so existing CRLF endings survive the round trip; text mode
        # would silently normalise them and rewrite the whole file as LF.
        with open(path, "r", encoding="utf-8", newline="") as handle:
            lines = handle.read().splitlines(keepends=True)
    except OSError as exc:
        return False, f"could not read {path}: {exc}"

    newline = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    remaining = dict(updates)
    changed: list[str] = []

    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.partition("=")[0].strip()
        if key in remaining:
            lines[index] = f"{key}={remaining.pop(key)}{newline}"
            changed.append(key)

    for key, value in remaining.items():
        if lines and not lines[-1].endswith(("\n", "\r\n")):
            lines[-1] += newline
        lines.append(f"{key}={value}{newline}")
        changed.append(f"{key} (appended)")

    temp = path + ".tmp"
    try:
        with open(temp, "w", encoding="utf-8", newline="") as handle:
            handle.writelines(lines)
        os.replace(temp, path)
    except OSError as exc:
        for leftover in (temp,):
            try:
                os.remove(leftover)
            except OSError:
                pass
        return False, f"could not write {path}: {exc}"

    return True, ", ".join(changed)


def default_env_path() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, os.pardir, "backend", ".env")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def port_available(port: int) -> bool:
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def post_form(url: str, fields: dict[str, str]) -> dict:
    body = urllib.parse.urlencode(fields).encode("ascii")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
            err = parsed.get("error", "")
            desc = parsed.get("error_description", "")
        except ValueError:
            err, desc = "http_error", raw[:300]
        print(f"\n  FAILED: {exc.code} {err}")
        if desc:
            print(f"          {desc}")
        if err == "invalid_client":
            print("\n  This happened at the TOKEN step, after the browser accepted your")
            print("  client ID -- so the client ID is fine and the SECRET is wrong.")
            print("  Re-copy it from the client's page (Credentials -> click the client")
            print("  name -> the secret is on the right). If you cannot see the value,")
            print("  add a new secret; Google hides existing ones after creation.")
        elif err == "redirect_uri_mismatch":
            print("\n  The redirect URI was rejected. Two ways out:")
            print("  1. Create a client of type 'Desktop app' (recommended). It accepts")
            print("     any http://127.0.0.1:<port> with nothing to register.")
            print("  2. Keep this 'Web application' client and register a fixed URI:")
            print("       py .\\scripts\\mint_drive_refresh_token.py --port 8765")
            print("     then add exactly this to Authorized redirect URIs:")
            print("       http://127.0.0.1:8765/callback")
            print("     127.0.0.1 and localhost are NOT interchangeable to Google.")
        elif err == "invalid_grant":
            print("\n  The authorization code was already used or expired. Re-run.")
        sys.exit(3)
    except urllib.error.URLError as exc:
        print(f"\n  FAILED: could not reach {url}: {exc.reason}")
        sys.exit(3)


def extract_code_and_state(pasted: str) -> tuple[str, str, str]:
    """Pull code/state out of whatever the user pasted.

    Accepts a full redirect URL, a bare query string, or a raw code. Returns
    (code, state, note) where note describes any degraded handling.
    """
    pasted = pasted.strip().strip('"').strip("'")
    if not pasted:
        return "", "", "nothing pasted"

    if "?" in pasted or pasted.startswith("code=") or "&" in pasted:
        query = pasted.split("?", 1)[1] if "?" in pasted else pasted
        params = urllib.parse.parse_qs(query)
        if "error" in params:
            return "", "", f"the URL contains error={params['error'][0]}"
        code = params.get("code", [""])[0]
        state = params.get("state", [""])[0]
        if code:
            return code, state, ""
        return "", "", "no 'code' parameter found in that URL"

    if pasted.startswith("4/") or len(pasted) > 20:
        return pasted, "", "raw code pasted, so state could not be verified"
    return "", "", "that does not look like a redirect URL or an authorization code"


def manual_flow(
    args: argparse.Namespace, auth_url: str, redirect_uri: str, state: str, verifier: str
) -> int:
    """Authorize without running a local server; the user pastes the redirect URL."""
    print("\nManual mode -- no local server will be started.")
    print(f"\nScope: {SCOPE}")
    print("       (access limited to files this app creates)")
    print("\n>>> Sign in as the account that should OWN the report files. <<<")
    print("    Its storage quota is what the reports will consume.\n")
    print("=" * 68)
    print("STEP 1  Open this URL in your browser and approve access:")
    print("=" * 68)
    print(f"\n{auth_url}\n")
    print("=" * 68)
    print("STEP 2  The browser will then show an error page such as")
    print("        'This site can't be reached' or '127.0.0.1 refused to")
    print("        connect'. THAT IS EXPECTED AND FINE. Nothing is wrong.")
    print("=" * 68)
    print("\n        The address bar will look like:")
    print(f"          {redirect_uri}?state=...&code=4/0A...&scope=...")
    print("\n        Copy the ENTIRE address bar contents.")
    print("\n" + "=" * 68)
    print("STEP 3  Paste it below and press Enter.")
    print("=" * 68)

    try:
        pasted = input("\nRedirect URL: ")
    except EOFError:
        print("\n  No input received.")
        return 5

    code, returned_state, note = extract_code_and_state(pasted)
    if not code:
        print(f"\n  Could not read an authorization code: {note}")
        print("  Paste the whole address bar, starting with 'http://127.0.0.1'.")
        return 5

    if returned_state:
        if not secrets.compare_digest(returned_state, state):
            print("\n  ABORTED: the state value does not match this run.")
            print("  You probably pasted a URL from an earlier run. Start over so the")
            print("  state and PKCE values belong to the same session.")
            return 6
        print("  State verified.")
    else:
        print(f"  WARNING: {note}")

    print("  Exchanging the code for tokens...")
    tokens = post_form(
        TOKEN_ENDPOINT,
        {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )
    return report_tokens(tokens, args)


def report_tokens(tokens: dict, args: argparse.Namespace) -> int:
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        print("\n  No refresh_token in the response.")
        print("  Google only returns one on first consent for a given client+account.")
        print("  Revoke this app's access and run again:")
        print("    https://myaccount.google.com/permissions")
        return 7

    granted = tokens.get("scope", "")
    print("\n" + "=" * 68)
    print("SUCCESS")
    print("=" * 68)
    print(f"\nGranted scope: {granted}")
    if SCOPE not in granted.split():
        print("  WARNING: drive.file was not granted. The backend will not be able")
        print("  to create report files. Re-run and accept the Drive permission.")
    print(f"Refresh token: {len(refresh_token)} chars, starts {refresh_token[:3]!r}")

    if args.write_env:
        ok, detail = write_env_values(
            args.env_path,
            {
                "GOOGLE_DRIVE_AUTH_MODE": "oauth_user",
                "GOOGLE_OAUTH_CLIENT_ID": args.client_id,
                "GOOGLE_OAUTH_CLIENT_SECRET": args.client_secret,
                "GOOGLE_OAUTH_REFRESH_TOKEN": refresh_token,
            },
        )
        rel = os.path.relpath(args.env_path)
        if ok:
            print(f"\nWritten to {rel}: {detail}")
            print("The token never touched your clipboard or scrollback, so it cannot")
            print("have been truncated. The client ID and secret were written from the")
            print("same values used to mint, so they cannot mismatch.")
            print("\nNext, verify end to end and create the report root folder:")
            print("  py .\\scripts\\verify_drive_access.py --mode oauth \\")
            print('     --create-root "Attendance Manager Reports"')
            print("\nReminder: publish the OAuth app to 'In production' or this token")
            print("dies in 7 days. Revoke anytime at myaccount.google.com/permissions")
            return 0
        print(f"\n  Could not update {rel}: {detail}")
        print("  Falling back to printing the values below -- copy them carefully.")

    print("\nPut these in backend\\.env (gitignored) or your hosting secret store.")
    print("Each must be ONE line with no breaks:\n")
    print("  GOOGLE_DRIVE_AUTH_MODE=oauth_user")
    print(f"  GOOGLE_OAUTH_CLIENT_ID={args.client_id}")
    print("  GOOGLE_OAUTH_CLIENT_SECRET=<the secret you set above>")
    print(f"  GOOGLE_OAUTH_REFRESH_TOKEN={refresh_token}")

    print("\nThen verify end to end, which also creates the report root folder:")
    print("  py .\\scripts\\verify_drive_access.py --mode oauth \\")
    print('     --create-root "Attendance Manager Reports"')

    print("\nReminders:")
    print("  - Publish the OAuth app to 'In production' or this token dies in 7 days.")
    print("  - Re-run with --write-env to skip this copy-paste entirely.")
    print("  - Revoke anytime at https://myaccount.google.com/permissions")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mint a Google Drive refresh token for the Attendance Manager backend."
    )
    parser.add_argument(
        "--client-id",
        default="",
        help="OAuth client ID. Defaults to $GOOGLE_OAUTH_CLIENT_ID, then backend/.env.",
    )
    parser.add_argument(
        "--client-secret",
        default="",
        help="OAuth client secret. Defaults to $GOOGLE_OAUTH_CLIENT_SECRET, then backend/.env.",
    )
    parser.add_argument(
        "--env-file",
        default="",
        help="Read the client ID and secret from this .env instead of backend/.env. "
        "Using the same file the backend reads guarantees the minted token matches.",
    )
    parser.add_argument(
        "--write-env",
        action="store_true",
        help="On success, write the refresh token straight into the .env instead of "
        "printing it. Avoids the copy-paste that truncates long tokens.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Print the URL instead of trying to open a browser.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the client ID and print the authorization URL, then stop. "
        "Contacts nothing. Use this to diagnose 'invalid_client'.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Fix the loopback port instead of picking a free one. Needed only for a "
        "'Web application' client, whose redirect URIs must be registered exactly.",
    )
    parser.add_argument(
        "--manual",
        action="store_true",
        help="Skip the local callback server. You paste the redirect URL from your "
        "browser's address bar instead. Use this if the loopback flow keeps failing.",
    )
    parser.add_argument(
        "--traceback",
        action="store_true",
        help="Print the full Python traceback on an unexpected error.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Seconds to wait for the consent screen. Default 300.",
    )
    parser.add_argument(
        "--redirect-host",
        choices=["127.0.0.1", "localhost"],
        default="127.0.0.1",
        help="Loopback host in the redirect URI. Google treats 127.0.0.1 and localhost "
        "as DIFFERENT registered URIs, so this must match what you registered.",
    )
    args = parser.parse_args()

    # Precedence: explicit flag, then environment, then the backend's own .env.
    # Reading the backend's file is the point: a token minted with a different
    # client than the backend presents is rejected as 'invalid_grant'.
    env_path = os.path.abspath(args.env_file or default_env_path())
    args.env_path = env_path
    from_file = load_env_file(env_path)
    sources: dict[str, str] = {}

    if args.write_env and not os.path.isfile(env_path):
        print(f"--write-env needs an existing file at {os.path.relpath(env_path)}.")
        print("Create it from the template first:")
        print("  Copy-Item backend\\.env.example backend\\.env")
        return 2

    def resolve(flag_value: str, key: str) -> str:
        if flag_value:
            sources[key] = "command line"
            return flag_value
        if os.environ.get(key):
            sources[key] = "environment"
            return os.environ[key]
        if from_file.get(key):
            sources[key] = os.path.relpath(env_path)
            return from_file[key]
        sources[key] = "not found"
        return ""

    args.client_id = resolve(args.client_id, "GOOGLE_OAUTH_CLIENT_ID")
    args.client_secret = resolve(args.client_secret, "GOOGLE_OAUTH_CLIENT_SECRET")

    if not args.client_id or not args.client_secret:
        print("Missing OAuth client credentials.\n")
        print(f"  GOOGLE_OAUTH_CLIENT_ID:     {sources['GOOGLE_OAUTH_CLIENT_ID']}")
        print(f"  GOOGLE_OAUTH_CLIENT_SECRET: {sources['GOOGLE_OAUTH_CLIENT_SECRET']}")
        print(f"\nLooked in the environment and in {os.path.relpath(env_path)}")
        print("\nEither fill those two keys into backend/.env, or set them here:")
        print('  $env:GOOGLE_OAUTH_CLIENT_ID     = "xxxx.apps.googleusercontent.com"')
        print('  $env:GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-xxxx"')
        print("\nSee docs/DRIVE_SETUP.md for how to create the Desktop app client.")
        return 2

    problems: list[str] = []
    args.client_id = clean(args.client_id, "client ID", problems)
    args.client_secret = clean(args.client_secret, "client secret", problems)

    print("Attendance Manager -- Drive refresh token setup")
    print("\nPreflight")
    print("---------")
    print(f"  client ID:     {args.client_id}")
    print(f"                 (from {sources['GOOGLE_OAUTH_CLIENT_ID']})")
    print(f"  client secret: {len(args.client_secret)} chars, "
          f"from {sources['GOOGLE_OAUTH_CLIENT_SECRET']}")
    for problem in problems:
        print(f"  CLEANED  {problem}")
    if sources["GOOGLE_OAUTH_CLIENT_ID"] != sources["GOOGLE_OAUTH_CLIENT_SECRET"]:
        print("\n  WARNING: the ID and secret came from DIFFERENT sources, so they may")
        print("  belong to different OAuth clients. That mints a token the backend")
        print("  cannot use. Put both in the same place before continuing.")

    fatal = False
    if not args.client_id.endswith(".apps.googleusercontent.com"):
        print("\n  PROBLEM: that client ID does not end in '.apps.googleusercontent.com'.")
        print("  Every Google OAuth client ID does. You may have copied the client")
        print("  *name*, a truncated value, or an API key instead.")
        fatal = True
    if args.client_id.count(".apps.googleusercontent.com") > 1:
        print("\n  PROBLEM: the client ID appears to be duplicated (pasted twice).")
        fatal = True
    if args.client_secret.startswith("GOCSPX-") is False and len(args.client_secret) < 20:
        print("\n  NOTE: client secrets are normally ~35 chars and start with 'GOCSPX-'.")
        print("  Yours does not look like one. Check you copied the secret value and")
        print("  not the client ID or the secret's creation date.")
    if fatal:
        print("\n  Stopping before opening a browser. Re-copy the client ID from:")
        print("    https://console.cloud.google.com/apis/credentials")
        print("  Click the client name, then use the copy button next to Client ID.")
        return 2
    print("  Format looks valid.")

    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    state = secrets.token_urlsafe(24)

    if args.manual and not args.port:
        # Manual mode needs a predictable redirect URI to print and to send at the
        # token step; an ephemeral port would differ from what the user pasted.
        port = 8765
    elif args.port:
        port = args.port
        if not port_available(port):
            print(f"\n  Port {port} is already in use. Close whatever is holding it,")
            print("  or pick a different --port and register that URI instead.")
            return 2
    else:
        port = free_port()
    redirect_uri = f"http://{args.redirect_host}:{port}/callback"

    def build_url() -> str:
        return f"{AUTH_ENDPOINT}?" + urllib.parse.urlencode(
            {
                "client_id": args.client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": SCOPE,
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
            }
        )

    if args.dry_run:
        print("\nDry run -- no browser, no local server, nothing sent to Google.")
        print("\nThe client_id this script would send, delimited so trailing")
        print("whitespace is visible:")
        print(f"\n  >>>{args.client_id}<<<\n")
        print("Compare that against the Client ID on the credentials page,")
        print("character for character:")
        print("  https://console.cloud.google.com/apis/credentials")
        print("\nIf they match exactly and you still get 'Error 401: invalid_client',")
        print("the client was deleted, or it lives in a different Google Cloud")
        print("project than the one you are looking at. Check the project selector.")
        print(f"\nRedirect URI this run would use:\n\n  {redirect_uri}\n")
        if args.port:
            print("Because --port was given, that URI is stable. For a 'Web application'")
            print("client, paste it verbatim into Authorized redirect URIs. Note that")
            print("127.0.0.1 and localhost are DIFFERENT registered values to Google.")
        else:
            print("The port is chosen fresh each run, so this URI cannot be registered.")
            print("That is fine for a 'Desktop app' client, which accepts any loopback")
            print("port. For a 'Web application' client, re-run with a fixed --port.")
        print("\n" + "!" * 68)
        print("DO NOT AUTHORIZE WITH THE URL BELOW.")
        print("!" * 68)
        print("No local server is running in a dry run, so the callback would fail")
        print("with '127.0.0.1 refused to connect'. The state and PKCE values are")
        print("also regenerated every run, so a copied URL can never satisfy a later")
        print("one. It is printed for inspection only.")
        print("\nTo actually authorize, re-run WITHOUT --dry-run and use the URL that")
        print("run prints (or let it open your browser):")
        cmd = "  py .\\scripts\\mint_drive_refresh_token.py"
        if args.port:
            cmd += f" --port {args.port}"
        if args.redirect_host != "127.0.0.1":
            cmd += f" --redirect-host {args.redirect_host}"
        print(cmd)
        print(f"\nURL (inspection only):\n\n{build_url()}\n")
        return 0

    if args.manual:
        return manual_flow(args, build_url(), redirect_uri, state, verifier)

    try:
        server = http.server.HTTPServer(("127.0.0.1", port), CallbackHandler)
    except OSError as exc:
        print(f"\n  Could not start the local callback server on port {port}: {exc}")
        print("  Something is blocking it -- often a firewall or security tool.")
        print("  Use the no-server flow instead:")
        print("    py .\\scripts\\mint_drive_refresh_token.py --manual")
        return 2
    threading.Thread(target=server.serve_forever, daemon=True).start()
    auth_url = build_url()

    print(f"\nScope: {SCOPE}")
    print("       (access limited to files this app creates)")
    print(f"Listening on {redirect_uri}")
    print("\n>>> Sign in as the account that should OWN the report files. <<<")
    print("    Its storage quota is what the reports will consume.\n")

    opened = False
    if not args.no_browser:
        try:
            opened = webbrowser.open(auth_url)
        except Exception:  # noqa: BLE001
            opened = False
    if opened:
        print("A browser window should have opened. If not, use this URL:")
    else:
        print("Open this URL in a browser:")
    print(f"\n{auth_url}\n")

    span = (
        f"{args.timeout // 60} minute" + ("s" if args.timeout // 60 != 1 else "")
        if args.timeout >= 60
        else f"{args.timeout} second" + ("s" if args.timeout != 1 else "")
    )
    print(f"Waiting for authorization on port {port} ({span} timeout)...")
    print("Leave this window open and this process running until it completes.")
    if not _done.wait(timeout=args.timeout):
        print(f"\n  TIMED OUT after {span}. Nothing was changed.")
        print("  The local server has stopped, so the old URL is now dead -- if you")
        print("  authorize with it you will get '127.0.0.1 refused to connect'.")
        print("  Re-run and complete the consent screen promptly, or pass a longer")
        print("  --timeout.")
        server.shutdown()
        return 4
    server.shutdown()

    if _result.get("error"):
        print(f"\n  DENIED: {_result['error']}")
        if _result["error"] == "access_denied":
            print("  You dismissed the consent screen, or the app's audience is")
            print("  set to Testing and this account is not on the test-user list.")
        return 5
    if not secrets.compare_digest(_result.get("state", ""), state):
        print("\n  ABORTED: state mismatch. Discarding the response.")
        print("  This can indicate a cross-site request forgery attempt.")
        return 6
    if not _result.get("code"):
        print("\n  ABORTED: no authorization code in the callback.")
        return 5

    print("  Authorization received. Exchanging for tokens...")
    tokens = post_form(
        TOKEN_ENDPOINT,
        {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "code": _result["code"],
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )

    return report_tokens(tokens, args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrupted. Nothing was changed.")
        sys.exit(130)
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - report, never dump a credential
        print("\n" + "=" * 68)
        print("UNEXPECTED ERROR -- nothing was changed.")
        print("=" * 68)
        print(f"\n  {type(exc).__name__}: {exc}")
        if "--traceback" in sys.argv:
            import traceback

            print()
            traceback.print_exc()
        else:
            print("\n  Re-run with --traceback for the full Python traceback.")
        print("\n  If the loopback callback is what fails, skip the local server:")
        print("    py .\\scripts\\mint_drive_refresh_token.py --manual")
        print("\n  Report the error line above; it contains no credential material.")
        sys.exit(1)
