"""Responsible-party determination (APQC 6.7.3.4).

Decides who bears the cost of a warranty repair so the system knows whether the cost is
recoverable from a supplier (APQC 6.7.4) or absorbed by the manufacturer:

- **supplier**      — the failed component is a non-OEM vendor part; cost is recoverable.
- **manufacturer**  — an OEM / in-house part, or no external part maps to the component.
- **indeterminate** — no component identified.

Deterministic, no LLM: like cost estimation, money routing must be auditable. The result
feeds both the pipeline reasoning chain and the persisted WarrantyClaim.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import PartInventory, Supplier


def determine_responsible_party(db: Session, *, component: str | None) -> dict:
    """Return who bears the warranty cost for a component, with reasoning."""
    comp = (component or "").strip().lower()
    result = {
        "party": "indeterminate",
        "recoverable_from_supplier": False,
        "supplier_id": None,
        "supplier_name": None,
        "is_oem": None,
        "reasoning": "",
    }

    if not comp:
        result["reasoning"] = (
            "No component identified; responsible party cannot be determined."
        )
        return result

    part = db.execute(
        select(PartInventory).where(func.lower(PartInventory.component) == comp)
    ).scalars().first()

    if part is None or part.supplier_id is None:
        result["party"] = "manufacturer"
        result["reasoning"] = (
            f"No external supplier part maps to '{comp}'; treated as a manufacturer "
            f"(workmanship/in-house) responsibility, not recoverable from a supplier."
        )
        return result

    supplier = db.get(Supplier, part.supplier_id)
    result["supplier_id"] = part.supplier_id
    result["supplier_name"] = supplier.name if supplier else None
    result["is_oem"] = bool(supplier and supplier.is_oem)

    if supplier is not None and not supplier.is_oem:
        result["party"] = "supplier"
        result["recoverable_from_supplier"] = True
        result["reasoning"] = (
            f"The {part.part_name} is supplied by {supplier.name} (non-OEM); the cost "
            f"is recoverable from the supplier under APQC 6.7.4."
        )
    else:
        result["party"] = "manufacturer"
        result["reasoning"] = (
            f"The {part.part_name} is an OEM / in-house part "
            f"({supplier.name if supplier else 'unknown supplier'}); the manufacturer "
            f"bears the cost and it is not recoverable from a supplier."
        )

    return result
