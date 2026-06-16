"""Recall management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_manager
from app.db.session import get_db
from app.models import Recall, Vehicle
from app.schemas import RecallOut, TicketOut
from app.services.graph_runner import trigger_recall

router = APIRouter(prefix="/api/v1", tags=["recalls"])


def _enrich(db: Session, recall: Recall) -> RecallOut:
    affected = db.execute(
        select(func.count(Vehicle.vin)).where(
            Vehicle.model == recall.model,
            Vehicle.year == recall.year,
        )
    ).scalar_one()
    out = RecallOut.model_validate(recall)
    out.affected_count = affected
    return out


@router.get("/recalls", response_model=list[RecallOut])
def list_recalls(
    db: Session = Depends(get_db),
    _: Principal = Depends(require_manager),
) -> list[RecallOut]:
    recalls = db.scalars(select(Recall).order_by(Recall.status)).all()
    return [_enrich(db, r) for r in recalls]


@router.post("/recalls/{recall_id}/trigger", response_model=TicketOut)
def trigger(
    recall_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> object:
    recall = db.get(Recall, recall_id)
    if recall is None:
        raise HTTPException(status_code=404, detail="recall not found")
    if recall.status not in ("open", "active"):
        raise HTTPException(status_code=409, detail="recall is not in a triggerable state")
    try:
        ticket = trigger_recall(db, recall_id=recall_id, actor=manager.actor)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ticket
