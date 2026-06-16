"""Request-scoped auth dependencies.

`get_current_principal` decodes the bearer token into a verified identity. The actor
that ends up in the audit log always comes from here — never from the request body.
Role helpers gate manager-only actions.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.services.security import decode_access_token

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


@dataclass(frozen=True)
class Principal:
    sub: str          # user id (customer.id or staff.id)
    role: str         # "customer" | "manager"
    email: str
    name: str
    customer_id: str | None  # set for customers; None for staff

    @property
    def actor(self) -> str:
        """Stable, human-readable audit identity."""
        return f"{self.role}:{self.email}"


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _UNAUTH
    return authorization.split(" ", 1)[1].strip()


def get_current_principal(authorization: str | None = Header(default=None)) -> Principal:
    token = _bearer(authorization)
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError:
        raise _UNAUTH
    try:
        return Principal(
            sub=claims["sub"],
            role=claims["role"],
            email=claims["email"],
            name=claims.get("name", ""),
            customer_id=claims.get("customer_id"),
        )
    except KeyError:
        raise _UNAUTH


def require_manager(
    principal: Principal = Depends(get_current_principal),
) -> Principal:
    if principal.role != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager role required.",
        )
    return principal
