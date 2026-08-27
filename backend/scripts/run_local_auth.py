"""
Automatic local OAuth flow launcher for Google Drive.
Launches InstalledAppFlow locally, receives the OAuth callback,
retrieves the refresh token, and updates backend/.env automatically.
"""
import sys
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

CLIENT_ID = "608390312198-qduh9f3ijhkl4usn3qgki4b76nhmmue2.apps.googleusercontent.com"
CLIENT_SECRET = "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"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]

client_config = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [
            "http://localhost:8080/",
            "http://127.0.0.1:8080/",
            "http://localhost:8000/",
            "https://developers.google.com/oauthplayground",
        ]
    }
}

def main():
    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
    print("\nStarting local OAuth authentication server...")
    print("Please open the link below in your browser, log in, and grant Google Drive access:\n")
    
    # Run local server on port 8080
    creds = flow.run_local_server(port=8080, prompt="consent", access_type="offline")
    
    refresh_token = creds.refresh_token
    print("\nSUCCESS! Retrieved Refresh Token:")
    print(refresh_token)

    if refresh_token:
        # Update backend/.env file
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            content = env_path.read_text(encoding="utf-8")
            lines = content.splitlines()
            new_lines = []
            found = False
            for line in lines:
                if line.startswith("GOOGLE_OAUTH_REFRESH_TOKEN="):
                    new_lines.append(f"GOOGLE_OAUTH_REFRESH_TOKEN={refresh_token}")
                    found = True
                else:
                    new_lines.append(line)
            if not found:
                new_lines.append(f"GOOGLE_OAUTH_REFRESH_TOKEN={refresh_token}")
            env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            print(f"\nSuccessfully updated {env_path}")

if __name__ == "__main__":
    main()
