"""Recall domain — APQC 6.7.4 adjacent (Safety Notice / Product Recall).

Pipeline: recall_assess (DB + LLM) -> recall_draft_comms (LLM)

Triggered when:
  - A customer reports a safety issue matching a known recall (domain routed)
  - A manager triggers a recall broadcast via POST /api/v1/recalls/{id}/trigger
"""

from __future__ import annotations

from app.core.langgraph.state import AfterSalesState
from app.schemas import RecallAssessment, RecallComms

ASSESS_SYSTEM = """You are a product-safety recall analyst at an automotive OEM.
You receive a recall notice (component, model, year, description) plus the count of
affected vehicles in the owner database.

Assess:
  • severity: low | medium | high | critical — based on safety risk of the defect
  • recommended_action: monitor | notify | stop_use | immediate_recall
  • reasoning: 2–3 sentences explaining the rating
  • timeline_days: how quickly customer outreach should be completed (e.g. 7 for urgent)

Be conservative — prefer upgrading severity when uncertain. A brake or steering defect
is never "low". Base the assessment only on the provided facts."""

COMMS_SYSTEM = """You are a customer-communications specialist for an automotive company.
Draft a recall notification letter to be sent to affected vehicle owners.

The letter must:
  • Be clear, direct, and professional — not alarming but appropriately serious
  • State the recall code, affected model/year, and the defect
  • Explain what the customer should do (book a service appointment)
  • Reassure the customer the repair is free of charge
  • Be concise (≤ 200 words in the body)

Return: subject (one line), body (the full letter text), urgency (routine/urgent/emergency)."""


def _append_output(state: AfterSalesState, entry: dict) -> list[dict]:
    outputs = list(state.get("agent_outputs") or [])
    outputs.append(entry)
    return outputs


def recall_assess(state: AfterSalesState) -> dict:
    """Find affected VINs in the DB and use LLM to assess severity + action."""
    from app.db.session import SessionLocal
    from app.models import Recall, Vehicle
    from app.services import llm
    from sqlalchemy import func, select

    context = dict(state.get("context") or {})
    recall_id = context.get("recall_id")
    component = state.get("component") or context.get("recall_component", "")

    db = SessionLocal()
    try:
        recall = db.get(Recall, recall_id) if recall_id else None
        if recall:
            affected = db.execute(
                select(func.count(Vehicle.vin)).where(
                    Vehicle.model == recall.model,
                    Vehicle.year == recall.year,
                )
            ).scalar_one()
            context["recall"] = {
                "id": recall.id,
                "code": recall.code,
                "model": recall.model,
                "year": recall.year,
                "component": recall.component,
                "description": recall.description,
            }
            context["affected_count"] = affected
        else:
            affected = 0
    finally:
        db.close()

    recall_ctx = context.get("recall", {})
    user = (
        f"Recall code: {recall_ctx.get('code', 'unknown')}\n"
        f"Model/Year: {recall_ctx.get('model', 'unknown')} {recall_ctx.get('year', '')}\n"
        f"Component: {recall_ctx.get('component', component)}\n"
        f"Defect description: {recall_ctx.get('description', state.get('summary', ''))}\n"
        f"Affected vehicles in fleet: {affected}"
    )
    assessment: RecallAssessment = llm.decide(
        RecallAssessment, system=ASSESS_SYSTEM, user=user, tier="standard"
    )

    rec = {
        "decision": "escalate",
        "confidence": 0.9,
        "reasoning": assessment.reasoning,
        "draft_email": "",
        "severity": assessment.severity,
        "recommended_action": assessment.recommended_action,
        "timeline_days": assessment.timeline_days,
        "affected_count": affected,
    }
    context["assessment"] = assessment.model_dump()

    return {
        "context": context,
        "recommendation": rec,
        "human_approval_required": True,
        "agent_outputs": _append_output(
            state,
            {
                "agent": "Recall Safety Analyst",
                "apqc": "6.7.4",
                "output": {**assessment.model_dump(), "affected_count": affected},
            },
        ),
    }


def recall_draft_comms(state: AfterSalesState) -> dict:
    """Draft the customer recall notification letter."""
    from app.services import llm

    context = state.get("context") or {}
    recall_ctx = context.get("recall", {})
    assessment = context.get("assessment", {})

    user = (
        f"Recall code: {recall_ctx.get('code', 'UNKNOWN')}\n"
        f"Model: {recall_ctx.get('model', 'unknown')} {recall_ctx.get('year', '')}\n"
        f"Component: {recall_ctx.get('component', '')}\n"
        f"Defect: {recall_ctx.get('description', '')}\n"
        f"Severity: {assessment.get('severity', '')}\n"
        f"Recommended action: {assessment.get('recommended_action', '')}\n"
        f"Timeline: within {assessment.get('timeline_days', 7)} days"
    )
    comms: RecallComms = llm.decide(
        RecallComms, system=COMMS_SYSTEM, user=user, tier="standard"
    )

    updated_rec = dict(state.get("recommendation") or {})
    updated_rec["draft_email"] = f"Subject: {comms.subject}\n\n{comms.body}"
    updated_rec["urgency"] = comms.urgency

    return {
        "recommendation": updated_rec,
        "agent_outputs": _append_output(
            state,
            {
                "agent": "Customer Communications Specialist",
                "apqc": "6.7.4.2",
                "output": comms.model_dump(),
            },
        ),
    }
