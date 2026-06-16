"""Shared graph state — kept intentionally minimal (IDs + short strings + small dicts).

Bloated checkpoint state is the documented LangGraph performance trap, so we store
compact context, not raw LLM blobs.
"""

from __future__ import annotations

from typing import TypedDict


class AfterSalesState(TypedDict, total=False):
    request_id: str
    input_text: str
    customer_id: str | None
    vehicle_vin: str | None
    component: str | None
    domain: str
    apqc_process: str | None
    summary: str
    context: dict
    agent_outputs: list[dict]
    fraud_risk: float
    estimated_cost: float
    recommendation: dict | None
    human_approval_required: bool
    human_decision: str | None
    auto_finalized: bool
    final_status: str | None
    escalated: bool
    error: str | None
    attachment_ids: list[str]
