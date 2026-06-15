"""Demo login endpoint.

Not a security system — a lightweight identity resolver so every action can be
attributed to a real person in the audit log. A customer signs in with the email on
their seeded account; staff sign in with a known internal address.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Customer, Vehicle
from app.schemas import LoginRequest, LoginResponse, VehicleOut

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Fixed internal staff accounts (email -> display name). Demo only.
_STAFF: dict[str, str] = {
    "manager@techmahindra.com": "Ops Manager",
}


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    email = req.email.strip().lower()

    # Staff first.
    if email in _STAFF:
        return LoginResponse(role="manager", name=_STAFF[email], email=email)

    # Otherwise resolve a seeded customer by email (case-insensitive).
    customer = db.scalar(
        select(Customer).where(func.lower(Customer.email) == email)
    )
    if customer is None:
        raise HTTPException(status_code=401, detail="No account found for that email.")

    vehicles = db.scalars(
        select(Vehicle).where(Vehicle.customer_id == customer.id)
    ).all()

    return LoginResponse(
        role="customer",
        name=customer.name,
        email=customer.email,
        customer_id=customer.id,
        vehicles=[VehicleOut.model_validate(v) for v in vehicles],
    )
