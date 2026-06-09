"""Tier-1 Master Orchestrator (LangGraph StateGraph).

Flow:  enrich -> route_to_domain -> [warranty pipeline | stub] -> await_human -> finalize

Human-in-the-loop is structural: `await_human` calls `interrupt()`, so nothing
high-stakes finalizes without a human decision. State is persisted by a checkpointer
(InMemorySaver for dev — survives across requests within the running server; swap to
PostgresSaver for multi-instance/durable runs).
"""

from __future__ import annotations

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.core.langgraph.domains.warranty import (
    warranty_fraud,
    warranty_recommend,
    warranty_validate,
)
from app.core.langgraph.state import AfterSalesState

# Domains that have a real pipeline today; others fall through to the stub.
REAL_DOMAINS = {"warranty"}

_FINAL_STATUS = {"approve": "resolved", "reject": "rejected", "escalate": "escalated"}


# --------------------------------------------------------------------------- #
# Nodes
# --------------------------------------------------------------------------- #
def classify_and_enrich(state: AfterSalesState) -> dict:
    """Enrich context with customer/vehicle data from the DB."""
    from app.db.session import SessionLocal
    from app.models import Customer, Vehicle

    context = dict(state.get("context") or {})
    vin = state.get("vehicle_vin")
    customer_id = state.get("customer_id")
    if vin:
        db = SessionLocal()
        try:
            vehicle = db.get(Vehicle, vin)
            if vehicle:
                context["vehicle"] = {"model": vehicle.model, "year": vehicle.year,
                                      "purchase_date": vehicle.purchase_date.isoformat()}
                customer_id = customer_id or vehicle.customer_id
                customer = db.get(Customer, vehicle.customer_id)
                if customer:
                    context["customer"] = {"name": customer.name,
                                           "email": customer.email}
        finally:
            db.close()
    return {"context": context, "customer_id": customer_id}


def domain_router(state: AfterSalesState) -> str:
    """Conditional-edge selector: a real domain or the stub."""
    domain = state.get("domain")
    return domain if domain in REAL_DOMAINS else "stub"


def stub_domain(state: AfterSalesState) -> dict:
    """Placeholder for domains not yet implemented (Phase 2/3)."""
    domain = state.get("domain", "unknown")
    rec = {
        "decision": "escalate",
        "confidence": 0.5,
        "reasoning": f"The '{domain}' domain is not yet automated; routing to a human.",
        "draft_email": "",
    }
    return {"recommendation": rec, "human_approval_required": True}


def await_human(state: AfterSalesState) -> dict:
    """Pause for a human decision. Resumed via Command(resume=<decision>)."""
    decision = interrupt(
        {
            "type": "approval_request",
            "summary": state.get("summary"),
            "recommendation": state.get("recommendation"),
        }
    )
    return {"human_decision": decision}


def finalize(state: AfterSalesState) -> dict:
    decision = state.get("human_decision")
    return {"final_status": _FINAL_STATUS.get(decision or "", "resolved")}


# --------------------------------------------------------------------------- #
# Graph assembly
# --------------------------------------------------------------------------- #
def build_graph():
    g = StateGraph(AfterSalesState)
    g.add_node("enrich", classify_and_enrich)
    g.add_node("warranty_validate", warranty_validate)
    g.add_node("warranty_fraud", warranty_fraud)
    g.add_node("warranty_recommend", warranty_recommend)
    g.add_node("stub", stub_domain)
    g.add_node("await_human", await_human)
    g.add_node("finalize", finalize)

    g.add_edge(START, "enrich")
    g.add_conditional_edges(
        "enrich", domain_router,
        {"warranty": "warranty_validate", "stub": "stub"},
    )
    g.add_edge("warranty_validate", "warranty_fraud")
    g.add_edge("warranty_fraud", "warranty_recommend")
    g.add_edge("warranty_recommend", "await_human")
    g.add_edge("stub", "await_human")
    g.add_edge("await_human", "finalize")
    g.add_edge("finalize", END)
    return g


# Compile once with a process-wide checkpointer so paused threads survive between
# the submit request and the later approve request.
_checkpointer = InMemorySaver()
_graph = build_graph().compile(checkpointer=_checkpointer)


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def start_run(state: AfterSalesState, *, thread_id: str) -> dict:
    """Run the graph until it pauses for human approval (or finishes)."""
    _graph.invoke(state, _config(thread_id))
    snap = _graph.get_state(_config(thread_id))
    return {
        "interrupted": bool(snap.next),
        "recommendation": snap.values.get("recommendation"),
        "values": snap.values,
    }


def resume_run(*, thread_id: str, decision: str) -> dict:
    """Resume a paused graph with the human's decision and return final state."""
    _graph.invoke(Command(resume=decision), _config(thread_id))
    snap = _graph.get_state(_config(thread_id))
    values = dict(snap.values)
    return values
