"""Bridge between the LangGraph orchestrator and the database.

The graph owns workflow state (via its checkpointer); these helpers create/refresh the
`tickets` row so the UI has something queryable, and they log a compact audit trail.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.langgraph.orchestrator import resume_run, start_run
from app.models import AuditLog, Ticket


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(db: Session, *, actor_type: str, actor_id: str, action: str,
           resource_id: str, after: dict | None = None) -> None:
    db.add(AuditLog(actor_type=actor_type, actor_id=actor_id, action=action,
                    resource_type="ticket", resource_id=resource_id, after_state=after))


def start_ticket(
    db: Session,
    *,
    vin: str | None,
    component: str | None,
    domain: str,
    summary: str,
    apqc: str | None,
    input_text: str,
) -> Ticket:
    """Create a ticket and run the orchestrator until it pauses for approval."""
    ticket = Ticket(
        vehicle_vin=vin, domain=domain, classification=domain, summary=summary,
        apqc_process=apqc, status="under_review",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    state = {
        "request_id": ticket.id,
        "input_text": input_text,
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
    ticket.customer_id = values.get("customer_id")
    ticket.thread_id = ticket.id
    ticket.status = "awaiting_approval" if result["interrupted"] else "resolved"
    _audit(db, actor_type="agent", actor_id="orchestrator", action="created+analyzed",
           resource_id=ticket.id, after={"status": ticket.status})
    db.commit()
    db.refresh(ticket)
    return ticket


def decide_ticket(db: Session, *, ticket_id: str, decision: str, actor: str) -> Ticket | None:
    """Resume a paused ticket with the human's decision and finalize it."""
    ticket = db.get(Ticket, ticket_id)
    if ticket is None or not ticket.thread_id:
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
    _audit(db, actor_type="human", actor_id=actor, action=f"decision:{decision}",
           resource_id=ticket.id, after={"status": ticket.status})
    db.commit()
    db.refresh(ticket)
    return ticket
