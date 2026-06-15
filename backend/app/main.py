"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1 import auth, intake, tickets
from app.api.v1.intake import UPLOAD_DIR
from app.config import get_settings
from app.db.session import create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure tables exist (no-op if already created / seeded).
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

# Customer evidence photos (uploaded during intake).
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
