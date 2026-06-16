"""TDD: parts domain nodes."""

from app.core.langgraph.domains.parts import parts_check, parts_recommend
from app.schemas import PartsRecommendation


def _fake_decide(schema, system, user, **kwargs):
    if schema is PartsRecommendation:
        in_stock = "Stock quantity: 0" not in user
        return PartsRecommendation(
            action="ready_for_service" if in_stock else "order_required",
            reasoning="Stock level determines availability.",
            order_quantity=0 if in_stock else 3,
            customer_message="Your part is available." if in_stock
                             else "We'll need to order this part (3 days).",
        )
    raise AssertionError(f"unexpected schema {schema}")


def test_parts_check_finds_ac_in_stock():
    state = {"request_id": "p1", "domain": "parts", "component": "ac",
             "summary": "Need AC compressor", "context": {}}
    result = parts_check(state)
    stock = result["context"]["parts_stock"]
    assert stock["in_stock"] is True  # seed has 2 AC units
    assert stock["stock_qty"] == 2
    assert result["agent_outputs"][0]["agent"] == "Parts Inventory Specialist"


def test_parts_check_finds_brakes_out_of_stock():
    state = {"request_id": "p2", "domain": "parts", "component": "brakes",
             "summary": "Need brake pads", "context": {}}
    result = parts_check(state)
    stock = result["context"]["parts_stock"]
    assert stock["in_stock"] is False  # seed has 0 brakes
    assert stock["stock_qty"] == 0


def test_parts_recommend_in_stock(monkeypatch):
    from app.services import llm
    monkeypatch.setattr(llm, "decide", _fake_decide)

    state = {
        "request_id": "p3", "domain": "parts", "component": "ac",
        "summary": "Need AC compressor",
        "context": {"parts_stock": {"part_name": "AC Compressor", "stock_qty": 2,
                                    "eta_days": 1, "unit_price": 28000,
                                    "supplier": "Continental", "in_stock": True}},
        "agent_outputs": [],
    }
    result = parts_recommend(state)
    assert result["recommendation"]["action"] == "ready_for_service"
    assert result["recommendation"]["decision"] == "approve"


def test_parts_recommend_out_of_stock(monkeypatch):
    from app.services import llm
    monkeypatch.setattr(llm, "decide", _fake_decide)

    state = {
        "request_id": "p4", "domain": "parts", "component": "brakes",
        "summary": "Need brake pads",
        "context": {"parts_stock": {"part_name": "Brake Pad Set", "stock_qty": 0,
                                    "eta_days": 3, "unit_price": 4500,
                                    "supplier": "Bosch", "in_stock": False}},
        "agent_outputs": [],
    }
    result = parts_recommend(state)
    assert result["recommendation"]["action"] == "order_required"
    assert result["human_approval_required"] is True
