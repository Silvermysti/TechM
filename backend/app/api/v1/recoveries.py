"""Supplier cost-recovery workflow (APQC 6.7.4).

A manager generates an AI-drafted recovery claim for an approved, supplier-recoverable
warranty claim, reviews it, sends it, and later marks the money recovered.
Lifecycle: draft -> sent -> recovered.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_manager
from app.db.session import get_db
from app.models import AuditLog, Supplier, SupplierRecovery, WarrantyClaim
from app.schemas import SupplierRecoveryOut
from app.services.supplier_recovery import draft_recovery

router = APIRouter(prefix="/api/v1", tags=["supplier-recovery"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(db: Session, *, actor_id: str, action: str, recovery_id: str,
           after: dict | None = None) -> None:
    db.add(AuditLog(actor_type="human", actor_id=actor_id, action=action,
                    resource_type="supplier_recovery", resource_id=recovery_id,
                    after_state=after))


def _to_out(db: Session, rec: SupplierRecovery) -> SupplierRecoveryOut:
    supplier = db.get(Supplier, rec.supplier_id) if rec.supplier_id else None
    claim = db.get(WarrantyClaim, rec.claim_id)
    return SupplierRecoveryOut(
        id=rec.id,
        claim_id=rec.claim_id,
        claim_number=claim.claim_number if claim else None,
        supplier_id=rec.supplier_id,
        supplier_name=supplier.name if supplier else None,
        amount=rec.amount,
        currency=rec.currency,
        status=rec.status,
        draft_subject=rec.draft_subject,
        draft_body=rec.draft_body,
        created_by=rec.created_by,
        decided_by=rec.decided_by,
        created_at=rec.created_at,
        sent_at=rec.sent_at,
        recovered_at=rec.recovered_at,
    )


@router.post("/claims/{claim_id}/recovery", response_model=SupplierRecoveryOut,
             status_code=201)
def generate_recovery(
    claim_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> SupplierRecoveryOut:
    claim = db.get(WarrantyClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="claim not found")
    if not claim.supplier_recoverable or not claim.supplier_id:
        raise HTTPException(
            status_code=409, detail="claim is not recoverable from a supplier"
        )
    # Recovery only makes sense once the company has committed to paying the claim.
    if claim.status not in ("approved", "paid", "closed"):
        raise HTTPException(
            status_code=409,
            detail="claim must be approved before a supplier recovery can be raised",
        )

    existing = db.scalar(
        select(SupplierRecovery).where(SupplierRecovery.claim_id == claim_id)
    )
    if existing is not None:
        raise HTTPException(
            status_code=409, detail="a recovery already exists for this claim"
        )

    supplier = db.get(Supplier, claim.supplier_id)
    draft = draft_recovery(claim, supplier)

    rec = SupplierRecovery(
        claim_id=claim.id,
        supplier_id=claim.supplier_id,
        # Recover the part cost only — the supplier is liable for their defective part,
        # not our labour. (Intentional; some real chargebacks also bill labour.)
        amount=claim.parts_cost,
        currency=claim.currency,
        status="draft",
        draft_subject=draft.subject,
        draft_body=draft.body,
        created_by=manager.actor,
    )
    db.add(rec)
    _audit(db, actor_id=manager.actor, action="recovery:draft", recovery_id=rec.id,
           after={"claim_id": claim.id, "amount": rec.amount})
    db.commit()
    db.refresh(rec)
    return _to_out(db, rec)


@router.get("/recoveries", response_model=list[SupplierRecoveryOut])
def list_recoveries(
    status: str | None = None,
    db: Session = Depends(get_db),
    _: Principal = Depends(require_manager),
) -> list[SupplierRecoveryOut]:
    q = select(SupplierRecovery)
    if status:
        q = q.where(SupplierRecovery.status == status)
    rows = db.scalars(q.order_by(SupplierRecovery.created_at.desc())).all()
    return [_to_out(db, r) for r in rows]


@router.get("/recoveries/{recovery_id}", response_model=SupplierRecoveryOut)
def get_recovery(
    recovery_id: str,
    db: Session = Depends(get_db),
    _: Principal = Depends(require_manager),
) -> SupplierRecoveryOut:
    rec = db.get(SupplierRecovery, recovery_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="recovery not found")
    return _to_out(db, rec)


@router.post("/recoveries/{recovery_id}/send", response_model=SupplierRecoveryOut)
def send_recovery(
    recovery_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> SupplierRecoveryOut:
    rec = db.get(SupplierRecovery, recovery_id)
    if rec is None or rec.status != "draft":
        raise HTTPException(
            status_code=409, detail="recovery not found or not in draft state"
        )
    rec.status = "sent"
    rec.sent_at = _now()
    rec.decided_by = manager.actor
    _audit(db, actor_id=manager.actor, action="recovery:sent", recovery_id=rec.id,
           after={"status": "sent"})
    db.commit()
    db.refresh(rec)
    return _to_out(db, rec)


@router.post("/recoveries/{recovery_id}/recovered", response_model=SupplierRecoveryOut)
def mark_recovered(
    recovery_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> SupplierRecoveryOut:
    rec = db.get(SupplierRecovery, recovery_id)
    if rec is None or rec.status != "sent":
        raise HTTPException(
            status_code=409, detail="recovery not found or not in sent state"
        )
    rec.status = "recovered"
    rec.recovered_at = _now()

    # Reflect the recovered money back onto the claim record.
    claim = db.get(WarrantyClaim, rec.claim_id)
    if claim is not None:
        claim.recovered_amount = rec.amount

    _audit(db, actor_id=manager.actor, action="recovery:recovered", recovery_id=rec.id,
           after={"status": "recovered", "amount": rec.amount})
    db.commit()
    db.refresh(rec)
    return _to_out(db, rec)
