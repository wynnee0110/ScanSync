#!/usr/bin/env python3
"""
get_oauth_token.py
==================
One-time helper to get a Google OAuth2 refresh token for the oauth_user auth mode.

Run this ONCE on your local machine, then paste the printed refresh token into
backend/.env as GOOGLE_OAUTH_REFRESH_TOKEN.

Prerequisites
-------------
1. Go to Google Cloud Console → APIs & Services → Credentials.
2. Create an OAuth 2.0 Client ID (type: Desktop app).
3. Download the JSON and place it at backend/credentials/oauth_client.json
   (this file must NEVER be committed — it is listed in .gitignore).
4. Enable the Google Drive API for your project.

Usage
-----
    cd backend
    python scripts/get_oauth_token.py
"""

import json
import os
import sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("ERROR: google-auth-oauthlib not installed. Run: pip install -r requirements.txt")
    sys.exit(1)

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

BACKEND_DIR = Path(__file__).resolve().parent.parent
CREDENTIALS_FILE = BACKEND_DIR / "credentials" / "oauth_client.json"


def main():
    if not CREDENTIALS_FILE.exists():
        print(f"ERROR: OAuth client JSON not found at {CREDENTIALS_FILE}")
        print()
        print("Steps:")
        print("  1. Google Cloud Console → APIs & Services → Credentials")
        print("  2. Create OAuth 2.0 Client ID (Desktop app)")
        print("  3. Download JSON → save as backend/credentials/oauth_client.json")
        print("  4. Re-run this script")
        sys.exit(1)

    print("Starting OAuth2 authorization flow...")
    print("1. Open the URL printed below in your web browser.")
    print("2. Sign in with the Google account that owns the Drive folder.")
    print("3. Authorize the application.")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(
        port=0,
        prompt="consent",
        access_type="offline",
        open_browser=False,
    )

    print()
    print("=" * 60)
    print("  ✅ Authorization successful!")
    print("=" * 60)
    print()
    print("Add these values to backend/.env:")
    print()
    print(f"  GOOGLE_OAUTH_CLIENT_ID={creds.client_id}")
    print(f"  GOOGLE_OAUTH_CLIENT_SECRET={creds.client_secret}")
    print(f"  GOOGLE_OAUTH_REFRESH_TOKEN={creds.refresh_token}")
    print()
    print("Keep these values secret. NEVER commit backend/.env or oauth_client.json.")


if __name__ == "__main__":
    main()
