"""Warranty tools — plain Python functions invoked by our agent code.

`is_covered` is pure (no DB) so it is unit-tested directly. `check_warranty`
composes the DB lookups with `is_covered` for use inside the warranty agent.
"""

from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Vehicle, WarrantyPolicy


def add_months(d: date, months: int) -> date:
    """Return the date `months` after `d`, clamping the day to month length."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def is_covered(
    *,
    purchase_date: date,
    duration_months: int,
    covered_components: list[str],
    claim_date: date,
    component: str,
) -> dict:
    """Decide warranty coverage for a component on a given claim date.

    Returns {covered: bool, reason: str, expires_on: date}.
    """
    expires_on = add_months(purchase_date, duration_months)
    covered_lower = {c.lower() for c in covered_components}
    component_l = component.lower()

    if component_l not in covered_lower:
        return {
            "covered": False,
            "reason": f"Component '{component}' is not covered by this warranty policy.",
            "expires_on": expires_on,
        }

    if claim_date > expires_on:
        return {
            "covered": False,
            "reason": (
                f"Warranty expired on {expires_on.isoformat()} "
                f"(claim dated {claim_date.isoformat()})."
            ),
            "expires_on": expires_on,
        }

    return {
        "covered": True,
        "reason": (
            f"Component '{component}' is covered and the warranty is valid "
            f"until {expires_on.isoformat()}."
        ),
        "expires_on": expires_on,
    }


# --------------------------------------------------------------------------- #
# DB-backed helpers
# --------------------------------------------------------------------------- #
def get_vehicle_by_vin(db: Session, vin: str) -> Vehicle | None:
    return db.get(Vehicle, vin)


def get_policy_for_model(db: Session, model: str) -> WarrantyPolicy | None:
    return db.scalar(select(WarrantyPolicy).where(WarrantyPolicy.model == model))


def check_warranty(
    db: Session, *, vin: str, component: str, claim_date: date | None = None
) -> dict:
    """Look up vehicle + policy and return a coverage decision (+context)."""
    claim_date = claim_date or date.today()
    vehicle = get_vehicle_by_vin(db, vin)
    if vehicle is None:
        return {"covered": False, "reason": f"No vehicle found for VIN {vin}.",
                "found": False}

    policy = get_policy_for_model(db, vehicle.model)
    if policy is None:
        return {"covered": False, "reason": f"No warranty policy for {vehicle.model}.",
                "found": True, "model": vehicle.model}

    decision = is_covered(
        purchase_date=vehicle.purchase_date,
        duration_months=policy.duration_months,
        covered_components=policy.covered_components,
        claim_date=claim_date,
        component=component,
    )
    decision.update(
        found=True,
        model=vehicle.model,
        purchase_date=vehicle.purchase_date.isoformat(),
        expires_on=decision["expires_on"].isoformat(),
    )
    return decision
