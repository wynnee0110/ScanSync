"""
main.py
-------
FastAPI application entry point.

Endpoints:
  GET  /health              — liveness check (no auth)
  POST /export/csv          — generate CSV and upload to Drive
  GET  /export/csv/status/{job_id} — poll job status

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000

Dev health check:
    curl http://localhost:8000/health
"""

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from backend.auth import get_current_user_id
    from backend.config import Config, get_config
    from backend.export_service import run_csv_export
    from backend.operator_service import (
        create_or_update_operator,
        delete_operator,
        fetch_all_operators,
    )
except ImportError:
    from auth import get_current_user_id
    from config import Config, get_config
    from export_service import run_csv_export
    from operator_service import (
        create_or_update_operator,
        delete_operator,
        fetch_all_operators,
    )

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Render Keep-Alive Background Task
# ---------------------------------------------------------------------------
async def _self_ping_loop():
    """Background task that pings the Render service every 10 minutes to prevent sleep."""
    await asyncio.sleep(15)  # Wait 15s after startup before first ping
    url = "https://scansync-lius.onrender.com/health"
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                res = await client.get(url)
                logger.info("[Keep-Alive] Self-ping to %s -> %d", url, res.status_code)
            except Exception as exc:
                logger.warning("[Keep-Alive] Notice pinging %s: %s", url, exc)
            await asyncio.sleep(600)  # Ping every 10 minutes (600s)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ping_task = asyncio.create_task(_self_ping_loop())
    yield
    ping_task.cancel()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ScanSync API",
    description="Privileged backend for ICpEP.SE ScanSync: export jobs, report generation, and Google Drive management.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class ExportCsvRequest(BaseModel):
    event_id: str = Field(..., description="Supabase event UUID to export attendance for.")
    idempotency_key: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Client-generated UUID. Re-submitting the same key returns the cached result.",
    )


class ExportCsvResponse(BaseModel):
    job_id: str
    file_id: str
    web_link: str
    row_count: int
    cached: bool


class HealthResponse(BaseModel):
    status: str
    version: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    """Liveness check. Returns 200 when the server is running."""
    return HealthResponse(status="ok", version="0.1.0")


@app.post(
    "/export/csv",
    response_model=ExportCsvResponse,
    status_code=status.HTTP_200_OK,
    tags=["Export"],
    summary="Generate attendance CSV and upload to Google Drive",
    description=(
        "Authorized organizers and superadmins can request a CSV export for any event "
        "they manage. The CSV is generated from the current Supabase attendance snapshot "
        "and uploaded to the configured Google Drive root folder under an event subfolder. "
        "Re-submitting the same `idempotency_key` returns the cached result without re-running."
    ),
)
def export_csv(
    body: ExportCsvRequest,
    user_id: Annotated[str, Depends(get_current_user_id)],
    config: Annotated[Config, Depends(get_config)],
):
    """
    POST /export/csv
    Authorization: Bearer <supabase_access_token>
    """
    logger.info("Export CSV requested: event=%s user=%s", body.event_id, user_id)

    try:
        result = run_csv_export(
            config=config,
            user_id=user_id,
            event_id=body.event_id,
            idempotency_key=body.idempotency_key,
        )
    except PermissionError as exc:
        logger.warning("Unauthorized export attempt: user=%s event=%s", user_id, body.event_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to export this event.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        # Log without PII. Return detail in dev mode for easy diagnosis.
        logger.exception("Unexpected error during CSV export: event=%s", body.event_id)
        error_msg = str(exc) if config.is_development else "Export failed due to an internal error. Please try again."
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg,
        ) from exc

    logger.info(
        "Export complete: job=%s rows=%d cached=%s",
        result["job_id"],
        result["row_count"],
        result["cached"],
    )
    return ExportCsvResponse(**result)


# ---------------------------------------------------------------------------
# Operator Management Routes (Server-side API)
# ---------------------------------------------------------------------------
class OperatorPayload(BaseModel):
    id: str | None = None
    name: str
    email: str
    role: str
    password: str | None = None
    assignedEventId: str | None = None
    assignedEventName: str | None = None
    generatedPasswordCode: str | None = None
    createdBy: str | None = None


@app.get("/api/operators", tags=["Operators"])
def get_operators(
    user_id: Annotated[str, Depends(get_current_user_id)],
    config: Annotated[Config, Depends(get_config)],
):
    try:
        return fetch_all_operators(config, actor_id=user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator access is not permitted.") from exc
    except Exception as exc:
        logger.exception("Error in GET /api/operators")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@app.post("/api/operators", tags=["Operators"])
def save_operator(body: OperatorPayload, config: Annotated[Config, Depends(get_config)]):
    try:
        return create_or_update_operator(config, body.model_dump())
    except Exception as exc:
        logger.exception("Error in POST /api/operators")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@app.delete("/api/operators/{operator_id}", tags=["Operators"])
def remove_operator(
    operator_id: str,
    user_id: Annotated[str, Depends(get_current_user_id)],
    config: Annotated[Config, Depends(get_config)],
):
    try:
        return delete_operator(config, operator_id)
    except Exception as exc:
        logger.exception("Error in DELETE /api/operators/{operator_id} requested by %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

