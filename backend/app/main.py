"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import audit, auth, claims, intake, metrics, parts, recalls, recoveries, stream, tickets, vehicles
from app.api.v1.intake import UPLOAD_DIR  # noqa: F401  (ensures the dir constant is importable)
from app.config import get_settings
from app.db.session import create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from app.services.events import set_loop
    set_loop(asyncio.get_event_loop())
    create_all()
    yield


app = FastAPI(title="After-Sales AI Command Center", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(intake.router)
app.include_router(tickets.router)
app.include_router(claims.router)
app.include_router(audit.router)
app.include_router(recalls.router)
app.include_router(parts.router)
app.include_router(stream.router)
app.include_router(metrics.router)
app.include_router(vehicles.router)
app.include_router(recoveries.router)

# Customer evidence photos + RC documents are private — served behind auth via
# GET /api/v1/attachments/{id}, NOT through a public static mount.
UPLOAD_DIR.mkdir(exist_ok=True)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
