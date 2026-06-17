"""Vehicle self-registration and ownership transfer endpoints.

Customers can claim a VIN that already exists in the database (seeded vehicles).
Arbitrary VINs that are not in the system are rejected with 404 — a customer
cannot invent a vehicle. If the VIN belongs to someone else a transfer request
is created for manager review — the old owner retains access until approved.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_principal, require_manager
from app.db.session import get_db
from app.models import AuditLog, Vehicle, VINTransferRequest
from app.schemas import VINClaimRequest, VINClaimResult, VINTransferOut, VehicleOut

router = APIRouter(prefix="/api/v1/vehicles", tags=["vehicles"])


def _audit(db: Session, *, actor: str, action: str, resource_id: str) -> None:
    db.add(AuditLog(actor_type="human", actor_id=actor, action=action,
                    resource_type="vehicle", resource_id=resource_id))


@router.get("", response_model=list[VehicleOut])
def list_my_vehicles(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[Vehicle]:
    return list(db.scalars(
        select(Vehicle).where(Vehicle.customer_id == principal.customer_id)
    ).all())


@router.post("/claim", response_model=VINClaimResult)
def claim_vin(
    req: VINClaimRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> VINClaimResult:
    if principal.role != "customer":
        raise HTTPException(status_code=403, detail="Only customers can claim vehicles.")

    vin = req.vin.strip().upper()
    if len(vin) < 5:
        raise HTTPException(status_code=400, detail="VIN must be at least 5 characters.")

    vehicle = db.get(Vehicle, vin)

    # VIN must already exist in the database (seeded/registered vehicles only).
    if vehicle is None:
        raise HTTPException(
            status_code=404,
            detail="VIN not found. Only vehicles registered in our system can be claimed.",
        )

    # Case 1: already owned by the same customer.
    if vehicle.customer_id == principal.customer_id:
        return VINClaimResult(status="already_owned", vin=vin)

    # Case 3: owned by someone else — create a transfer request.
    # Reject if there's already a pending request from this requester for this VIN.
    existing = db.scalar(
        select(VINTransferRequest).where(
            VINTransferRequest.vin == vin,
            VINTransferRequest.requester_id == principal.customer_id,
            VINTransferRequest.status == "pending",
        )
    )
    if existing:
        return VINClaimResult(status="transfer_requested", vin=vin,
                              transfer_id=existing.id)

    transfer = VINTransferRequest(
        vin=vin,
        requester_id=principal.customer_id,
        current_owner_id=vehicle.customer_id,
        rc_attachment_id=req.rc_attachment_id,
        status="pending",
    )
    db.add(transfer)
    _audit(db, actor=principal.customer_id or "", action="vehicle:transfer-requested",
           resource_id=vin)
    db.commit()
    db.refresh(transfer)
    return VINClaimResult(status="transfer_requested", vin=vin, transfer_id=transfer.id)


# --------------------------------------------------------------------------- #
# Manager: list and decide on transfer requests
# --------------------------------------------------------------------------- #

@router.get("/transfers", response_model=list[VINTransferOut],
            dependencies=[Depends(require_manager)])
def list_transfers(
    status: str | None = None,
    db: Session = Depends(get_db),
) -> list[VINTransferOut]:
    q = select(VINTransferRequest)
    if status:
        q = q.where(VINTransferRequest.status == status)
    else:
        q = q.where(VINTransferRequest.status == "pending")
    rows = db.scalars(q.order_by(VINTransferRequest.requested_at.desc())).all()
    results = []
    for r in rows:
        results.append(VINTransferOut(
            id=r.id,
            vin=r.vin,
            requester_name=r.requester.name if r.requester else "",
            requester_email=r.requester.email if r.requester else "",
            current_owner_id=r.current_owner_id,
            rc_attachment_id=r.rc_attachment_id,
            status=r.status,
            requested_at=r.requested_at,
        ))
    return results


@router.post("/transfers/{transfer_id}/approve", response_model=VINTransferOut)
def approve_transfer(
    transfer_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> VINTransferOut:
    transfer = db.get(VINTransferRequest, transfer_id)
    if transfer is None or transfer.status != "pending":
        raise HTTPException(status_code=404, detail="Transfer not found or already decided.")

    vehicle = db.get(Vehicle, transfer.vin)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Vehicle record no longer exists.")
    vehicle.customer_id = transfer.requester_id

    transfer.status = "approved"
    transfer.decided_at = datetime.now(timezone.utc)
    transfer.decided_by = manager.actor

    _audit(db, actor=manager.actor, action="vehicle:transfer-approved",
           resource_id=transfer.vin)
    db.commit()
    db.refresh(transfer)
    return VINTransferOut(
        id=transfer.id, vin=transfer.vin,
        requester_name=transfer.requester.name if transfer.requester else "",
        requester_email=transfer.requester.email if transfer.requester else "",
        current_owner_id=transfer.current_owner_id,
        rc_attachment_id=transfer.rc_attachment_id,
        status=transfer.status,
        requested_at=transfer.requested_at,
    )


@router.post("/transfers/{transfer_id}/reject", response_model=VINTransferOut)
def reject_transfer(
    transfer_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> VINTransferOut:
    transfer = db.get(VINTransferRequest, transfer_id)
    if transfer is None or transfer.status != "pending":
        raise HTTPException(status_code=404, detail="Transfer not found or already decided.")

    transfer.status = "rejected"
    transfer.decided_at = datetime.now(timezone.utc)
    transfer.decided_by = manager.actor

    _audit(db, actor=manager.actor, action="vehicle:transfer-rejected",
           resource_id=transfer.vin)
    db.commit()
    db.refresh(transfer)
    return VINTransferOut(
        id=transfer.id, vin=transfer.vin,
        requester_name=transfer.requester.name if transfer.requester else "",
        requester_email=transfer.requester.email if transfer.requester else "",
        current_owner_id=transfer.current_owner_id,
        rc_attachment_id=transfer.rc_attachment_id,
        status=transfer.status,
        requested_at=transfer.requested_at,
    )
