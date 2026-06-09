"""VIN lookup tools (used by the recall domain in Phase 2)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Vehicle


def find_affected(db: Session, *, model: str, year: int) -> list[str]:
    """Return VINs of all vehicles matching a recall's model + year."""
    rows = db.scalars(
        select(Vehicle.vin).where(Vehicle.model == model, Vehicle.year == year)
    ).all()
    return list(rows)
