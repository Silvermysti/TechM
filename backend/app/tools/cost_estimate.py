"""Warranty cost estimation + claim construction.

`estimate_cost` is a pure-ish query: given a component, it reads the claim-code catalog
(standard labor hours + rate) and the part price, and returns a costed breakdown. No
LLM involved — warranty money must be deterministic and auditable.

`build_warranty_claim` turns an approved ticket into a persisted WarrantyClaim with
itemized parts/labor lines, ready for payment and supplier recovery.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ClaimCode,
    PartInventory,
    Supplier,
    Ticket,
    WarrantyClaim,
    WarrantyClaimLine,
)

CURRENCY = "INR"


def estimate_cost(db: Session, *, component: str | None) -> dict:
    """Return a costed breakdown for a component using claim codes + part pricing."""
    comp = (component or "").strip().lower()
    result = {
        "component": comp,
        "fault_code": None,
        "labor_hours": 0.0,
        "labor_rate": 0.0,
        "labor_cost": 0.0,
        "parts_cost": 0.0,
        "part_sku": None,
        "part_name": None,
        "total_cost": 0.0,
        "currency": CURRENCY,
    }
    if not comp:
        return result

    code = db.execute(
        select(ClaimCode).where(func.lower(ClaimCode.component) == comp)
    ).scalars().first()
    if code:
        result["fault_code"] = code.code
        result["labor_hours"] = code.standard_labor_hours
        result["labor_rate"] = code.labor_rate
        result["labor_cost"] = round(code.standard_labor_hours * code.labor_rate, 2)

    part = db.execute(
        select(PartInventory).where(func.lower(PartInventory.component) == comp)
    ).scalars().first()
    if part:
        result["parts_cost"] = round(part.unit_price, 2)
        result["part_sku"] = part.sku
        result["part_name"] = part.part_name

    result["total_cost"] = round(result["labor_cost"] + result["parts_cost"], 2)
    return result


def _claim_number(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    seq = db.execute(select(func.count(WarrantyClaim.id))).scalar_one() + 1
    return f"WC-{year}-{seq:06d}"


def build_warranty_claim(
    db: Session,
    ticket: Ticket,
    *,
    odometer_km: int | None = None,
    decided_by: str | None = None,
    status: str = "approved",
) -> WarrantyClaim:
    """Create and persist a costed WarrantyClaim (+ line items) for a ticket."""
    costing = estimate_cost(db, component=ticket.component)

    # Resolve the supplier from the matching part, for cost-recovery routing.
    supplier_id: str | None = None
    recoverable = False
    if costing["part_sku"]:
        part = db.execute(
            select(PartInventory).where(PartInventory.sku == costing["part_sku"])
        ).scalars().first()
        if part and part.supplier_id:
            supplier_id = part.supplier_id
            supplier = db.get(Supplier, part.supplier_id)
            # Non-OEM supplier parts are recoverable from the vendor.
            recoverable = bool(supplier and not supplier.is_oem)

    approved = status == "approved"
    claim = WarrantyClaim(
        claim_number=_claim_number(db),
        ticket_id=ticket.id,
        vehicle_vin=ticket.vehicle_vin,
        customer_id=ticket.customer_id,
        component=costing["component"] or ticket.component,
        fault_code=costing["fault_code"],
        odometer_km=odometer_km,
        labor_hours=costing["labor_hours"],
        labor_rate=costing["labor_rate"],
        labor_cost=costing["labor_cost"],
        parts_cost=costing["parts_cost"],
        total_cost=costing["total_cost"],
        approved_amount=costing["total_cost"] if approved else None,
        currency=costing["currency"],
        status=status,
        supplier_id=supplier_id,
        supplier_recoverable=recoverable,
        decided_by=decided_by,
        decided_at=datetime.now(timezone.utc),
    )
    db.add(claim)
    db.flush()  # assign claim.id for the lines

    if costing["labor_cost"] > 0:
        db.add(WarrantyClaimLine(
            claim_id=claim.id, line_type="labor", reference=costing["fault_code"] or "",
            description=f"Labor — {costing['component']}",
            quantity=costing["labor_hours"], unit_cost=costing["labor_rate"],
            line_total=costing["labor_cost"],
        ))
    if costing["parts_cost"] > 0:
        db.add(WarrantyClaimLine(
            claim_id=claim.id, line_type="part", reference=costing["part_sku"] or "",
            description=costing["part_name"] or f"Part — {costing['component']}",
            quantity=1.0, unit_cost=costing["parts_cost"],
            line_total=costing["parts_cost"],
        ))

    return claim
