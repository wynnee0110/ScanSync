"""
Helper script to generate Google OAuth Refresh Token.
"""
import sys
import json
import requests
from pathlib import Path

CLIENT_ID = "608390312198-qduh9f3ijhkl4usn3qgki4b76nhmmue2.apps.googleusercontent.com"
CLIENT_SECRET = "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"
REDIRECT_URIS = [
    "http://localhost:8080/",
    "http://127.0.0.1:8080/",
    "https://developers.google.com/oauthplayground",
    "urn:ietf:wg:oauth:2.0:oob"
]

def generate_auth_url():
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": "https://developers.google.com/oauthplayground",
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive.file",
        "access_type": "offline",
        "prompt": "consent",
    }
    req = requests.Request("GET", "https://accounts.google.com/o/oauth2/auth", params=params)
    prepared = req.prepare()
    return prepared.url

def exchange_code(code: str, redirect_uri: str = "https://developers.google.com/oauthplayground"):
    url = "https://oauth2.googleapis.com/token"
    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }
    res = requests.post(url, data=data).json()
    return res

if __name__ == "__main__":
    if len(sys.argv) > 1:
        code_input = sys.argv[1].strip()
        redirect_uri = sys.argv[2].strip() if len(sys.argv) > 2 else "https://developers.google.com/oauthplayground"
        res = exchange_code(code_input, redirect_uri)
        print("EXCHANGE_RESULT:")
        print(json.dumps(res, indent=2))
    else:
        print("AUTH_URL:")
        print(generate_auth_url())
