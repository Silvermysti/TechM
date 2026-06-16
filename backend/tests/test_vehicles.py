"""Tests for user registration and VIN claim / transfer flow."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models import Vehicle

client = TestClient(app)


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
# VIN claim — new VIN (auto-register)
# --------------------------------------------------------------------------- #

def test_claim_new_vin_auto_registers():
    data = _register("VIN Owner", "vinowner@example.com")
    token = data["token"]
    r = client.post("/api/v1/vehicles/claim",
                    json={"vin": "TESTVIN0000000001"},
                    headers=_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "registered"
    assert body["vin"] == "TESTVIN0000000001"


def test_claim_own_vin_returns_already_owned():
    data = _register("Already Owner", "alreadyowner@example.com")
    token = data["token"]
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000002"},
                headers=_headers(token))
    r = client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000002"},
                    headers=_headers(token))
    assert r.json()["status"] == "already_owned"


# --------------------------------------------------------------------------- #
# VIN claim — transfer request
# --------------------------------------------------------------------------- #

def test_claim_other_owners_vin_creates_transfer():
    owner = _register("Original Owner", "orig_owner@example.com")
    buyer = _register("New Buyer", "new_buyer@example.com")

    # Owner registers the VIN first
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000003"},
                headers=_headers(owner["token"]))

    # Buyer claims it → transfer request
    r = client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000003"},
                    headers=_headers(buyer["token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "transfer_requested"
    assert body["transfer_id"] is not None


def test_duplicate_transfer_request_returns_existing():
    owner = _register("Owner Dup", "ownerdup@example.com")
    buyer = _register("Buyer Dup", "buyerdup@example.com")
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000004"},
                headers=_headers(owner["token"]))
    r1 = client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000004"},
                     headers=_headers(buyer["token"]))
    r2 = client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000004"},
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
    owner = _register("Seller", "seller_appr@example.com")
    buyer = _register("Buyer", "buyer_appr@example.com")
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000005"},
                headers=_headers(owner["token"]))
    tr = client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000005"},
                     headers=_headers(buyer["token"])).json()

    r = client.post(f"/api/v1/vehicles/transfers/{tr['transfer_id']}/approve",
                    headers=manager_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    # Vehicle now belongs to buyer
    db = SessionLocal()
    try:
        v = db.get(Vehicle, "TESTVIN0000000005")
        assert v is not None
        # buyer's customer_id is in the token — extract from /me
        me = client.get("/api/v1/auth/me", headers=_headers(buyer["token"])).json()
        assert v.customer_id == me["customer_id"]
    finally:
        db.close()


def test_reject_transfer_leaves_original_owner(manager_headers):
    owner = _register("Seller Rej", "seller_rej@example.com")
    buyer = _register("Buyer Rej", "buyer_rej@example.com")
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000006"},
                headers=_headers(owner["token"]))
    tr = client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000006"},
                     headers=_headers(buyer["token"])).json()

    r = client.post(f"/api/v1/vehicles/transfers/{tr['transfer_id']}/reject",
                    headers=manager_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"

    # Vehicle still belongs to original owner
    db = SessionLocal()
    try:
        v = db.get(Vehicle, "TESTVIN0000000006")
        me = client.get("/api/v1/auth/me", headers=_headers(owner["token"])).json()
        assert v.customer_id == me["customer_id"]
    finally:
        db.close()


def test_list_pending_transfers(manager_headers):
    owner = _register("List Owner", "list_owner@example.com")
    buyer = _register("List Buyer", "list_buyer@example.com")
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000007"},
                headers=_headers(owner["token"]))
    client.post("/api/v1/vehicles/claim", json={"vin": "TESTVIN0000000007"},
                headers=_headers(buyer["token"]))

    r = client.get("/api/v1/vehicles/transfers", headers=manager_headers)
    assert r.status_code == 200
    vins = [t["vin"] for t in r.json()]
    assert "TESTVIN0000000007" in vins
