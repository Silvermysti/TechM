"""Bridge between the LangGraph orchestrator and the database.

The graph owns workflow state (via its checkpointer); these helpers create/refresh the
`tickets` row so the UI has something queryable, and they log a compact audit trail.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.langgraph.orchestrator import resume_run, start_run
from app.models import AgentExecution, AuditLog, Customer, Ticket

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _log_executions(db: Session, ticket_id: str, outputs: list | None) -> None:
    """Persist one agent_executions row per specialist that ran (the AI run log)."""
    for entry in outputs or []:
        out = entry.get("output") if isinstance(entry, dict) else None
        confidence = out.get("confidence") if isinstance(out, dict) else None
        db.add(AgentExecution(
            ticket_id=ticket_id,
            agent_name=entry.get("agent", "unknown") if isinstance(entry, dict) else "unknown",
            apqc_ref=entry.get("apqc") if isinstance(entry, dict) else None,
            output=out,
            confidence=confidence,
            completed_at=_now(),
        ))


def _audit(db: Session, *, actor_type: str, actor_id: str, action: str,
           resource_id: str, after: dict | None = None) -> None:
    db.add(AuditLog(actor_type=actor_type, actor_id=actor_id, action=action,
                    resource_type="ticket", resource_id=resource_id, after_state=after))


def _record_warranty_claim(db: Session, ticket: Ticket, *, decided_by: str) -> None:
    """Turn an approved warranty ticket into a costed claim and notify the customer."""
    if (ticket.domain or "") != "warranty":
        return
    try:
        from app.tools.cost_estimate import build_warranty_claim

        claim = build_warranty_claim(db, ticket, decided_by=decided_by, status="approved")
        # Stamp claim reference on the ticket so the customer portal can show it.
        ticket.claim_number = claim.claim_number
        ticket.claim_id = claim.id
        _notify_customer(db, ticket=ticket, claim_number=claim.claim_number,
                         total_cost=claim.total_cost, currency=claim.currency,
                         decision="approve")
    except Exception:  # noqa: BLE001 — costing is supplementary to the decision
        logger.exception("warranty claim costing failed for ticket %s", ticket.id)


def _notify_customer(
    db: Session, *, ticket: Ticket, claim_number: str, total_cost: float,
    currency: str, decision: str,
) -> None:
    try:
        from app.services.notify import send_claim_notification

        customer = db.get(Customer, ticket.customer_id) if ticket.customer_id else None
        send_claim_notification(
            customer_name=customer.name if customer else "Customer",
            customer_email=customer.email if customer else "",
            claim_number=claim_number,
            ticket_id=ticket.id,
            decision=decision,
            component=ticket.component,
            total_cost=total_cost,
            currency=currency,
        )
    except Exception:
        logger.exception("notification failed for ticket %s", ticket.id)


def start_ticket(
    db: Session,
    *,
    customer_id: str | None,
    vin: str | None,
    component: str | None,
    domain: str,
    summary: str,
    apqc: str | None,
    input_text: str,
) -> Ticket:
    """Create a ticket and run the orchestrator until it pauses for approval (or, for
    a low-risk warranty claim, auto-finalizes via tiered autonomy)."""
    ticket = Ticket(
        customer_id=customer_id, vehicle_vin=vin, component=component, domain=domain,
        classification=domain, summary=summary, apqc_process=apqc,
        status="under_review",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    state = {
        "request_id": ticket.id,
        "input_text": input_text,
        "customer_id": customer_id,
        "vehicle_vin": vin,
        "component": component,
        "domain": domain,
        "summary": summary,
        "apqc_process": apqc,
    }
    result = start_run(state, thread_id=ticket.id)
    values = result["values"]

    ticket.recommendation = result["recommendation"]
    ticket.agent_trace = values.get("agent_outputs")
    # Trust the authenticated caller's id; only fall back to enrichment if absent.
    ticket.customer_id = customer_id or values.get("customer_id")
    ticket.thread_id = ticket.id

    if result["interrupted"]:
        ticket.status = "awaiting_approval"
        _audit(db, actor_type="agent", actor_id="orchestrator",
               action="created+analyzed", resource_id=ticket.id,
               after={"status": ticket.status})
    else:
        # Tiered autonomy resolved it without a human.
        decision = values.get("human_decision") or "resolved"
        ticket.status = values.get("final_status", "resolved")
        ticket.human_decision = decision
        ticket.human_actor = "system:auto-approval"
        ticket.resolved_at = _now()
        if ticket.recommendation:
            rec = dict(ticket.recommendation)
            rec["final_decision"] = decision
            ticket.recommendation = rec
        if decision == "approve":
            _record_warranty_claim(db, ticket, decided_by="system:auto-approval")
        _audit(db, actor_type="agent", actor_id="system:auto-approval",
               action=f"auto-decision:{decision}", resource_id=ticket.id,
               after={"status": ticket.status})

    _log_executions(db, ticket.id, values.get("agent_outputs"))
    db.commit()
    db.refresh(ticket)
    return ticket


def decide_ticket(db: Session, *, ticket_id: str, decision: str, actor: str) -> Ticket | None:
    """Resume a paused ticket with the human's decision and finalize it.

    Returns None if the ticket doesn't exist or isn't awaiting a human decision
    (so an already-resolved/auto-finalized ticket can't be re-decided)."""
    ticket = db.get(Ticket, ticket_id)
    if ticket is None or not ticket.thread_id or ticket.status != "awaiting_approval":
        return None

    values = resume_run(thread_id=ticket.thread_id, decision=decision)
    ticket.human_decision = decision
    ticket.human_actor = actor
    ticket.status = values.get("final_status", ticket.status)
    if decision != "escalate":
        ticket.resolved_at = _now()
    if ticket.recommendation:
        rec = dict(ticket.recommendation)
        rec["final_decision"] = decision
        ticket.recommendation = rec

    if decision == "approve":
        _record_warranty_claim(db, ticket, decided_by=actor)

    _audit(db, actor_type="human", actor_id=actor, action=f"decision:{decision}",
           resource_id=ticket.id, after={"status": ticket.status})
    db.commit()
    db.refresh(ticket)
    return ticket
