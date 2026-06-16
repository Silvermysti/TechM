"""TDD: recall domain nodes + recall trigger."""

from app.core.langgraph.domains.recall import recall_assess, recall_draft_comms
from app.schemas import RecallAssessment, RecallComms


def _fake_decide(schema, system, user, **kwargs):
    if schema is RecallAssessment:
        return RecallAssessment(
            severity="high",
            recommended_action="notify",
            reasoning="Brake failure under load is a safety-critical defect.",
            timeline_days=7,
        )
    if schema is RecallComms:
        return RecallComms(
            subject="Important safety notice — Honda City 2023 brakes",
            body="Dear customer, please book a free inspection at your dealer.",
            urgency="urgent",
        )
    raise AssertionError(f"unexpected schema {schema}")


def test_recall_assess_finds_affected_vehicles(monkeypatch):
    from app.services import llm
    monkeypatch.setattr(llm, "decide", _fake_decide)

    # Use the seeded recall record.
    from app.db.session import SessionLocal
    from app.models import Recall
    db = SessionLocal()
    try:
        recall = db.execute(
            __import__("sqlalchemy").select(Recall).where(Recall.code == "RC-2026-BRK01")
        ).scalars().first()
        assert recall is not None, "seed must include RC-2026-BRK01"
        recall_id = recall.id
    finally:
        db.close()

    state = {
        "request_id": "recall-t1",
        "domain": "recall",
        "component": "brakes",
        "summary": "Recall assessment for brakes",
        "context": {"recall_id": recall_id},
    }
    result = recall_assess(state)
    assert result["recommendation"]["severity"] == "high"
    assert result["context"]["affected_count"] >= 6  # seeded 6 Honda City 2023 VINs
    assert len(result["agent_outputs"]) == 1
    assert result["agent_outputs"][0]["agent"] == "Recall Safety Analyst"


def test_recall_draft_comms_produces_letter(monkeypatch):
    from app.services import llm
    monkeypatch.setattr(llm, "decide", _fake_decide)

    state = {
        "request_id": "recall-t1",
        "domain": "recall",
        "component": "brakes",
        "summary": "Recall assessment",
        "recommendation": {
            "decision": "escalate",
            "confidence": 0.9,
            "reasoning": "Safety defect",
            "draft_email": "",
            "severity": "high",
        },
        "context": {
            "recall": {
                "code": "RC-2026-BRK01",
                "model": "Honda City",
                "year": 2023,
                "component": "brakes",
                "description": "Brake caliper may seize.",
            },
            "assessment": {"severity": "high", "recommended_action": "notify",
                           "timeline_days": 7},
        },
        "agent_outputs": [],
    }
    result = recall_draft_comms(state)
    assert "draft_email" in result["recommendation"]
    assert "Honda City" in result["recommendation"]["draft_email"] or \
           result["recommendation"]["urgency"] in ("routine", "urgent", "emergency")
    assert result["agent_outputs"][0]["agent"] == "Customer Communications Specialist"
