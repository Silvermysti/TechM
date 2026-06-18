"""Aggregate performance metrics for the manager trends panel."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_manager
from app.db.session import get_db
from app.models import AgentExecution, AuditLog, Ticket, WarrantyClaim

router = APIRouter(prefix="/api/v1", tags=["metrics"])


class DomainStat(BaseModel):
    domain: str
    count: int
    approved: int
    rejected: int
    avg_cost: float | None = None


class TrendMetrics(BaseModel):
    total_tickets: int
    auto_approved: int
    auto_rejected: int
    human_approved: int
    rejected: int
    awaiting: int
    failed: int
    avg_confidence: float | None = None
    total_claim_cost: float
    domains: list[DomainStat]


@router.get("/metrics", response_model=TrendMetrics, dependencies=[Depends(require_manager)])
def get_metrics(db: Session = Depends(get_db)) -> TrendMetrics:
    tickets = list(db.scalars(select(Ticket)).all())
    total = len(tickets)
    # "system:auto" = the system auto-finalized it (no manager). The decision itself
    # (approve / reject) is in human_decision, so we split auto by that.
    auto_approved = sum(
        1 for t in tickets
        if t.human_actor == "system:auto" and t.human_decision == "approve"
    )
    auto_rejected = sum(
        1 for t in tickets
        if t.human_actor == "system:auto" and t.human_decision == "reject"
    )
    human_approved = sum(
        1 for t in tickets
        if t.human_decision == "approve" and t.human_actor != "system:auto"
    )
    rejected = sum(1 for t in tickets if t.human_decision == "reject")
    awaiting = sum(1 for t in tickets if t.status == "awaiting_approval")
    failed = sum(1 for t in tickets if t.status == "failed")

    # Average confidence from agent_executions
    avg_conf_row = db.execute(
        select(func.avg(AgentExecution.confidence)).where(
            AgentExecution.confidence.isnot(None)
        )
    ).scalar_one_or_none()
    avg_confidence = float(avg_conf_row) if avg_conf_row is not None else None

    # Total claim cost
    total_cost_row = db.execute(
        select(func.sum(WarrantyClaim.total_cost))
    ).scalar_one_or_none()
    total_claim_cost = float(total_cost_row) if total_cost_row else 0.0

    # Per-domain breakdown
    domain_map: dict[str, DomainStat] = {}
    for t in tickets:
        d = t.domain or "unknown"
        if d not in domain_map:
            domain_map[d] = DomainStat(domain=d, count=0, approved=0, rejected=0)
        s = domain_map[d]
        s.count += 1
        # Auto-finalized tickets also set human_decision, so this covers both paths.
        if t.human_decision == "approve":
            s.approved += 1
        elif t.human_decision == "reject":
            s.rejected += 1

    # Avg claim cost per domain
    claim_costs = db.execute(
        select(Ticket.domain, func.avg(WarrantyClaim.total_cost))
        .join(WarrantyClaim, WarrantyClaim.ticket_id == Ticket.id)
        .group_by(Ticket.domain)
    ).all()
    for domain, avg in claim_costs:
        if domain in domain_map and avg is not None:
            domain_map[domain].avg_cost = float(avg)

    return TrendMetrics(
        total_tickets=total,
        auto_approved=auto_approved,
        auto_rejected=auto_rejected,
        human_approved=human_approved,
        rejected=rejected,
        awaiting=awaiting,
        failed=failed,
        avg_confidence=avg_confidence,
        total_claim_cost=total_claim_cost,
        domains=list(domain_map.values()),
    )
