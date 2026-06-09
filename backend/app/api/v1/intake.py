"""Guided customer intake endpoint.

Holds a short per-session conversation in memory. Each message is evaluated by the
intake agent; if more info is needed it returns a follow-up question, otherwise it
creates a ticket and kicks off the orchestrator. (In-memory session store is fine for
a single-process demo.)"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.langgraph.intake import next_intake_step
from app.db.session import get_db
from app.schemas import IntakeMessage, IntakeReply
from app.services.graph_runner import start_ticket

router = APIRouter(prefix="/api/v1", tags=["intake"])

# session_id -> {"history": [...], "asked": int, "vin": str|None}
_SESSIONS: dict[str, dict] = {}


@router.post("/intake", response_model=IntakeReply)
def intake(msg: IntakeMessage, db: Session = Depends(get_db)) -> IntakeReply:
    session = _SESSIONS.setdefault(
        msg.session_id, {"history": [], "asked": 0, "vin": None, "category": None}
    )
    if msg.vin:
        session["vin"] = msg.vin
    if msg.category:
        session["category"] = msg.category
    session["history"].append({"role": "user", "content": msg.message})

    decision, proceed = next_intake_step(session["history"], session["asked"])

    if not proceed:
        session["asked"] += 1
        question = decision.follow_up_question or "Could you tell me a bit more?"
        session["history"].append({"role": "assistant", "content": question})
        return IntakeReply(session_id=msg.session_id, reply=question,
                           enough_info=False, ticket_id=None)

    # Enough info -> create the ticket and run the orchestrator.
    vin = (decision.extracted.vin or session.get("vin"))
    component = decision.extracted.component
    # Customer-selected category wins over the model's classification.
    domain = session.get("category") or decision.domain or "warranty"
    summary = decision.summary or msg.message
    ticket = start_ticket(
        db, vin=vin, component=component, domain=domain, summary=summary,
        apqc=decision.apqc_process, input_text=msg.message,
    )
    _SESSIONS.pop(msg.session_id, None)

    reply = (
        f"Thanks — I've logged your {domain} request (ticket {ticket.id[:8]}). "
        "Our team will review it shortly."
    )
    return IntakeReply(session_id=msg.session_id, reply=reply, enough_info=True,
                       ticket_id=ticket.id)
