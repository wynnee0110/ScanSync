"""
auth.py
-------
Supabase JWT verification for FastAPI.

Supabase issues HS256 JWTs signed with the project's JWT secret.
We verify the token locally (no Supabase network round-trip needed)
using python-jose, then extract the user's UUID.

Usage in route handlers:
    from backend.auth import get_current_user_id

    @app.post("/export/csv")
    async def export_csv(
        user_id: str = Depends(get_current_user_id),
        ...
    ):
        ...
"""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from jose import JWTError, jwt
    from jose.exceptions import ExpiredSignatureError
except ImportError as exc:
    raise ImportError(
        "python-jose is required. Run: pip install -r requirements.txt"
    ) from exc

try:
    from backend.config import Config, get_config
except ImportError:
    from config import Config, get_config

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=True)

ALGORITHM = "HS256"


def verify_supabase_token(token: str, jwt_secret: str) -> dict:
    """
    Decodes and verifies a Supabase-issued JWT.
    Raises HTTPException(401) on any failure.

    Supabase JWTs carry:
      - sub: user UUID (auth.uid())
      - role: "authenticated"
      - aud: "authenticated"
      - exp: expiry timestamp
    """
    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=[ALGORITHM],
            audience="authenticated",
            options={"verify_at_hash": False},
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please sign in again.",
        )
    except JWTError as exc:
        logger.warning("JWT verification failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing user identifier.",
        )

    return {"user_id": user_id, "payload": payload}


async def get_current_user_id(
    credentials: Annotated[HTTPAuthorizationCredentials, Security(_bearer)],
    config: Annotated[Config, Depends(get_config)],
) -> str:
    """
    FastAPI dependency. Extracts and verifies the caller's Supabase JWT.
    Returns the verified user UUID string.
    In development mode, accepts dev tokens and falls back safely to the active dev operator ID.
    """
    token = credentials.credentials
    if config.is_development and (not token or token.startswith("dev-") or token == "mock-jwt-token" or token == "null"):
        return "46d78253-c007-4b45-b93e-0f2f21cbb123"

    try:
        result = verify_supabase_token(token, config.supabase_jwt_secret)
        return result["user_id"]
    except HTTPException:
        if config.is_development:
            logger.info("Dev authentication fallback applied for token.")
            return "46d78253-c007-4b45-b93e-0f2f21cbb123"
        raise


def get_user_role_context(supabase_client, user_id: str) -> dict:
    """
    Queries memberships & profiles to resolve RBAC role: Superadmin, Organizer, or Volunteer.
    Returns dict containing role flags and access capabilities.
    """
    role = "Volunteer"
    try:
        membership_resp = supabase_client.table("memberships").select("role").eq("user_id", user_id).execute()
        memberships = membership_resp.data or []
        if memberships:
            m_role = memberships[0].get("role")
            if m_role == "superadmin":
                role = "Superadmin"
            elif m_role == "organizer":
                role = "Organizer"
    except Exception as exc:
        logger.warning("Notice fetching membership role for user %s: %s", user_id, exc)

    return {
        "user_id": user_id,
        "role": role,
        "is_superadmin": role == "Superadmin",
        "is_organizer": role == "Organizer",
        "is_volunteer": role == "Volunteer",
    }
