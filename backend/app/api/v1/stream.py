"""Server-Sent Events stream for live ticket/agent activity."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_principal
from app.db.session import get_db
from app.models import Ticket

router = APIRouter(prefix="/api/v1", tags=["stream"])


@router.get("/tickets/{ticket_id}/stream")
async def stream_ticket(
    ticket_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> StreamingResponse:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    if principal.role != "manager" and ticket.customer_id != principal.customer_id:
        raise HTTPException(status_code=404, detail="ticket not found")

    from app.services.events import subscribe

    async def event_stream():
        async for event in subscribe(ticket_id):
            if event.get("type") == "ping":
                yield ": ping\n\n"
            else:
                yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                 "Connection": "keep-alive"},
    )
