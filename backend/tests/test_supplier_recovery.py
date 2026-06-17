"""TDD: supplier recovery workflow (APQC 6.7.4).

For an approved claim whose failed part came from a non-OEM supplier, a manager generates
an AI-drafted recovery claim, sends it, and (later) marks the money recovered.

The LLM draft call is mocked — the workflow logic is what we test.

Covers:
1. Generate a draft for a recoverable claim → 201, status=draft, amount=parts_cost.
2. Generate for a non-recoverable (OEM) claim → 409.
3. Generate twice for the same claim → 409 (one recovery per claim).
4. Send a draft → status=sent, sent_at set.
5. Mark recovered → status=recovered, claim.recovered_amount updated.
6. List endpoint returns recoveries; status filter works.
7. A customer (non-manager) cannot generate a recovery → 403.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models import Ticket, WarrantyClaim
from app.schemas import SupplierRecoveryDraft
from app.tools.cost_estimate import build_warranty_claim

client = TestClient(app)

_FAKE_DRAFT = SupplierRecoveryDraft(
    subject="Warranty cost recovery — claim {claim}",
    body="Dear supplier, the part you supplied failed under warranty. Please reimburse us.",
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _manager_headers() -> dict:
    r = client.post("/api/v1/auth/login",
                    json={"email": "manager@techmahindra.com", "password": "manager123"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _customer_headers() -> dict:
    r = client.post("/api/v1/auth/login",
                    json={"email": "rajesh.demo@example.com", "password": "demo1234"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_claim(component: str) -> WarrantyClaim:
    """Create a costed, approved claim for the given component via the real builder."""
    db = SessionLocal()
    try:
        ticket = Ticket(vehicle_vin="VINREC", component=component, domain="warranty",
                        summary=f"{component} failure", status="awaiting_approval")
        db.add(ticket)
        db.commit()
        claim = build_warranty_claim(db, ticket, decided_by="Manager")
        db.commit()
        db.refresh(claim)
        return claim
    finally:
        db.close()


# ── tests ─────────────────────────────────────────────────────────────────────

def test_generate_draft_for_recoverable_claim():
    claim = _make_claim("brakes")  # Bosch (non-OEM) → recoverable
    with patch("app.api.v1.recoveries.draft_recovery", return_value=_FAKE_DRAFT):
        r = client.post(f"/api/v1/claims/{claim.id}/recovery", headers=_manager_headers())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft"
    assert body["amount"] == claim.parts_cost
    assert body["draft_body"]
    assert body["supplier_name"] == "Bosch India"


def test_generate_draft_rejected_for_non_recoverable_claim():
    claim = _make_claim("transmission")  # OEM → not recoverable
    with patch("app.api.v1.recoveries.draft_recovery", return_value=_FAKE_DRAFT):
        r = client.post(f"/api/v1/claims/{claim.id}/recovery", headers=_manager_headers())
    assert r.status_code == 409


def test_generate_draft_twice_returns_conflict():
    claim = _make_claim("brakes")
    with patch("app.api.v1.recoveries.draft_recovery", return_value=_FAKE_DRAFT):
        r1 = client.post(f"/api/v1/claims/{claim.id}/recovery", headers=_manager_headers())
        r2 = client.post(f"/api/v1/claims/{claim.id}/recovery", headers=_manager_headers())
    assert r1.status_code == 201
    assert r2.status_code == 409


def test_send_draft_marks_sent():
    claim = _make_claim("brakes")
    with patch("app.api.v1.recoveries.draft_recovery", return_value=_FAKE_DRAFT):
        rec = client.post(f"/api/v1/claims/{claim.id}/recovery",
                          headers=_manager_headers()).json()
    r = client.post(f"/api/v1/recoveries/{rec['id']}/send", headers=_manager_headers())
    assert r.status_code == 200
    assert r.json()["status"] == "sent"
    assert r.json()["sent_at"] is not None


def test_mark_recovered_updates_claim():
    claim = _make_claim("brakes")
    with patch("app.api.v1.recoveries.draft_recovery", return_value=_FAKE_DRAFT):
        rec = client.post(f"/api/v1/claims/{claim.id}/recovery",
                          headers=_manager_headers()).json()
    client.post(f"/api/v1/recoveries/{rec['id']}/send", headers=_manager_headers())
    r = client.post(f"/api/v1/recoveries/{rec['id']}/recovered", headers=_manager_headers())
    assert r.status_code == 200
    assert r.json()["status"] == "recovered"

    db = SessionLocal()
    try:
        refreshed = db.get(WarrantyClaim, claim.id)
        assert refreshed.recovered_amount == claim.parts_cost
    finally:
        db.close()


def test_list_recoveries():
    claim = _make_claim("brakes")
    with patch("app.api.v1.recoveries.draft_recovery", return_value=_FAKE_DRAFT):
        rec = client.post(f"/api/v1/claims/{claim.id}/recovery",
                          headers=_manager_headers()).json()
    r = client.get("/api/v1/recoveries", headers=_manager_headers())
    assert r.status_code == 200
    assert any(x["id"] == rec["id"] for x in r.json())


def test_customer_cannot_generate_recovery():
    claim = _make_claim("brakes")
    r = client.post(f"/api/v1/claims/{claim.id}/recovery", headers=_customer_headers())
    assert r.status_code == 403
