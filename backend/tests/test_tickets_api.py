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


def test_ticket_lifecycle(client, monkeypatch):
    from app.core.langgraph import intake
    from app.services import llm

    monkeypatch.setattr(intake, "default_decider", _fake_intake)
    monkeypatch.setattr(llm, "decide", _fake_decide)

    # 1. submit via guided intake -> enough info -> ticket created
    r = client.post("/api/v1/intake", json={
        "session_id": "s1",
        "message": "My AC failed, VIN MA3DEMO00000SWIFT",
        "vin": "MA3DEMO00000SWIFT",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enough_info"] is True
    ticket_id = body["ticket_id"]
    assert ticket_id

    # 2. ticket is awaiting approval with a recommendation
    r = client.get(f"/api/v1/tickets/{ticket_id}")
    assert r.status_code == 200
    ticket = r.json()
    assert ticket["status"] == "awaiting_approval"
    assert ticket["recommendation"]["decision"] == "approve"
    assert ticket["domain"] == "warranty"

    # 3. it appears in the list
    r = client.get("/api/v1/tickets")
    assert any(t["id"] == ticket_id for t in r.json())

    # 4. manager approves -> resolved
    r = client.post(f"/api/v1/tickets/{ticket_id}/decision",
                    json={"decision": "approve", "actor": "manager"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "resolved"
    assert r.json()["human_decision"] == "approve"


def test_intake_asks_follow_up(client, monkeypatch):
    from app.core.langgraph import intake

    def _needs_more(history):
        return IntakeDecision(enough_info=False,
                              follow_up_question="When did it start?")

    monkeypatch.setattr(intake, "default_decider", _needs_more)

    r = client.post("/api/v1/intake", json={"session_id": "s2",
                                             "message": "Something is wrong"})
    assert r.status_code == 200
    body = r.json()
    assert body["enough_info"] is False
    assert "start" in body["reply"].lower()
    assert body["ticket_id"] is None
