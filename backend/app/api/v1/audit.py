"""Searchable audit log — manager-only."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_manager
from app.db.session import get_db
from app.models import AuditLog
from app.schemas import AuditLogOut

router = APIRouter(prefix="/api/v1", tags=["audit"])


@router.get("/audit", response_model=list[AuditLogOut])
def list_audit(
    ticket_id: str | None = Query(None),
    actor_type: str | None = Query(None),
    action: str | None = Query(None),
    from_date: datetime | None = Query(None),
    to_date: datetime | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_manager),
) -> list[AuditLog]:
    q = select(AuditLog).order_by(AuditLog.timestamp.desc())
    if ticket_id:
        q = q.where(AuditLog.resource_id == ticket_id)
    if actor_type:
        q = q.where(AuditLog.actor_type == actor_type)
    if action:
        q = q.where(AuditLog.action.contains(action))
    if from_date:
        q = q.where(AuditLog.timestamp >= from_date)
    if to_date:
        q = q.where(AuditLog.timestamp <= to_date)
    return list(db.scalars(q.offset(offset).limit(limit)).all())
