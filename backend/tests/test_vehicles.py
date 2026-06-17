"""Tests for user registration and VIN claim / transfer flow."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.db.session import SessionLocal
from app.models import Vehicle

client = TestClient(app)


def _seeded_vin_not_owned_by(customer_id: str) -> str:
    """Return a VIN from seed data that belongs to someone other than customer_id."""
    db = SessionLocal()
    try:
        v = db.scalars(
            select(Vehicle)
            .where(Vehicle.customer_id != customer_id)
            .where(Vehicle.customer_id.isnot(None))
            .limit(1)
        ).first()
        if v is None:
            pytest.skip("No suitable seeded vehicle found")
        return v.vin
    finally:
        db.close()


def _register(name: str, email: str, password: str = "testpass123") -> dict:
    r = client.post("/api/v1/auth/register",
                    json={"name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------- #
# Registration
# --------------------------------------------------------------------------- #

def test_register_new_user():
    data = _register("Test User", "newuser_reg@example.com")
    assert data["role"] == "customer"
    assert data["name"] == "Test User"
    assert "token" in data
    assert data["vehicles"] == []


def test_register_duplicate_email():
    _register("First", "dup_email@example.com")
    r = client.post("/api/v1/auth/register",
                    json={"name": "Second", "email": "dup_email@example.com",
                          "password": "pass"})
    assert r.status_code == 409


def test_registered_user_can_login():
    _register("Login Test", "logintest@example.com", "mypassword")
    r = client.post("/api/v1/auth/login",
                    json={"email": "logintest@example.com", "password": "mypassword"})
    assert r.status_code == 200
    assert r.json()["role"] == "customer"


# --------------------------------------------------------------------------- #
# VIN claim
# --------------------------------------------------------------------------- #

def test_claim_unknown_vin_returns_404():
    """VINs not in the database are rejected — customers cannot invent vehicles."""
    data = _register("VIN Owner", "vinowner@example.com")
    r = client.post("/api/v1/vehicles/claim",
                    json={"vin": "DOESNOTEXIST00000"},
                    headers=_headers(data["token"]))
    assert r.status_code == 404


def test_claim_own_vin_returns_already_owned():
    """Demo customer already owns MA3DEMO00000SWIFT from seed data."""
    r = client.post("/api/v1/auth/login",
                    json={"email": "rajesh.demo@example.com", "password": "demo1234"})
    token = r.json()["token"]
    r = client.post("/api/v1/vehicles/claim",
                    json={"vin": "MA3DEMO00000SWIFT"},
                    headers=_headers(token))
    assert r.json()["status"] == "already_owned"


# --------------------------------------------------------------------------- #
# VIN claim — transfer request
# --------------------------------------------------------------------------- #

def test_claim_other_owners_vin_creates_transfer():
    buyer = _register("New Buyer", "new_buyer@example.com")
    vin = _seeded_vin_not_owned_by(buyer["customer_id"])

    r = client.post("/api/v1/vehicles/claim", json={"vin": vin},
                    headers=_headers(buyer["token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "transfer_requested"
    assert body["transfer_id"] is not None


def test_duplicate_transfer_request_returns_existing():
    buyer = _register("Buyer Dup", "buyerdup@example.com")
    vin = _seeded_vin_not_owned_by(buyer["customer_id"])
    r1 = client.post("/api/v1/vehicles/claim", json={"vin": vin},
                     headers=_headers(buyer["token"]))
    r2 = client.post("/api/v1/vehicles/claim", json={"vin": vin},
                     headers=_headers(buyer["token"]))
    assert r1.json()["transfer_id"] == r2.json()["transfer_id"]


# --------------------------------------------------------------------------- #
# Manager transfer approval / rejection
# --------------------------------------------------------------------------- #

@pytest.fixture()
def manager_headers():
    r = client.post("/api/v1/auth/login",
                    json={"email": "manager@techmahindra.com", "password": "manager123"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_approve_transfer_flips_ownership(manager_headers):
    buyer = _register("Buyer Appr", "buyer_appr@example.com")
    vin = _seeded_vin_not_owned_by(buyer["customer_id"])
    tr = client.post("/api/v1/vehicles/claim", json={"vin": vin},
                     headers=_headers(buyer["token"])).json()

    r = client.post(f"/api/v1/vehicles/transfers/{tr['transfer_id']}/approve",
                    headers=manager_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    db = SessionLocal()
    try:
        v = db.get(Vehicle, vin)
        me = client.get("/api/v1/auth/me", headers=_headers(buyer["token"])).json()
        assert v.customer_id == me["customer_id"]
    finally:
        db.close()


def test_reject_transfer_leaves_original_owner(manager_headers):
    buyer = _register("Buyer Rej", "buyer_rej@example.com")
    vin = _seeded_vin_not_owned_by(buyer["customer_id"])

    db = SessionLocal()
    try:
        original_owner_id = db.get(Vehicle, vin).customer_id
    finally:
        db.close()

    tr = client.post("/api/v1/vehicles/claim", json={"vin": vin},
                     headers=_headers(buyer["token"])).json()
    r = client.post(f"/api/v1/vehicles/transfers/{tr['transfer_id']}/reject",
                    headers=manager_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"

    db = SessionLocal()
    try:
        assert db.get(Vehicle, vin).customer_id == original_owner_id
    finally:
        db.close()


def test_list_pending_transfers(manager_headers):
    buyer = _register("List Buyer", "list_buyer@example.com")
    vin = _seeded_vin_not_owned_by(buyer["customer_id"])
    client.post("/api/v1/vehicles/claim", json={"vin": vin},
                headers=_headers(buyer["token"]))

    r = client.get("/api/v1/vehicles/transfers", headers=manager_headers)
    assert r.status_code == 200
    vins = [t["vin"] for t in r.json()]
    assert vin in vins
