"""Guided customer intake endpoint.

Conversation state is persisted in the `intake_sessions` table (not process memory),
so chats survive restarts, work across workers, and expire by TTL instead of leaking.
Each message is evaluated by the intake agent; if more info is needed it returns a
follow-up question, otherwise it creates a ticket and kicks off the orchestrator.

Evidence photos are uploaded against the chat session_id first, then linked to the
ticket once one is created. Intake is customer-scoped: the ticket is attributed to the
authenticated caller, and a supplied VIN must belong to them.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_principal
from app.config import get_settings
from app.core.langgraph.intake import next_intake_step
from app.db.session import get_db
from app.models import Attachment, IntakeSession, Vehicle
from app.schemas import AttachmentOut, IntakeMessage, IntakeReply
from app.services.graph_runner import create_ticket_record, run_ticket_graph

router = APIRouter(prefix="/api/v1", tags=["intake"])

# backend/uploads/ — gitignored; served by the app at /uploads.
UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads"

# Max evidence upload size (bytes) — guards against memory-exhaustion via huge uploads.
_MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _purge_expired(db: Session) -> None:
    cutoff = _now() - timedelta(minutes=get_settings().intake_session_ttl_minutes)
    db.execute(delete(IntakeSession).where(IntakeSession.updated_at < cutoff))


def _vin_belongs_to(db: Session, vin: str, customer_id: str | None) -> bool:
    vehicle = db.get(Vehicle, vin)
    return vehicle is not None and vehicle.customer_id == customer_id


@router.post("/intake/upload", response_model=AttachmentOut)
async def upload_evidence(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Attachment:
    """Store one evidence photo for an intake chat session."""
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are accepted.")

    data = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 8 MB limit.")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    # Assign the id up front (the column default only fires at INSERT) so the
    # stored filename can be derived from it.
    att_id = str(uuid.uuid4())
    att = Attachment(
        id=att_id,
        session_id=session_id,
        filename=file.filename or "photo",
        content_type=file.content_type or "image/jpeg",
        stored_name=f"{att_id}{ext}",
    )

    UPLOAD_DIR.mkdir(exist_ok=True)
    (UPLOAD_DIR / att.stored_name).write_bytes(data)

    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.post("/intake", response_model=IntakeReply)
def intake(
    msg: IntakeMessage,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> IntakeReply:
    if principal.role != "customer":
        raise HTTPException(status_code=403, detail="Only customers can file requests.")

    _purge_expired(db)

    session = db.get(IntakeSession, msg.session_id)
    if session is None:
        session = IntakeSession(
            session_id=msg.session_id, customer_id=principal.customer_id,
            history=[], asked=0,
        )
        db.add(session)
    elif session.customer_id != principal.customer_id:
        raise HTTPException(status_code=403, detail="Session belongs to another user.")

    if msg.vin:
        if not _vin_belongs_to(db, msg.vin, principal.customer_id):
            raise HTTPException(status_code=403, detail="That vehicle is not on your account.")
        session.vin = msg.vin
    if msg.category:
        session.category = msg.category

    # Make attached photos visible to the agent so it doesn't re-ask for them.
    content = msg.message
    if msg.attachment_ids:
        n = len(msg.attachment_ids)
        content = f"{content}\n[photo attached: {n} image{'s' if n > 1 else ''}]".strip()
    # JSON columns need reassignment (not in-place mutation) to be tracked.
    history = list(session.history or [])
    history.append({"role": "user", "content": content})

    decision, proceed = next_intake_step(
        history, session.asked, known_vin=session.vin
    )

    if not proceed:
        question = decision.follow_up_question or "Could you tell me a bit more?"
        history.append({"role": "assistant", "content": question})
        session.history = history
        session.asked += 1
        session.updated_at = _now()
        db.commit()
        return IntakeReply(session_id=msg.session_id, reply=question,
                           enough_info=False, ticket_id=None,
                           request_image=decision.request_image)

    # Enough info -> create the ticket record immediately, then run the graph in background.
    vin = decision.extracted.vin or session.vin
    if vin and not _vin_belongs_to(db, vin, principal.customer_id):
        vin = session.vin  # never file against someone else's VIN
    component = decision.extracted.component
    # Customer-selected category wins over the model's classification.
    domain = session.category or decision.domain or "warranty"
    summary = decision.summary or msg.message
    ticket = create_ticket_record(
        db, customer_id=principal.customer_id, vin=vin, component=component,
        domain=domain, summary=summary, apqc=decision.apqc_process,
    )

    # Link any evidence uploaded during this chat session to the new ticket.
    db.query(Attachment).filter(
        Attachment.session_id == msg.session_id, Attachment.ticket_id.is_(None)
    ).update({"ticket_id": ticket.id})
    db.delete(session)
    db.commit()

    # Kick off the orchestrator asynchronously — the HTTP response goes back immediately.
    background_tasks.add_task(run_ticket_graph, ticket.id)

    reply = (
        f"Thanks — I've logged your {domain} request (ticket {ticket.id[:8]}). "
        "Our team will review it shortly."
    )
    return IntakeReply(session_id=msg.session_id, reply=reply, enough_info=True,
                       ticket_id=ticket.id)
