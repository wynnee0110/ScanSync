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
import os
import time
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from jose import JWTError, jwk, jwt
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
ASYMMETRIC_ALGORITHMS = {"ES256", "ES384", "ES512", "RS256", "RS384", "RS512"}
JWKS_CACHE_TTL_SECONDS = 600.0
_jwks_cache: dict[str, tuple[float, list[dict]]] = {}


def _fetch_jwks(supabase_url: str, force_refresh: bool = False) -> list[dict]:
    """Fetches and caches public JWKS keys from Supabase Auth."""
    base_url = supabase_url.strip().rstrip("/")
    if not base_url:
        return []

    now = time.monotonic()
    cached = _jwks_cache.get(base_url)
    if not force_refresh and cached is not None:
        fetched_at, keys = cached
        if now - fetched_at < JWKS_CACHE_TTL_SECONDS:
            return keys

    jwks_url = f"{base_url}/auth/v1/.well-known/jwks.json"
    response = httpx.get(jwks_url, timeout=10.0)
    response.raise_for_status()
    payload = response.json()
    keys = payload.get("keys") if isinstance(payload, dict) else None
    if not isinstance(keys, list):
        return []

    _jwks_cache[base_url] = (now, keys)
    return keys


def _select_jwk(keys: list[dict], kid: str | None) -> dict | None:
    if kid:
        for key in keys:
            if isinstance(key, dict) and key.get("kid") == kid:
                return key
        return None
    if len(keys) == 1 and isinstance(keys[0], dict):
        return keys[0]
    return None


def verify_supabase_token(
    token: str,
    jwt_secret: str,
    supabase_url: str | None = None,
) -> dict:
    """
    Decodes and verifies a Supabase-issued JWT (HS256 or asymmetric JWKS such as ES256).
    Raises HTTPException(401) on any failure.

    Supabase JWTs carry:
      - sub: user UUID (auth.uid())
      - role: "authenticated"
      - aud: "authenticated"
      - exp: expiry timestamp
    """
    alg = ALGORITHM
    kid: str | None = None
    try:
        header = jwt.get_unverified_header(token)
        if isinstance(header, dict):
            alg = str(header.get("alg") or ALGORITHM)
            raw_kid = header.get("kid")
            kid = str(raw_kid) if raw_kid else None
    except JWTError as exc:
        logger.warning("JWT verification failed (alg=%s): %s", alg, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    try:
        if alg == ALGORITHM:
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=[ALGORITHM],
                audience="authenticated",
                options={"verify_at_hash": False},
            )
        elif alg in ASYMMETRIC_ALGORITHMS:
            resolved_url = (supabase_url or os.environ.get("SUPABASE_URL") or "").strip()
            if not resolved_url:
                logger.warning("JWT verification failed (alg=%s): missing SUPABASE_URL", alg)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token.",
                )

            try:
                keys = _fetch_jwks(resolved_url, force_refresh=False)
                matching_key = _select_jwk(keys, kid)
                if matching_key is None:
                    keys = _fetch_jwks(resolved_url, force_refresh=True)
                    matching_key = _select_jwk(keys, kid)
            except HTTPException:
                raise
            except Exception as exc:
                logger.warning("JWT verification failed (alg=%s): %s", alg, type(exc).__name__)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token.",
                )

            if matching_key is None:
                logger.warning("JWT verification failed (alg=%s): matching JWK not found", alg)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token.",
                )

            verification_key = jwk.construct(matching_key, algorithm=alg)
            payload = jwt.decode(
                token,
                verification_key,
                algorithms=[alg],
                audience="authenticated",
                options={"verify_at_hash": False},
            )
        else:
            logger.warning("JWT verification failed (alg=%s): unsupported algorithm", alg)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unsupported authentication token algorithm.",
            )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please sign in again.",
        )
    except HTTPException:
        raise
    except JWTError as exc:
        logger.warning("JWT verification failed (alg=%s): %s", alg, type(exc).__name__)
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
    Dev fallback is only allowed when running in development with ALLOW_DEV_AUTH enabled.
    """
    token = credentials.credentials or ""
    dev_fallback_allowed = (
        config.is_development
        and os.environ.get("ALLOW_DEV_AUTH", "false").lower() in ("true", "1")
    )

    # If real JWT (3 parts separated by dots), verify with Supabase secret or JWKS
    if token and len(token.split(".")) == 3:
        try:
            result = verify_supabase_token(
                token,
                config.supabase_jwt_secret,
                config.supabase_url,
            )
            return result["user_id"]
        except HTTPException:
            if dev_fallback_allowed:
                logger.info("JWT verification failed, applying dev authentication fallback.")
                return "46d78253-c007-4b45-b93e-0f2f21cbb123"
            raise

    # Fallback for dev/mock tokens (e.g. 'dev-operator-token')
    if dev_fallback_allowed and (
        token.startswith("dev-")
        or token == "mock-jwt-token"
        or token == "null"
        or not token
    ):
        return "46d78253-c007-4b45-b93e-0f2f21cbb123"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication token format.",
    )


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
