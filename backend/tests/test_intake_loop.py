"""TDD: bounded guided-intake loop logic.

The LLM "decider" is injected, so we test the loop control (when to ask a follow-up
vs proceed) without a live model.
"""

from app.core.langgraph.intake import next_intake_step
from app.schemas import IntakeDecision, ExtractedFields


def _decision(enough, q="", domain="warranty"):
    return IntakeDecision(
        enough_info=enough,
        follow_up_question=q,
        domain=domain,
        summary="AC not working",
        extracted=ExtractedFields(component="ac"),
    )


def test_proceeds_when_enough_info():
    decider = lambda history: _decision(True, domain="warranty")
    decision, proceed = next_intake_step(
        history=[{"role": "user", "content": "My AC is broken, VIN ABC"}],
        asked_count=0,
        decider=decider,
    )
    assert proceed is True
    assert decision.domain == "warranty"


def test_asks_follow_up_when_not_enough():
    decider = lambda history: _decision(False, q="When did it start?")
    decision, proceed = next_intake_step(
        history=[{"role": "user", "content": "My AC is broken"}],
        asked_count=0,
        decider=decider,
    )
    assert proceed is False
    assert decision.follow_up_question == "When did it start?"


def test_forces_proceed_after_max_followups():
    # decider keeps saying "not enough", but we've already asked twice -> proceed
    decider = lambda history: _decision(False, q="another question?")
    decision, proceed = next_intake_step(
        history=[{"role": "user", "content": "..."}],
        asked_count=2,
        decider=decider,
        max_followups=2,
    )
    assert proceed is True
