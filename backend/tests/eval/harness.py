"""Evaluation harness — run scenarios through the warranty pipeline and score them.

Two scores per scenario:
  * decision_match / coverage_match — objective: did the pipeline reach the labeled
    answer? (the ground-truth check)
  * judge_score (1-5) — an LLM-as-judge rates whether the AI's *reasoning* is sound and
    consistent with its decision and the cited clause. This catches "right answer, wrong
    reasoning" cases that an exact-match test can't. SOTA evaluation technique.

The pipeline and the judge both make real LLM calls, so this is meant to be run
on-demand against a configured provider (see run_eval.py), not in the fast unit suite.
The scoring math itself is unit-tested separately with a fake decider.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

from tests.eval.scenarios import Scenario


class JudgeVerdict(BaseModel):
    """LLM-as-judge output: how sound is the reasoning behind the decision?"""

    score: int = Field(ge=1, le=5, description="1=incoherent, 5=clear and well-grounded")
    justification: str


_JUDGE_SYSTEM = """You are a senior warranty auditor grading an AI assistant's claim \
decision. You are NOT re-deciding the claim. Judge only the QUALITY of its reasoning:
- Does the reasoning logically support the stated decision (no contradiction)?
- Is it grounded in the cited warranty clause and the coverage facts, not invented terms?
- Is it clear and specific?
Give a score from 1 (incoherent or self-contradictory) to 5 (clear, consistent, and \
well-grounded), and one sentence of justification."""


@dataclass
class EvalResult:
    scenario_id: str
    decision: str
    covered: bool
    confidence: float
    fraud_risk: float
    cited_clause: str | None
    reasoning: str
    decision_match: bool
    coverage_match: bool
    judge_score: int | None = None
    judge_note: str | None = None


def run_pipeline(scenario: Scenario) -> dict:
    """Run validate → policy_lookup → fraud → recommend on one scenario.

    Mirrors the live warranty graph's decision core (evidence/photo and cost/autonomy
    are out of scope for judging the *decision*). Nodes read the seeded DB and the
    configured LLM exactly as in production.
    """
    from app.core.langgraph.domains import warranty
    from app.tools.component_map import canonical_component

    state: dict = {
        "request_id": f"eval-{scenario.id}",
        "vehicle_vin": scenario.vin,
        "component": canonical_component(scenario.component_raw),
        "summary": scenario.summary,
        "input_text": scenario.summary,
        "customer_id": None,
        "context": {},
        "agent_outputs": [],
    }
    state.update(warranty.warranty_validate(state))
    state.update(warranty.warranty_policy_lookup(state))
    state.update(warranty.warranty_fraud(state))
    state.update(warranty.warranty_recommend(state))
    return state


def judge_reasoning(scenario: Scenario, rec: dict, covered: bool) -> JudgeVerdict:
    """Ask an LLM to grade the reasoning quality (1-5)."""
    from app.services import llm

    user = (
        f"Claim: {scenario.summary}\n"
        f"Coverage fact: {'covered' if covered else 'not covered'}\n"
        f"AI decision: {rec.get('decision')}\n"
        f"AI cited clause: {rec.get('cited_clause')}\n"
        f"AI reasoning: {rec.get('reasoning')}"
    )
    return llm.decide(JudgeVerdict, system=_JUDGE_SYSTEM, user=user, tier="standard")


def evaluate(scenario: Scenario, *, judge: bool = True) -> EvalResult:
    """Run one scenario and score it."""
    final = run_pipeline(scenario)
    rec = final.get("recommendation") or {}
    warranty_ctx = (final.get("context") or {}).get("warranty") or {}
    covered = bool(warranty_ctx.get("covered"))
    decision = rec.get("decision", "")

    result = EvalResult(
        scenario_id=scenario.id,
        decision=decision,
        covered=covered,
        confidence=float(rec.get("confidence") or 0.0),
        fraud_risk=float(final.get("fraud_risk") or 0.0),
        cited_clause=rec.get("cited_clause"),
        reasoning=rec.get("reasoning", ""),
        decision_match=(decision == scenario.expected_decision),
        coverage_match=(covered == scenario.expected_covered),
    )
    if judge:
        verdict = judge_reasoning(scenario, rec, covered)
        result.judge_score = verdict.score
        result.judge_note = verdict.justification
    return result


def score_run(results: list[EvalResult]) -> dict:
    """Aggregate a batch of results into headline metrics."""
    n = len(results) or 1
    judged = [r.judge_score for r in results if r.judge_score is not None]
    return {
        "n": len(results),
        "decision_accuracy": sum(r.decision_match for r in results) / n,
        "coverage_accuracy": sum(r.coverage_match for r in results) / n,
        "avg_judge_score": (sum(judged) / len(judged)) if judged else None,
    }
