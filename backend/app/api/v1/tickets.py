"""Ticket endpoints: list, detail (with reasoning trace), and human decision.

All routes require authentication. Customers see only their own tickets; the human
decision is manager-only and the actor is taken from the verified token.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_principal, require_manager
from app.db.session import get_db
from app.models import Ticket
from app.schemas import DecisionRequest, TicketOut
from app.services.graph_runner import decide_ticket

router = APIRouter(prefix="/api/v1", tags=["tickets"])


@router.get("/tickets", response_model=list[TicketOut])
def list_tickets(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[Ticket]:
    q = select(Ticket).order_by(Ticket.created_at.desc())
    if principal.role != "manager":
        q = q.where(Ticket.customer_id == principal.customer_id)
    return list(db.scalars(q).all())


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(
    ticket_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    if principal.role != "manager" and ticket.customer_id != principal.customer_id:
        # Don't reveal existence of other customers' tickets.
        raise HTTPException(status_code=404, detail="ticket not found")
    return ticket


@router.post("/tickets/{ticket_id}/decision", response_model=TicketOut)
def decide(
    ticket_id: str,
    req: DecisionRequest,
    db: Session = Depends(get_db),
    manager: Principal = Depends(require_manager),
) -> Ticket:
    ticket = decide_ticket(db, ticket_id=ticket_id, decision=req.decision,
                           actor=manager.actor)
    if ticket is None:
        raise HTTPException(status_code=404,
                            detail="ticket not found or not awaiting a decision")
    return ticket
