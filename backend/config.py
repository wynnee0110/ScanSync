"""
config.py
---------
Typed environment configuration for the FastAPI backend.
All values are read from environment variables (set via backend/.env locally
or the hosting provider's secret store in production).

Fails fast at startup if required values are missing or still contain
the placeholder string 'replace-me'.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    pass  # dotenv is optional in production containers
else:
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)


def _require(key: str) -> str:
    value = os.environ.get(key, "")
    if not value or "replace-me" in value:
        raise RuntimeError(
            f"Required environment variable '{key}' is not set. "
            "Copy backend/.env.example to backend/.env and fill in real values."
        )
    return value


def _optional(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


@dataclass(frozen=True)
class Config:
    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str

    # Google Drive
    drive_root_folder_id: str
    drive_auth_mode: str  # "oauth_user" | "service_account"

    # OAuth user mode
    google_oauth_client_id: str
    google_oauth_client_secret: str
    google_oauth_refresh_token: str

    # Service account mode
    google_service_account_json: str
    google_drive_shared_drive_id: str

    # App
    app_env: str
    log_level: str
    allowed_origins: list[str]

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


def load_config() -> Config:
    # Read allowed origins as a comma-separated string and split into a list.
    # If not set, default to ["*"] for backward compatibility.
    allowed_origins_str = _optional("ALLOWED_ORIGINS", "*")
    # Split by comma, strip whitespace, and filter out empty strings.
    allowed_origins_list = [
        origin.strip() for origin in allowed_origins_str.split(",") if origin.strip()
    ]
    # If the resulting list is empty, fall back to ["*"] to avoid blocking all origins.
    if not allowed_origins_list:
        allowed_origins_list = ["*"]

    return Config(
        supabase_url=_require("SUPABASE_URL"),
        supabase_service_role_key=_require("SUPABASE_SERVICE_ROLE_KEY"),
        supabase_jwt_secret=_require("SUPABASE_JWT_SECRET"),
        drive_root_folder_id=_require("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
        drive_auth_mode=_optional("GOOGLE_DRIVE_AUTH_MODE", "oauth_user"),
        google_oauth_client_id=_optional("GOOGLE_OAUTH_CLIENT_ID"),
        google_oauth_client_secret=_optional("GOOGLE_OAUTH_CLIENT_SECRET"),
        google_oauth_refresh_token=_optional("GOOGLE_OAUTH_REFRESH_TOKEN"),
        google_service_account_json=_optional("GOOGLE_SERVICE_ACCOUNT_JSON"),
        google_drive_shared_drive_id=_optional("GOOGLE_DRIVE_SHARED_DRIVE_ID"),
        app_env=_optional("APP_ENV", "production"),
        log_level=_optional("LOG_LEVEL", "info"),
        allowed_origins=allowed_origins_list,
    )


# Module-level singleton — loaded once at import time.
# FastAPI dependency-injected via `Depends(get_config)`.
_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = load_config()
    return _config
