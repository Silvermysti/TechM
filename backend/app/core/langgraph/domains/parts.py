"""Parts domain — check stock, recommend action.

Pipeline: parts_check (DB tool) -> parts_recommend (LLM)

Handles customer requests routed to domain="parts" (e.g. "I need new brake pads").
The check is pure-DB and deterministic; the recommendation may use LLM for the
customer-facing message.
"""

from __future__ import annotations

from app.core.langgraph.state import AfterSalesState
from app.schemas import PartsRecommendation

RECOMMEND_SYSTEM = """You are an automotive parts advisor.

You receive a stock check result for a requested component. Based on availability,
write a short customer message (1–2 sentences) and choose the action:
  • ready_for_service — part is in stock, customer can book a service appointment
  • order_required    — part is out of stock but can be ordered (eta provided)
  • out_of_stock      — no ETA, customer must wait for replenishment

Also provide reasoning (1 sentence) and order_quantity (0 if in stock, else suggest 2–5).

Be friendly and helpful. Do not apologise excessively."""


def _append_output(state: AfterSalesState, entry: dict) -> list[dict]:
    outputs = list(state.get("agent_outputs") or [])
    outputs.append(entry)
    return outputs


def parts_check(state: AfterSalesState) -> dict:
    """Query the parts inventory for the requested component."""
    from app.db.session import SessionLocal
    from app.models import PartInventory
    from sqlalchemy import func, select

    component = (state.get("component") or "").strip().lower()
    db = SessionLocal()
    try:
        part = db.execute(
            select(PartInventory).where(func.lower(PartInventory.component) == component)
        ).scalars().first()

        if part:
            stock_info = {
                "part_name": part.part_name,
                "sku": part.sku,
                "stock_qty": part.stock_qty,
                "eta_days": part.eta_days,
                "unit_price": part.unit_price,
                "supplier": part.supplier,
                "in_stock": part.stock_qty > 0,
            }
        else:
            stock_info = {
                "part_name": component,
                "sku": None,
                "stock_qty": 0,
                "eta_days": 0,
                "unit_price": 0.0,
                "supplier": None,
                "in_stock": False,
            }
    finally:
        db.close()

    context = dict(state.get("context") or {})
    context["parts_stock"] = stock_info

    return {
        "context": context,
        "agent_outputs": _append_output(
            state,
            {
                "agent": "Parts Inventory Specialist",
                "apqc": "4.3.1",
                "output": stock_info,
            },
        ),
    }


def parts_recommend(state: AfterSalesState) -> dict:
    """Recommend action based on stock level."""
    from app.services import llm

    context = state.get("context") or {}
    stock = context.get("parts_stock", {})

    user = (
        f"Component requested: {state.get('component', 'unknown')}\n"
        f"Customer query: {state.get('summary', '')}\n"
        f"Part name: {stock.get('part_name', '')}\n"
        f"Stock quantity: {stock.get('stock_qty', 0)}\n"
        f"ETA if ordered: {stock.get('eta_days', 0)} days\n"
        f"Unit price: ₹{stock.get('unit_price', 0):,.0f}"
    )
    recommendation: PartsRecommendation = llm.decide(
        PartsRecommendation, system=RECOMMEND_SYSTEM, user=user, tier="fast"
    )

    rec = {
        "decision": "approve" if recommendation.action == "ready_for_service" else "escalate",
        "confidence": 0.95,
        "reasoning": recommendation.reasoning,
        "draft_email": recommendation.customer_message,
        "action": recommendation.action,
        "order_quantity": recommendation.order_quantity,
    }

    return {
        "recommendation": rec,
        "human_approval_required": recommendation.action != "ready_for_service",
        "agent_outputs": _append_output(
            state,
            {
                "agent": "Parts Advisor",
                "apqc": "4.3.2",
                "output": recommendation.model_dump(),
            },
        ),
    }
