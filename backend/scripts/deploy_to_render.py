#!/usr/bin/env python3
"""
deploy_to_render.py
===================
Automates creating and deploying a new Render Web Service for ScanSync.
Reads secrets directly from backend/.env and uploads them to Render via its REST API.

Usage:
    python backend/scripts/deploy_to_render.py <RENDER_API_KEY>
"""

import os
import sys
import json
import time
from pathlib import Path

try:
    import requests
    from dotenv import dotenv_values
except ImportError:
    print("Error: Missing requests or python-dotenv. Run: pip install requests python-dotenv")
    sys.exit(1)

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
ENV_PATH = BACKEND_DIR / ".env"
ROOT_ENV_PATH = ROOT_DIR / ".env"

RENDER_API_BASE = "https://api.render.com/v1"

def main():
    if len(sys.argv) < 2:
        print("\nUsage:")
        print("  python backend/scripts/deploy_to_render.py <RENDER_API_KEY>\n")
        print("Get your API Key from: https://dashboard.render.com/u/settings#api-keys\n")
        sys.exit(1)

    api_key = sys.argv[1].strip()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    print("==================================================")
    print("  ScanSync — Automated Render Deployment")
    print("==================================================")

    # 1. Read backend/.env
    if not ENV_PATH.exists():
        print(f"❌ Error: {ENV_PATH} not found.")
        sys.exit(1)

    backend_env = dotenv_values(ENV_PATH)
    print(f"✅ Loaded {len(backend_env)} configuration keys from {ENV_PATH.name}")

    # 2. Get Owner ID
    print("[1/4] Fetching Render account owner ID...")
    res = requests.get(f"{RENDER_API_BASE}/owners?limit=5", headers=headers)
    if res.status_code != 200:
        print(f"❌ Render API Authentication Failed: HTTP {res.status_code}")
        print(res.text)
        sys.exit(1)

    owners = res.json()
    if not owners:
        print("❌ No owner profile found on Render account.")
        sys.exit(1)

    owner_id = owners[0]["owner"]["id"]
    owner_name = owners[0]["owner"]["name"]
    print(f"      Connected to: {owner_name} ({owner_id})")

    # 3. Prepare env vars list for Render
    env_vars_payload = []
    for k, v in backend_env.items():
        if v is not None and not k.startswith("#"):
            env_vars_payload.append({"key": k, "value": v})

    # Ensure required settings
    default_extras = {
        "APP_ENV": "production",
        "LOG_LEVEL": "info",
        "ALLOWED_ORIGINS": "*",
    }
    for k, v in default_extras.items():
        if not any(x["key"] == k for x in env_vars_payload):
            env_vars_payload.append({"key": k, "value": v})

    # 4. Create Web Service
    service_name = f"scansync-api-{int(time.time()) % 10000}"
    print(f"[2/4] Creating new Web Service '{service_name}' on Render...")
    payload = {
        "type": "web_service",
        "name": service_name,
        "ownerId": owner_id,
        "repo": "https://github.com/wynnee0110/ScanSync",
        "branch": "main",
        "rootDir": "backend",
        "serviceDetails": {
            "env": "python",
            "plan": "free",
            "region": "singapore",
            "envSpecificDetails": {
                "buildCommand": "pip install -r requirements.txt",
                "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
            },
            "envVars": env_vars_payload,
        },
    }

    create_res = requests.post(f"{RENDER_API_BASE}/services", headers=headers, json=payload)
    if create_res.status_code not in (200, 201):
        print(f"❌ Failed to create service: HTTP {create_res.status_code}")
        print(create_res.text)
        sys.exit(1)

    service_data = create_res.json()
    service_id = service_data.get("id") or service_data.get("service", {}).get("id")
    live_url = (
        service_data.get("serviceDetails", {}).get("url")
        or service_data.get("service", {}).get("serviceDetails", {}).get("url")
        or f"https://{service_name}.onrender.com"
    )
    print(f"✅ Web Service created successfully!")
    print(f"      Service ID: {service_id}")
    print(f"      Live URL:   {live_url}")

    # Explicitly set env vars via PUT to ensure all secrets are present
    if service_id:
        print("      Setting environment variables...")
        requests.put(
            f"{RENDER_API_BASE}/services/{service_id}/env-vars",
            headers=headers,
            json=env_vars_payload,
        )

    # 5. Update root .env
    print(f"[3/4] Updating root .env with new EXPO_PUBLIC_API_URL...")
    if ROOT_ENV_PATH.exists():
        content = ROOT_ENV_PATH.read_text(encoding="utf-8")
        lines = content.splitlines()
        new_lines = []
        replaced = False
        for line in lines:
            if line.startswith("EXPO_PUBLIC_API_URL="):
                new_lines.append(f"EXPO_PUBLIC_API_URL={live_url}")
                replaced = True
            else:
                new_lines.append(line)
        if not replaced:
            new_lines.append(f"EXPO_PUBLIC_API_URL={live_url}")
        ROOT_ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        print(f"      Updated {ROOT_ENV_PATH.name} -> {live_url}")

    print("\n==================================================")
    print("  🚀 DEPLOYMENT INITIATED")
    print("==================================================")
    print(f"Render is currently building and deploying your backend.")
    print(f"Dashboard URL: https://dashboard.render.com/web/{service_id}")
    print(f"Health check : {live_url}/health (will be 200 OK in ~2 mins)")
    print("==================================================\n")

if __name__ == "__main__":
    main()

