"""Warranty domain — Tier-2/3 specialist nodes.

Pipeline: validate (DB tool) -> fraud_check (LLM) -> recommend (LLM).
Each node returns a partial state update. DB sessions and the LLM module are imported
lazily inside functions so tests can reload/monkeypatch them cleanly.
"""

from __future__ import annotations

from datetime import date

from app.core.langgraph.state import AfterSalesState
from app.schemas import FraudAssessment, WarrantyRecommendation

FRAUD_SYSTEM = """You are a warranty fraud-detection specialist. Given the claim \
context and the warranty validation result, estimate the probability (0..1) that this \
claim is fraudulent or anomalous, and explain briefly."""

RECOMMEND_SYSTEM = """You are a warranty claims specialist. Based on the validation \
result and fraud assessment, recommend approve, reject, or escalate. Provide your \
confidence (0..1), concise reasoning, and a short, polite draft email to the customer \
communicating the outcome."""


def _append_output(state: AfterSalesState, entry: dict) -> list[dict]:
    outputs = list(state.get("agent_outputs") or [])
    outputs.append(entry)
    return outputs


def warranty_validate(state: AfterSalesState) -> dict:
    """Check coverage against the mock warranty DB."""
    from app.db.session import SessionLocal
    from app.tools.warranty_check import check_warranty

    vin = state.get("vehicle_vin") or ""
    component = state.get("component") or ""
    db = SessionLocal()
    try:
        result = check_warranty(db, vin=vin, component=component, claim_date=date.today())
    finally:
        db.close()

    context = dict(state.get("context") or {})
    context["warranty"] = result
    return {
        "context": context,
        "agent_outputs": _append_output(
            state, {"agent": "Warranty Claims Specialist", "apqc": "6.7.3",
                    "output": result}
        ),
    }


def warranty_fraud(state: AfterSalesState) -> dict:
    from app.services import llm

    context = state.get("context") or {}
    user = (
        f"Claim summary: {state.get('summary')}\n"
        f"Validation: {context.get('warranty')}\n"
        f"VIN: {state.get('vehicle_vin')}"
    )
    assessment: FraudAssessment = llm.decide(
        FraudAssessment, system=FRAUD_SYSTEM, user=user, tier="complex"
    )
    return {
        "fraud_risk": assessment.fraud_risk,
        "agent_outputs": _append_output(
            state, {"agent": "Fraud Detection Specialist", "apqc": "6.7.5.5",
                    "output": assessment.model_dump()}
        ),
    }


def warranty_recommend(state: AfterSalesState) -> dict:
    from app.services import llm

    context = state.get("context") or {}
    user = (
        f"Claim summary: {state.get('summary')}\n"
        f"Validation: {context.get('warranty')}\n"
        f"Fraud risk: {state.get('fraud_risk')}"
    )
    rec: WarrantyRecommendation = llm.decide(
        WarrantyRecommendation, system=RECOMMEND_SYSTEM, user=user, tier="standard"
    )
    # High fraud risk forces escalation regardless of the model's recommendation.
    decision = rec.decision
    escalated = False
    if (state.get("fraud_risk") or 0.0) > 0.7:
        decision = "escalate"
        escalated = True

    recommendation = rec.model_dump()
    recommendation["decision"] = decision

    return {
        "recommendation": recommendation,
        "human_approval_required": True,
        "escalated": escalated,
        "agent_outputs": _append_output(
            state, {"agent": "Recommendation", "apqc": "6.7.3.5",
                    "output": recommendation}
        ),
    }
