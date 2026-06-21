"""Unit tests for the eval harness mechanics (no real LLM).

The real, LLM-judged eval is run on-demand via run_eval.py. Here we just prove the
scoring math and the pipeline wiring are correct, using a fake decider — so this stays
in the fast suite and never makes a network call.
"""

from app.schemas import FraudAssessment, WarrantyRecommendation
from tests.eval.harness import EvalResult, JudgeVerdict, evaluate, score_run
from tests.eval.scenarios import SCENARIOS


def _fake_decide(schema, system, user, **kwargs):
    if schema is FraudAssessment:
        return FraudAssessment(fraud_risk=0.05, reasoning="clean history")
    if schema is WarrantyRecommendation:
        return WarrantyRecommendation(
            decision="reject", confidence=0.9,
            reasoning="brake pads are wear items", draft_email="…",
            cited_clause="GEN-WEAR-01",
        )
    if schema is JudgeVerdict:
        return JudgeVerdict(score=5, justification="consistent with the cited clause")
    raise AssertionError(schema)


def test_score_run_math():
    results = [
        EvalResult("a", "approve", True, 0.9, 0.0, None, "", True, True, judge_score=4),
        EvalResult("b", "reject", False, 0.8, 0.0, None, "", True, True, judge_score=2),
        EvalResult("c", "approve", True, 0.7, 0.0, None, "", False, True, judge_score=5),
    ]
    s = score_run(results)
    assert s["n"] == 3
    assert round(s["decision_accuracy"], 3) == round(2 / 3, 3)  # 2 of 3 matched
    assert s["coverage_accuracy"] == 1.0
    assert s["avg_judge_score"] == (4 + 2 + 5) / 3


def test_evaluate_runs_pipeline_against_seeded_db(monkeypatch):
    # Swift brake claim: brakes are NOT in the Swift policy -> not covered -> reject.
    from app.services import llm

    monkeypatch.setattr(llm, "decide", _fake_decide)
    scenario = next(s for s in SCENARIOS if s.id == "swift-brakes-excluded")

    result = evaluate(scenario, judge=True)

    assert result.decision == "reject"
    assert result.covered is False            # real coverage check ran against the DB
    assert result.decision_match is True
    assert result.coverage_match is True
    assert result.cited_clause == "GEN-WEAR-01"
    assert result.judge_score == 5
