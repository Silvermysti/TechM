"""Ticket endpoints: list, detail (with reasoning trace), and human decision."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Ticket
from app.schemas import DecisionRequest, TicketOut
from app.services.graph_runner import decide_ticket

router = APIRouter(prefix="/api/v1", tags=["tickets"])


@router.get("/tickets", response_model=list[TicketOut])
def list_tickets(db: Session = Depends(get_db)) -> list[Ticket]:
    return list(db.scalars(select(Ticket).order_by(Ticket.created_at.desc())).all())


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: str, db: Session = Depends(get_db)) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    return ticket


@router.post("/tickets/{ticket_id}/decision", response_model=TicketOut)
def decide(ticket_id: str, req: DecisionRequest,
           db: Session = Depends(get_db)) -> Ticket:
    ticket = decide_ticket(db, ticket_id=ticket_id, decision=req.decision,
                           actor=req.actor)
    if ticket is None:
        raise HTTPException(status_code=404,
                            detail="ticket not found or not awaiting a decision")
    return ticket
