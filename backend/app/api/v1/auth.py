"""Login endpoint — password-verified, returns a signed JWT.

Staff are checked first (internal users), then seeded customers. The token carries
role + identity so every downstream action is attributable and authorizable without
trusting any client-supplied actor field.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_principal
from app.db.session import get_db
from app.models import Customer, Staff, Vehicle
from app.schemas import LoginRequest, LoginResponse, MeResponse, RegisterRequest, VehicleOut
from app.services.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_BAD_CREDS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid email or password.",
)


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    email = req.email.strip().lower()

    # Staff first.
    staff = db.scalar(select(Staff).where(func.lower(Staff.email) == email))
    if staff:
        if not verify_password(req.password, staff.password_hash):
            raise _BAD_CREDS
        token = create_access_token(
            {"sub": staff.id, "role": staff.role, "email": staff.email,
             "name": staff.name, "customer_id": None}
        )
        return LoginResponse(token=token, role="manager", name=staff.name,
                             email=staff.email)

    # Otherwise a seeded customer.
    customer = db.scalar(select(Customer).where(func.lower(Customer.email) == email))
    if customer is None or not verify_password(req.password, customer.password_hash):
        raise _BAD_CREDS

    vehicles = db.scalars(
        select(Vehicle).where(Vehicle.customer_id == customer.id)
    ).all()
    token = create_access_token(
        {"sub": customer.id, "role": "customer", "email": customer.email,
         "name": customer.name, "customer_id": customer.id}
    )
    return LoginResponse(
        token=token, role="customer", name=customer.name, email=customer.email,
        customer_id=customer.id,
        vehicles=[VehicleOut.model_validate(v) for v in vehicles],
    )


@router.post("/register", response_model=LoginResponse, status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> LoginResponse:
    email = req.email.strip().lower()
    if db.scalar(select(Customer).where(func.lower(Customer.email) == email)):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    customer = Customer(
        name=req.name.strip(),
        email=email,
        phone=req.phone.strip(),
        password_hash=hash_password(req.password),
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    token = create_access_token(
        {"sub": customer.id, "role": "customer", "email": customer.email,
         "name": customer.name, "customer_id": customer.id}
    )
    return LoginResponse(token=token, role="customer", name=customer.name,
                         email=customer.email, customer_id=customer.id, vehicles=[])


@router.get("/me", response_model=MeResponse)
def me(principal: Principal = Depends(get_current_principal),
       db: Session = Depends(get_db)) -> MeResponse:
    """Validate the stored token and return the caller's identity (+ vehicles)."""
    vehicles: list[VehicleOut] = []
    if principal.customer_id:
        rows = db.scalars(
            select(Vehicle).where(Vehicle.customer_id == principal.customer_id)
        ).all()
        vehicles = [VehicleOut.model_validate(v) for v in rows]
    return MeResponse(role=principal.role, name=principal.name, email=principal.email,
                      customer_id=principal.customer_id, vehicles=vehicles)
