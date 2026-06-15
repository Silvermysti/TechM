"""Guided customer intake endpoint.

Holds a short per-session conversation in memory. Each message is evaluated by the
intake agent; if more info is needed it returns a follow-up question, otherwise it
creates a ticket and kicks off the orchestrator. (In-memory session store is fine for
a single-process demo.)

Evidence photos are uploaded against the chat session_id first, then linked to the
ticket once one is created.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.langgraph.intake import next_intake_step
from app.db.session import get_db
from app.models import Attachment
from app.schemas import AttachmentOut, IntakeMessage, IntakeReply
from app.services.graph_runner import start_ticket

router = APIRouter(prefix="/api/v1", tags=["intake"])

# backend/uploads/ — gitignored; served by the app at /uploads.
UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads"

# session_id -> {"history": [...], "asked": int, "vin": str|None}
_SESSIONS: dict[str, dict] = {}


@router.post("/intake/upload", response_model=AttachmentOut)
async def upload_evidence(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Attachment:
    """Store one evidence photo for an intake chat session."""
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are accepted.")

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
    (UPLOAD_DIR / att.stored_name).write_bytes(await file.read())

    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.post("/intake", response_model=IntakeReply)
def intake(msg: IntakeMessage, db: Session = Depends(get_db)) -> IntakeReply:
    session = _SESSIONS.setdefault(
        msg.session_id, {"history": [], "asked": 0, "vin": None, "category": None}
    )
    if msg.vin:
        session["vin"] = msg.vin
    if msg.category:
        session["category"] = msg.category

    # Make attached photos visible to the agent so it doesn't re-ask for them.
    content = msg.message
    if msg.attachment_ids:
        n = len(msg.attachment_ids)
        content = f"{content}\n[photo attached: {n} image{'s' if n > 1 else ''}]".strip()
    session["history"].append({"role": "user", "content": content})

    decision, proceed = next_intake_step(
        session["history"], session["asked"], known_vin=session.get("vin")
    )

    if not proceed:
        session["asked"] += 1
        question = decision.follow_up_question or "Could you tell me a bit more?"
        session["history"].append({"role": "assistant", "content": question})
        return IntakeReply(session_id=msg.session_id, reply=question,
                           enough_info=False, ticket_id=None,
                           request_image=decision.request_image)

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

    # Link any evidence uploaded during this chat session to the new ticket.
    db.query(Attachment).filter(
        Attachment.session_id == msg.session_id, Attachment.ticket_id.is_(None)
    ).update({"ticket_id": ticket.id})
    db.commit()

    _SESSIONS.pop(msg.session_id, None)

    reply = (
        f"Thanks — I've logged your {domain} request (ticket {ticket.id[:8]}). "
        "Our team will review it shortly."
    )
    return IntakeReply(session_id=msg.session_id, reply=reply, enough_info=True,
                       ticket_id=ticket.id)
