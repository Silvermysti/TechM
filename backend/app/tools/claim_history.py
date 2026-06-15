"""Claim-history tool — queries prior tickets to detect repeat-claim patterns.

Pure DB query, no LLM. Returns a compact dict the warranty_fraud node feeds to
the LLM so it has real behavioural signal, not just the current claim in isolation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Ticket

_REPEAT_THRESHOLD = 3  # ≥3 same-component claims from same VIN/customer → flag
_RECENT_DAYS = 90


def get_claim_history(
    db: Session,
    *,
    vin: str | None,
    customer_id: str | None,
    component: str | None,
    exclude_ticket_id: str | None = None,
) -> dict:
    """Return prior-claim statistics for fraud context.

    Returns:
        total_prior      — total prior tickets matching this VIN or customer
        same_component   — subset for the same component
        recent_90d       — tickets created in the last 90 days
        repeat_flag      — True when same_component >= _REPEAT_THRESHOLD
        summary          — one-line string ready to paste into an LLM prompt
    """
    if not vin and not customer_id:
        return _empty()

    filters = []
    if vin:
        filters.append(Ticket.vehicle_vin == vin)
    if customer_id:
        filters.append(Ticket.customer_id == customer_id)

    q = select(Ticket).where(or_(*filters))
    if exclude_ticket_id:
        q = q.where(Ticket.id != exclude_ticket_id)

    prior = db.scalars(q).all()
    total_prior = len(prior)

    comp_lower = (component or "").lower()
    same_component = sum(
        1 for t in prior if (t.component or "").lower() == comp_lower
    ) if comp_lower else 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=_RECENT_DAYS)
    recent_90d = sum(
        1 for t in prior
        if t.created_at is not None and _as_utc(t.created_at) >= cutoff
    )

    repeat_flag = same_component >= _REPEAT_THRESHOLD

    summary = _build_summary(total_prior, same_component, recent_90d, repeat_flag, component)
    return {
        "total_prior": total_prior,
        "same_component": same_component,
        "recent_90d": recent_90d,
        "repeat_flag": repeat_flag,
        "summary": summary,
    }


# ------------------------------------------------------------------ #
# helpers
# ------------------------------------------------------------------ #

def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_summary(total: int, same_comp: int, recent: int, repeat: bool, component: str | None) -> str:
    if total == 0:
        return "No prior claims found for this VIN/customer."
    parts = [f"{total} prior claim(s)"]
    if same_comp and component:
        parts.append(f"{same_comp} for '{component}'")
    if recent:
        parts.append(f"{recent} in last 90 days")
    if repeat:
        parts.append("⚠ REPEAT PATTERN DETECTED")
    return "; ".join(parts) + "."


def _empty() -> dict:
    return {
        "total_prior": 0,
        "same_component": 0,
        "recent_90d": 0,
        "repeat_flag": False,
        "summary": "No prior claims found for this VIN/customer.",
    }
