"""
Generate OAuth URLs for various redirect URIs
"""
import requests

CLIENT_ID = "608390312198-qduh9f3ijhkl4usn3qgki4b76nhmmue2.apps.googleusercontent.com"
CLIENT_SECRET = "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"

redirects = [
    ("Localhost 8080", "http://localhost:8080/"),
    ("Localhost 8000", "http://localhost:8000/"),
    ("OAuth Playground", "https://developers.google.com/oauthplayground"),
    ("127.0.0.1 8080", "http://127.0.0.1:8080/"),
]

for name, r_uri in redirects:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": r_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive.file",
        "access_type": "offline",
        "prompt": "consent",
    }
    req = requests.Request("GET", "https://accounts.google.com/o/oauth2/auth", params=params)
    print(f"=== {name} ===")
    print(req.prepare().url)
    print()
