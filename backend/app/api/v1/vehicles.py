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
from app.models import AuditLog, Customer, Vehicle, VINTransferRequest
from app.schemas import VINClaimRequest, VINClaimResult, VINTransferOut, VehicleOut

router = APIRouter(prefix="/api/v1/vehicles", tags=["vehicles"])

# A transfer is still "in flight" while it sits at either approval step.
_OPEN_STATUSES = ("pending_owner", "pending_manager")


def _audit(db: Session, *, actor: str, action: str, resource_id: str) -> None:
    db.add(AuditLog(actor_type="human", actor_id=actor, action=action,
                    resource_type="vehicle", resource_id=resource_id))


def _to_out(db: Session, t: VINTransferRequest) -> VINTransferOut:
    """Build the API view of a transfer, resolving the current owner's name."""
    owner = db.get(Customer, t.current_owner_id) if t.current_owner_id else None
    return VINTransferOut(
        id=t.id,
        vin=t.vin,
        requester_name=t.requester.name if t.requester else "",
        requester_email=t.requester.email if t.requester else "",
        current_owner_id=t.current_owner_id,
        current_owner_name=owner.name if owner else None,
        rc_attachment_id=t.rc_attachment_id,
        status=t.status,
        requested_at=t.requested_at,
        owner_decided_at=t.owner_decided_at,
    )


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

    # Case 3: owned by someone else — create a transfer request that starts by
    # asking the CURRENT OWNER for consent (then a manager finalizes it).
    # Reject if this requester already has an in-flight request for this VIN.
    existing = db.scalar(
        select(VINTransferRequest).where(
            VINTransferRequest.vin == vin,
            VINTransferRequest.requester_id == principal.customer_id,
            VINTransferRequest.status.in_(_OPEN_STATUSES),
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
        status="pending_owner",
    )
    db.add(transfer)
    _audit(db, actor=principal.customer_id or "", action="vehicle:transfer-requested",
           resource_id=vin)
    db.commit()
    db.refresh(transfer)
    return VINClaimResult(status="transfer_requested", vin=vin, transfer_id=transfer.id)


# --------------------------------------------------------------------------- #
# Step 1 — Current owner: consent to (or refuse) giving up their vehicle
# --------------------------------------------------------------------------- #

@router.get("/transfers/incoming", response_model=list[VINTransferOut])
def list_incoming_transfers(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[VINTransferOut]:
    """Transfer requests awaiting *my* consent as the current owner of the vehicle."""
    if principal.role != "customer":
        raise HTTPException(status_code=403, detail="Customers only.")
    rows = db.scalars(
        select(VINTransferRequest)
        .where(
            VINTransferRequest.current_owner_id == principal.customer_id,
            VINTransferRequest.status == "pending_owner",
        )
        .order_by(VINTransferRequest.requested_at.desc())
    ).all()
    return [_to_out(db, r) for r in rows]


def _load_owner_transfer(
    db: Session, transfer_id: str, principal: Principal
) -> VINTransferRequest:
    """Fetch a transfer that the caller is allowed to decide on as the current owner."""
    if principal.role != "customer":
        raise HTTPException(status_code=403, detail="Customers only.")
    transfer = db.get(VINTransferRequest, transfer_id)
    if transfer is None or transfer.status != "pending_owner":
        raise HTTPException(status_code=404, detail="Transfer not found or already decided.")
    if transfer.current_owner_id != principal.customer_id:
        raise HTTPException(status_code=403, detail="You are not the owner of this vehicle.")
    return transfer


@router.post("/transfers/{transfer_id}/owner-approve", response_model=VINTransferOut)
def owner_approve_transfer(
    transfer_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> VINTransferOut:
    """Owner consents — the request now moves to the manager for final approval."""
    transfer = _load_owner_transfer(db, transfer_id, principal)
    transfer.status = "pending_manager"
    transfer.owner_decided_at = datetime.now(timezone.utc)
    _audit(db, actor=principal.customer_id or "", action="vehicle:transfer-owner-approved",
           resource_id=transfer.vin)
    db.commit()
    db.refresh(transfer)
    return _to_out(db, transfer)


@router.post("/transfers/{transfer_id}/owner-reject", response_model=VINTransferOut)
def owner_reject_transfer(
    transfer_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> VINTransferOut:
    """Owner refuses — the request ends here and never reaches a manager."""
    transfer = _load_owner_transfer(db, transfer_id, principal)
    transfer.status = "rejected"
    transfer.owner_decided_at = datetime.now(timezone.utc)
    transfer.decided_at = datetime.now(timezone.utc)
    transfer.decided_by = f"owner:{principal.customer_id}"
    _audit(db, actor=principal.customer_id or "", action="vehicle:transfer-owner-rejected",
           resource_id=transfer.vin)
    db.commit()
    db.refresh(transfer)
    return _to_out(db, transfer)


# --------------------------------------------------------------------------- #
# Step 2 — Manager: final approval (only after the owner has consented)
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
        # Managers only act on requests the owner has already consented to.
        q = q.where(VINTransferRequest.status == "pending_manager")
    rows = db.scalars(q.order_by(VINTransferRequest.requested_at.desc())).all()
    return [_to_out(db, r) for r in rows]


@router.post("/transfers/{transfer_id}/approve", response_model=VINTransferOut)
def approve_transfer(
    transfer_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> VINTransferOut:
    transfer = db.get(VINTransferRequest, transfer_id)
    # Only owner-consented requests can be finalized by a manager.
    if transfer is None or transfer.status != "pending_manager":
        raise HTTPException(
            status_code=404,
            detail="Transfer not found, already decided, or still awaiting the owner.",
        )

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
    return _to_out(db, transfer)


@router.post("/transfers/{transfer_id}/reject", response_model=VINTransferOut)
def reject_transfer(
    transfer_id: str,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> VINTransferOut:
    transfer = db.get(VINTransferRequest, transfer_id)
    if transfer is None or transfer.status != "pending_manager":
        raise HTTPException(
            status_code=404,
            detail="Transfer not found, already decided, or still awaiting the owner.",
        )

    transfer.status = "rejected"
    transfer.decided_at = datetime.now(timezone.utc)
    transfer.decided_by = manager.actor

    _audit(db, actor=manager.actor, action="vehicle:transfer-rejected",
           resource_id=transfer.vin)
    db.commit()
    db.refresh(transfer)
    return _to_out(db, transfer)
