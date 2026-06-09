"""TDD: orchestrator routing + full pause/resume cycle.

Routing is a pure function (no LLM). The pause/resume test monkeypatches the LLM
`decide` call so the real LangGraph graph runs without a network model. The DB is the
seeded temp SQLite from conftest.
"""

from app.core.langgraph.orchestrator import domain_router, resume_run, start_run


# --------------------------- routing (pure) -------------------------------- #
def test_routes_warranty_to_warranty():
    assert domain_router({"domain": "warranty"}) == "warranty"


def test_routes_unknown_domain_to_stub():
    assert domain_router({"domain": "parts"}) == "stub"


def test_routes_missing_domain_to_stub():
    assert domain_router({}) == "stub"


# --------------------- full graph pause / resume --------------------------- #
def _fake_decide(schema, system, user, **kwargs):
    from app.schemas import FraudAssessment, WarrantyRecommendation

    if schema is FraudAssessment:
        return FraudAssessment(fraud_risk=0.1, reasoning="nominal pattern")
    if schema is WarrantyRecommendation:
        return WarrantyRecommendation(
            decision="approve", confidence=0.95,
            reasoning="Component covered and within window.",
            draft_email="Dear customer, your claim is approved.",
        )
    raise AssertionError(f"unexpected schema {schema}")


def test_warranty_graph_pauses_then_resumes(monkeypatch):
    from app.services import llm
    monkeypatch.setattr(llm, "decide", _fake_decide)

    state = {
        "request_id": "t1",
        "input_text": "AC stopped working",
        "vehicle_vin": "MA3DEMO00000SWIFT",
        "component": "ac",
        "domain": "warranty",
        "summary": "AC failure",
    }

    paused = start_run(state, thread_id="t1")
    assert paused["interrupted"] is True
    assert paused["recommendation"]["decision"] == "approve"
    # enrichment loaded the vehicle context
    assert paused["values"]["context"]["vehicle"]["model"] == "Swift VXI"

    resumed = resume_run(thread_id="t1", decision="approve")
    assert resumed["final_status"] == "resolved"
    assert resumed["human_decision"] == "approve"
