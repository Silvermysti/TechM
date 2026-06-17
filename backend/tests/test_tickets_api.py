"""TDD: ticket lifecycle through the HTTP API.

submit (guided intake) -> ticket awaiting approval with a recommendation ->
manager approves -> ticket resolved. LLM calls (intake decider + warranty) are faked.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import ExtractedFields, IntakeDecision


@pytest.fixture
def client():
    return TestClient(app)


def _auth(client, email: str, password: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def customer_headers(client):
    return _auth(client, "rajesh.demo@example.com", "demo1234")


@pytest.fixture
def manager_headers(client):
    return _auth(client, "manager@techmahindra.com", "manager123")


def _fake_decide(schema, system, user, **kwargs):
    from app.schemas import FraudAssessment, WarrantyRecommendation

    if schema is FraudAssessment:
        return FraudAssessment(fraud_risk=0.1, reasoning="nominal")
    if schema is WarrantyRecommendation:
        return WarrantyRecommendation(
            decision="approve", confidence=0.95, reasoning="covered",
            draft_email="Approved.",
        )
    raise AssertionError(schema)


def _fake_intake(history):
    return IntakeDecision(
        enough_info=True, domain="warranty", apqc_process="6.7.3",
        summary="AC failure 3 months after purchase",
        extracted=ExtractedFields(vin="MA3DEMO00000SWIFT", component="ac"),
    )


def test_ticket_lifecycle(client, customer_headers, manager_headers, monkeypatch):
    from app.core.langgraph import intake
    from app.services import llm

    monkeypatch.setattr(intake, "default_decider", _fake_intake)
    monkeypatch.setattr(llm, "decide", _fake_decide)

    # 1. submit via guided intake -> enough info -> ticket created
    r = client.post("/api/v1/intake", json={
        "session_id": "s1",
        "message": "My AC failed, VIN MA3DEMO00000SWIFT",
        "vin": "MA3DEMO00000SWIFT",
    }, headers=customer_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enough_info"] is True
    ticket_id = body["ticket_id"]
    assert ticket_id

    # 2. ticket is awaiting approval (AC repair cost exceeds the auto-approve cap, so
    #    tiered autonomy routes it to a human). Customer gets a redacted view.
    r = client.get(f"/api/v1/tickets/{ticket_id}", headers=customer_headers)
    assert r.status_code == 200
    ticket = r.json()
    assert ticket["status"] == "awaiting_approval"
    assert ticket["domain"] == "warranty"
    # recommendation / agent_trace not exposed to customers
    assert "recommendation" not in ticket
    assert "agent_trace" not in ticket

    # manager can see the full ticket including recommendation
    r = client.get(f"/api/v1/tickets/{ticket_id}", headers=manager_headers)
    assert r.status_code == 200
    full = r.json()
    assert full["recommendation"]["decision"] == "approve"

    # 3. it appears in the list
    r = client.get("/api/v1/tickets", headers=customer_headers)
    assert any(t["id"] == ticket_id for t in r.json())

    # 4. manager approves -> resolved
    r = client.post(f"/api/v1/tickets/{ticket_id}/decision",
                    json={"decision": "approve"}, headers=manager_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "resolved"
    assert r.json()["human_decision"] == "approve"


def test_escalated_ticket_can_still_be_resolved(client, customer_headers,
                                                 manager_headers, monkeypatch):
    """Escalate must not be a dead-end: it re-queues, and a later approve resolves it."""
    from app.core.langgraph import intake
    from app.services import llm

    monkeypatch.setattr(intake, "default_decider", _fake_intake)
    monkeypatch.setattr(llm, "decide", _fake_decide)

    r = client.post("/api/v1/intake", json={
        "session_id": "esc1", "message": "AC failed", "vin": "MA3DEMO00000SWIFT",
    }, headers=customer_headers)
    ticket_id = r.json()["ticket_id"]

    # manager escalates -> ticket moves to 'escalated', NOT terminal
    r = client.post(f"/api/v1/tickets/{ticket_id}/decision",
                    json={"decision": "escalate"}, headers=manager_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "escalated"

    # a (senior) manager can still act on the escalated ticket -> resolved
    r = client.post(f"/api/v1/tickets/{ticket_id}/decision",
                    json={"decision": "approve"}, headers=manager_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "resolved"
    assert r.json()["human_decision"] == "approve"


def test_customer_list_is_redacted(client, customer_headers, manager_headers, monkeypatch):
    """GET /tickets must not leak fraud scores / agent reasoning to customers."""
    from app.core.langgraph import intake
    from app.services import llm

    monkeypatch.setattr(intake, "default_decider", _fake_intake)
    monkeypatch.setattr(llm, "decide", _fake_decide)

    client.post("/api/v1/intake", json={
        "session_id": "red1", "message": "AC failed", "vin": "MA3DEMO00000SWIFT",
    }, headers=customer_headers)

    rows = client.get("/api/v1/tickets", headers=customer_headers).json()
    assert rows, "customer should see their own tickets"
    for t in rows:
        assert "agent_trace" not in t
        assert "recommendation" not in t


def test_intake_asks_follow_up(client, customer_headers, monkeypatch):
    from app.core.langgraph import intake

    def _needs_more(history):
        return IntakeDecision(enough_info=False,
                              follow_up_question="When did it start?")

    monkeypatch.setattr(intake, "default_decider", _needs_more)

    r = client.post("/api/v1/intake", json={"session_id": "s2",
                                             "message": "Something is wrong"},
                    headers=customer_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["enough_info"] is False
    assert "start" in body["reply"].lower()
    assert body["ticket_id"] is None


def test_endpoints_require_auth(client):
    assert client.get("/api/v1/tickets").status_code == 401
    assert client.post("/api/v1/intake",
                       json={"session_id": "x", "message": "hi"}).status_code == 401


def test_customer_cannot_decide(client, customer_headers, monkeypatch):
    from app.core.langgraph import intake
    from app.services import llm
    monkeypatch.setattr(intake, "default_decider", _fake_intake)
    monkeypatch.setattr(llm, "decide", _fake_decide)

    r = client.post("/api/v1/intake", json={
        "session_id": "s3", "message": "AC failed", "vin": "MA3DEMO00000SWIFT",
    }, headers=customer_headers)
    ticket_id = r.json()["ticket_id"]

    # A customer must not be able to approve/reject.
    r = client.post(f"/api/v1/tickets/{ticket_id}/decision",
                    json={"decision": "approve"}, headers=customer_headers)
    assert r.status_code == 403
