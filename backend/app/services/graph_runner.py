"""Bridge between the LangGraph orchestrator and the database.

The graph owns workflow state (via its checkpointer); these helpers create/refresh the
`tickets` row so the UI has something queryable, and they log a compact audit trail.
SSE events are published at key stages so the frontend can stream agent activity live.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.langgraph.orchestrator import resume_run, start_run
from app.models import AgentExecution, AuditLog, Customer, Recall, Ticket

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _emit(ticket_id: str, event_type: str, data: dict | None = None) -> None:
    try:
        from app.services.events import publish
        publish(ticket_id, event_type, data)
    except Exception:
        pass


def _log_executions(db: Session, ticket_id: str, outputs: list | None) -> None:
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
    if (ticket.domain or "") != "warranty":
        return
    try:
        from app.tools.cost_estimate import build_warranty_claim

        claim = build_warranty_claim(db, ticket, decided_by=decided_by, status="approved")
        ticket.claim_number = claim.claim_number
        ticket.claim_id = claim.id
        _notify_customer(db, ticket=ticket, claim_number=claim.claim_number,
                         total_cost=claim.total_cost, currency=claim.currency,
                         decision="approve")
    except Exception:
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


def _finalize_ticket(db: Session, ticket: Ticket, result: dict) -> None:
    """Shared post-run logic for both start_ticket and trigger_recall."""
    values = result["values"]
    ticket.recommendation = result["recommendation"]
    ticket.agent_trace = values.get("agent_outputs")
    ticket.thread_id = ticket.id

    if result["interrupted"]:
        ticket.status = "awaiting_approval"
        _emit(ticket.id, "ticket.awaiting_approval",
              {"summary": ticket.summary, "domain": ticket.domain})
        _audit(db, actor_type="agent", actor_id="orchestrator",
               action="created+analyzed", resource_id=ticket.id,
               after={"status": ticket.status})
    else:
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
        _emit(ticket.id, "ticket.resolved",
              {"decision": decision, "status": ticket.status})
        _audit(db, actor_type="agent", actor_id="system:auto-approval",
               action=f"auto-decision:{decision}", resource_id=ticket.id,
               after={"status": ticket.status})

    _log_executions(db, ticket.id, values.get("agent_outputs"))

    # Emit per-agent events so the monitor shows the full reasoning chain.
    for step in (values.get("agent_outputs") or []):
        _emit(ticket.id, "agent.step", {
            "agent": step.get("agent", ""),
            "apqc": step.get("apqc"),
            "output": step.get("output"),
        })
    _emit(ticket.id, "done", {"ticket_id": ticket.id})


def create_ticket_record(
    db: Session,
    *,
    customer_id: str | None,
    vin: str | None,
    component: str | None,
    domain: str,
    summary: str,
    apqc: str | None,
) -> Ticket:
    """Commit the ticket as 'processing' and return immediately.
    Call run_ticket_graph(ticket.id) in a BackgroundTask to do the pipeline work."""
    ticket = Ticket(
        customer_id=customer_id, vehicle_vin=vin, component=component, domain=domain,
        classification=domain, summary=summary, apqc_process=apqc,
        status="processing",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    _emit(ticket.id, "ticket.created", {"ticket_id": ticket.id, "domain": domain})
    return ticket


def run_ticket_graph(ticket_id: str, *, extra_context: dict | None = None) -> None:
    """Run the orchestrator for an existing ticket. Designed for BackgroundTasks —
    opens its own DB session so the request session is not shared across threads."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        ticket = db.get(Ticket, ticket_id)
        if ticket is None:
            logger.error("run_ticket_graph: ticket %s not found", ticket_id)
            return

        state = {
            "request_id": ticket.id,
            "input_text": ticket.summary,
            "customer_id": ticket.customer_id,
            "vehicle_vin": ticket.vehicle_vin,
            "component": ticket.component,
            "domain": ticket.domain or "warranty",
            "summary": ticket.summary,
            "apqc_process": ticket.apqc_process,
            "context": extra_context or {},
        }
        _emit(ticket.id, "agent.started", {"domain": ticket.domain})
        try:
            result = start_run(state, thread_id=ticket.id)
        except Exception:
            logger.exception("graph run failed for ticket %s", ticket_id)
            ticket.status = "failed"
            _emit(ticket.id, "ticket.failed", {"ticket_id": ticket_id})
            _emit(ticket.id, "done", {"ticket_id": ticket_id})
            _audit(db, actor_type="agent", actor_id="orchestrator",
                   action="run:failed", resource_id=ticket_id)
            db.commit()
            return

        ticket.customer_id = ticket.customer_id or result["values"].get("customer_id")
        _finalize_ticket(db, ticket, result)
        db.commit()
    finally:
        db.close()


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
    extra_context: dict | None = None,
) -> Ticket:
    """Create a ticket and run the orchestrator synchronously (used in tests and
    direct API calls that don't need background execution)."""
    ticket = create_ticket_record(
        db, customer_id=customer_id, vin=vin, component=component,
        domain=domain, summary=summary, apqc=apqc,
    )
    run_ticket_graph(ticket.id, extra_context=extra_context)
    # Re-fetch after background run updated via its own session.
    db.expire(ticket)
    db.refresh(ticket)
    return ticket


def trigger_recall(db: Session, *, recall_id: str, actor: str) -> Ticket:
    """Create and run a recall-processing ticket for a specific recall record."""
    recall = db.get(Recall, recall_id)
    if recall is None:
        raise ValueError(f"Recall {recall_id} not found")

    summary = (
        f"Recall {recall.code}: {recall.model} {recall.year} — "
        f"{recall.component} — {recall.description[:80]}"
    )
    ticket = Ticket(
        domain="recall",
        classification="recall",
        component=recall.component,
        summary=summary,
        apqc_process="6.7.4",
        status="under_review",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    _emit(ticket.id, "ticket.created", {"ticket_id": ticket.id, "domain": "recall"})

    state = {
        "request_id": ticket.id,
        "input_text": summary,
        "domain": "recall",
        "component": recall.component,
        "summary": summary,
        "context": {"recall_id": recall_id, "recall_component": recall.component},
    }
    _emit(ticket.id, "agent.started", {"domain": "recall", "recall_code": recall.code})
    result = start_run(state, thread_id=ticket.id)
    _finalize_ticket(db, ticket, result)

    _audit(db, actor_type="human", actor_id=actor, action="recall:trigger",
           resource_id=ticket.id, after={"recall_id": recall_id})
    db.commit()
    db.refresh(ticket)
    return ticket


def decide_ticket(db: Session, *, ticket_id: str, decision: str, actor: str) -> Ticket | None:
    """Resume a paused ticket with the human's decision and finalize it."""
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

    _emit(ticket.id, "ticket.resolved", {"decision": decision, "status": ticket.status})
    _emit(ticket.id, "done", {"ticket_id": ticket.id})
    _audit(db, actor_type="human", actor_id=actor, action=f"decision:{decision}",
           resource_id=ticket.id, after={"status": ticket.status})
    db.commit()
    db.refresh(ticket)
    return ticket
