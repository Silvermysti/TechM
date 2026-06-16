"""Password hashing and JWT issuance/verification.

Password hashing uses the standard-library PBKDF2-HMAC-SHA256 (no native build
dependency). Tokens are signed JWTs (HS256) carrying the caller's identity and role,
so the API never trusts a client-supplied actor.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.config import get_settings

_ALGO = "HS256"
_PBKDF2_ROUNDS = 200_000


# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds_s, salt_s, hash_s = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), _unb64(salt_s), int(rounds_s)
        )
        return hmac.compare_digest(dk, _unb64(hash_s))
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def create_access_token(claims: dict[str, Any]) -> str:
    settings = get_settings()
    payload = dict(claims)
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_expire_minutes
    )
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGO)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode + verify a token. Raises jwt.PyJWTError on any problem."""
    return jwt.decode(
        token, get_settings().jwt_secret, algorithms=[_ALGO]
    )
