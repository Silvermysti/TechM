"""Warranty domain — Tier-2/3 specialist nodes.

Pipeline: validate (DB tool) -> fraud_check (LLM) -> recommend (LLM).
Each node returns a partial state update. DB sessions and the LLM module are imported
lazily inside functions so tests can reload/monkeypatch them cleanly.
"""

from __future__ import annotations

from datetime import date

from app.core.langgraph.state import AfterSalesState
from app.schemas import EvidenceAssessment, FraudAssessment, WarrantyRecommendation

FRAUD_SYSTEM = """You are a warranty fraud-detection specialist. Estimate the \
probability (0.0-1.0) that this claim is fraudulent or anomalous.

CRITICAL DISTINCTION — fraud is NOT the same as coverage:
- A claim being out of warranty, or for a component the policy does not cover, is a
  COVERAGE matter, handled separately. It is NOT evidence of fraud. Do not raise the
  fraud score for an out-of-coverage claim.

Genuine fraud/anomaly signals (raise the score only for these):
- Repeat claims for the SAME component in a short window — this only applies when the
  "prior claims for THIS SAME component" count is 1 or more. It is the strongest signal.
- Vehicle age or mileage inconsistent with the reported failure.
- Internal contradictions in the customer's description.
- A history pattern explicitly flagged as repeat/abuse.

IMPORTANT about claim history:
- "prior claims for THIS SAME component" is the only number that supports a same-component
  repeat claim. If it is 0, you MUST NOT say or imply any prior claim was for this
  component — there were none.
- A few claims for DIFFERENT components is normal vehicle ownership, not fraud. Do not
  score it as a same-component repeat; at most note it briefly as mild.
- Quote the history numbers exactly. Never invent a component, count, mileage, or date.

Use ONLY the facts provided. If the claim history shows no prior SAME-component claims
and nothing in the description is anomalous, the fraud score must be LOW (<= 0.1). Give
one or two sentences naming the specific signal you scored on (or stating that none was
found), and make sure it matches the history numbers above."""

EVIDENCE_SYSTEM = """You are a vehicle damage assessment specialist reviewing a \
customer-submitted photo as part of a warranty claim evaluation.

Assess whether the photo provides credible visual evidence for the reported issue. Be \
objective and precise. A photo matches the claim if it shows the correct vehicle \
component in a state consistent with the described symptom. Damage is visible if \
there is clear evidence of failure, wear, breakage, or malfunction.

Do not invent details that are not visible. If the image is blurry, off-topic, or \
does not show the relevant component, say so in your notes and set confidence low. \
Coverage and policy rules are NOT your concern — only describe what you can see."""

RECOMMEND_SYSTEM = """You are a warranty claims specialist producing a RECOMMENDATION \
for a human reviewer (you never finalize a payout yourself). Read the validation \
result and the fraud score and choose exactly one decision using these rules:

- REJECT  — validation shows the claim is NOT covered (component excluded or warranty
            expired) AND the fraud score is low. This is a clear, legitimate denial.
            Do not escalate a simple out-of-coverage claim; reject it cleanly.
- APPROVE — validation shows the claim IS covered AND the fraud score is low AND the
            facts are consistent. Recommend approval for the reviewer to confirm.
- ESCALATE — the fraud score is elevated, OR the facts conflict or are ambiguous, OR
            it is a high-value or unusual failure that needs human judgement.

Your reasoning MUST agree with your decision — never argue for one outcome and output
another. Base every statement only on the provided validation and fraud facts; do not
invent coverage terms or history.

You are given the relevant warranty clauses (each tagged with an id like SWIFT-AC-01).
Ground your reasoning in these clauses — quote the decisive clause's wording in your
reasoning, and put its id in the `cited_clause` field. If no clause is decisive, leave
cited_clause empty. Never invent a clause id that was not provided.

Provide: confidence (0.0-1.0, how clear-cut the call is), concise reasoning, the
cited_clause id, and a short, polite, professional draft email to the customer conveying
the outcome. The email must not promise payment as final — it communicates the
recommended outcome, pending confirmation."""


def _append_output(state: AfterSalesState, entry: dict) -> list[dict]:
    outputs = list(state.get("agent_outputs") or [])
    outputs.append(entry)
    return outputs


def _load_first_image(attachment_ids: list[str]) -> tuple[str, str] | None:
    """Return (base64_data, content_type) for the first image attachment, or None."""
    import base64
    from pathlib import Path

    from app.db.session import SessionLocal
    from app.models import Attachment

    db = SessionLocal()
    try:
        att = db.get(Attachment, attachment_ids[0])
        if att is None or not att.stored_name:
            return None
        stored_name = att.stored_name
        content_type = att.content_type or "image/jpeg"
    finally:
        db.close()

    upload_dir = Path(__file__).resolve().parents[4] / "uploads"
    img_path = upload_dir / stored_name
    if not img_path.exists():
        return None

    return base64.b64encode(img_path.read_bytes()).decode(), content_type


def warranty_evidence(state: AfterSalesState) -> dict:
    """Assess customer evidence photo using vision AI (Groq llama-4-scout).

    Runs only when the ticket has attached images. Skips silently when no
    photos are present — the rest of the pipeline is unaffected either way.
    Photo assessment feeds the fraud and recommend nodes via state['context']['evidence'].
    """
    from app.services import llm

    attachment_ids = state.get("attachment_ids") or []
    if not attachment_ids:
        return {}

    image_data = _load_first_image(attachment_ids)
    if image_data is None:
        return {}

    image_b64, image_type = image_data
    user_prompt = (
        f"Warranty claim summary: {state.get('summary')}\n"
        f"Reported component: {state.get('component') or 'unknown'}\n\n"
        "Assess the attached photo as evidence for this claim."
    )

    assessment: EvidenceAssessment = llm.decide_vision(
        EvidenceAssessment,
        system=EVIDENCE_SYSTEM,
        image_b64=image_b64,
        image_type=image_type,
        user=user_prompt,
    )

    context = dict(state.get("context") or {})
    context["evidence"] = assessment.model_dump()

    return {
        "context": context,
        "agent_outputs": _append_output(
            state,
            {
                "agent": "Evidence Assessment Specialist",
                "apqc": "6.7.3.3",
                "output": assessment.model_dump(),
            },
        ),
    }


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


