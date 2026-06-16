"""Warranty claim lifecycle: list, detail, pay, close."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_principal, require_manager
from app.db.session import get_db
from app.models import AuditLog, WarrantyClaim
from app.schemas import WarrantyClaimOut

router = APIRouter(prefix="/api/v1", tags=["claims"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(db: Session, *, actor_id: str, action: str, claim_id: str,
           after: dict | None = None) -> None:
    db.add(AuditLog(actor_type="human", actor_id=actor_id, action=action,
                    resource_type="claim", resource_id=claim_id, after_state=after))


@router.get("/claims", response_model=list[WarrantyClaimOut])
def list_claims(
    db: Session = Depends(get_db),
    _: Principal = Depends(require_manager),
) -> list[WarrantyClaim]:
    return list(
        db.scalars(
            select(WarrantyClaim).order_by(WarrantyClaim.submitted_at.desc())
        ).all()
    )


@router.get("/claims/{claim_id}", response_model=WarrantyClaimOut)
def get_claim(
    claim_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> WarrantyClaim:
    claim = db.get(WarrantyClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="claim not found")
    if principal.role != "manager" and claim.customer_id != principal.customer_id:
        raise HTTPException(status_code=404, detail="claim not found")
    return claim


@router.post("/claims/{claim_id}/pay", response_model=WarrantyClaimOut)
def pay_claim(
    claim_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> WarrantyClaim:
    claim = db.get(WarrantyClaim, claim_id)
    if claim is None or claim.status != "approved":
        raise HTTPException(
            status_code=409, detail="claim not found or not in approved state"
        )
    claim.status = "paid"
    claim.paid_at = _now()
    _audit(db, actor_id=manager.actor, action="claim:pay",
           claim_id=claim_id, after={"status": "paid"})
    db.commit()
    db.refresh(claim)
    return claim


@router.post("/claims/{claim_id}/close", response_model=WarrantyClaimOut)
def close_claim(
    claim_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> WarrantyClaim:
    claim = db.get(WarrantyClaim, claim_id)
    if claim is None or claim.status not in ("approved", "paid"):
        raise HTTPException(
            status_code=409, detail="claim not found or not in a closeable state"
        )
    claim.status = "closed"
    _audit(db, actor_id=manager.actor, action="claim:close",
           claim_id=claim_id, after={"status": "closed"})
    db.commit()
    db.refresh(claim)
    return claim