def warranty_policy_lookup(state: AfterSalesState) -> dict:
    """Policy RAG — retrieve the warranty clauses most relevant to this claim so the
    recommendation can quote real contract wording instead of paraphrasing from memory.

    Runs after validation (model + component are known by now) and stashes the top
    clauses in context for `warranty_recommend`. Also records them as their own step in
    the reasoning chain, so the manager can see exactly which clauses the AI was shown.
    """
    from app.services import retrieval

    context = dict(state.get("context") or {})
    component = state.get("component") or ""
    description = state.get("summary") or state.get("input_text") or ""
    model = (context.get("warranty") or {}).get("model")

    query = f"{component}: {description}".strip().strip(":").strip()
    clauses = retrieval.retrieve(query, model=model, k=2)
    context["policy_clauses"] = clauses

    return {
        "context": context,
        "agent_outputs": _append_output(
            state,
            {"agent": "Policy Reference (RAG)", "apqc": "6.7.2",
             "output": {"query": query, "method": retrieval.backend_name(),
                        "clauses": clauses}},
        ),
    }


def warranty_fraud(state: AfterSalesState) -> dict:
    from app.db.session import SessionLocal
    from app.services import llm
    from app.tools.claim_history import get_claim_history

    vin = state.get("vehicle_vin")
    customer_id = state.get("customer_id")
    component = state.get("component")
    ticket_id = state.get("request_id")

    db = SessionLocal()
    try:
        history = get_claim_history(
            db, vin=vin, customer_id=customer_id,
            component=component, exclude_ticket_id=ticket_id,
        )
    finally:
        db.close()

    context = state.get("context") or {}
    user = (
        f"Claim summary: {state.get('summary')}\n"
        f"Validation: {context.get('warranty')}\n"
        f"VIN: {vin}\n"
        f"Component being claimed now: {component}\n"
        f"Claim history (these are facts — do not contradict or add to them):\n"
        f"  - total prior claims: {history['total_prior']}\n"
        f"  - prior claims for THIS SAME component ({component}): {history['same_component']}\n"
        f"  - prior claims in the last 90 days: {history['recent_90d']}\n"
        f"  - repeat pattern flagged: {history['repeat_flag']}\n"
        f"  - summary: {history['summary']}"
    )
    assessment: FraudAssessment = llm.decide(
        FraudAssessment, system=FRAUD_SYSTEM, user=user, tier="complex"
    )

    updated_context = dict(context)
    updated_context["claim_history"] = history

    return {
        "fraud_risk": assessment.fraud_risk,
        "context": updated_context,
        "agent_outputs": _append_output(
            state, {"agent": "Fraud Detection Specialist", "apqc": "6.7.5.5",
                    "output": {**assessment.model_dump(), "claim_history": history}}
        ),
    }


def warranty_cost(state: AfterSalesState) -> dict:
    """Deterministic repair costing (labor + parts) — drives the autonomy gate and
    surfaces the figure for the reviewer. No LLM: warranty money must be auditable."""
    from app.db.session import SessionLocal
    from app.tools.cost_estimate import estimate_cost

    db = SessionLocal()
    try:
        costing = estimate_cost(db, component=state.get("component"))
    finally:
        db.close()

    context = dict(state.get("context") or {})
    context["cost"] = costing
    return {
        "estimated_cost": costing["total_cost"],
        "context": context,
        "agent_outputs": _append_output(
            state, {"agent": "Cost Estimator", "apqc": "6.7.3.5", "output": costing}
        ),
    }


def warranty_responsible_party(state: AfterSalesState) -> dict:
    """Determine who bears the cost — manufacturer / supplier / indeterminate (APQC 6.7.3.4).

    Drives supplier cost recovery (APQC 6.7.4). No LLM: money routing must be auditable."""
    from app.db.session import SessionLocal
    from app.tools.responsible_party import determine_responsible_party

    db = SessionLocal()
    try:
        determination = determine_responsible_party(db, component=state.get("component"))
    finally:
        db.close()

    context = dict(state.get("context") or {})
    context["responsible_party"] = determination
    return {
        "context": context,
        "agent_outputs": _append_output(
            state, {"agent": "Responsible Party Specialist", "apqc": "6.7.3.4",
                    "output": determination}
        ),
    }


def warranty_recommend(state: AfterSalesState) -> dict:
    from app.services import llm

    context = state.get("context") or {}

    # Policy RAG: format the retrieved clauses so the model can quote real contract
    # wording and cite the clause id it relied on.
    clauses = context.get("policy_clauses") or []
    if clauses:
        clause_block = "\n".join(f"- [{c['id']}] {c['text']}" for c in clauses)
    else:
        clause_block = "(no policy clauses retrieved)"

    user = (
        f"Claim summary: {state.get('summary')}\n"
        f"Validation: {context.get('warranty')}\n"
        f"Fraud risk: {state.get('fraud_risk')}\n"
        f"Relevant warranty clauses (cite the decisive one by id):\n{clause_block}"
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
