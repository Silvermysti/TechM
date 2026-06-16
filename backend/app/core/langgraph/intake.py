"""Guided intake — the light conversational loop.

The intake agent reads the conversation so far and returns an `IntakeDecision`. If it
needs more info it proposes one follow-up question; the loop is *bounded* so it can't
interrogate forever — after `max_followups` it proceeds with whatever it has.

The LLM call is wrapped in `default_decider` but any `decider(history) -> IntakeDecision`
can be injected (used in tests).
"""

from __future__ import annotations

from collections.abc import Callable

from app.schemas import IntakeDecision

Decider = Callable[[list[dict]], IntakeDecision]

INTAKE_SYSTEM = """You are the intake agent for an automotive after-sales service \
desk. Read the customer conversation and decide whether you have enough information \
to create and route a service ticket.

You need: the affected component/symptom, and ideally when it started. The vehicle \
VIN normally comes from the customer's profile. Decide the domain (warranty, recall, \
parts, customer, quality, service) and the APQC process reference when possible \
(e.g. warranty claims = 6.7.3).

FOLLOW-UP RULE — ask for everything at once, never one item at a time:
- If TWO OR MORE things are missing, populate follow_up_bullets with one short \
bullet string per missing item. Leave follow_up_question null.
- If EXACTLY ONE thing is missing, put it in follow_up_question and leave \
follow_up_bullets empty.
- Never ask for something the customer already provided.
- Keep bullets short — 5 to 8 words each.

Example follow_up_bullets when component, onset date, and odometer are missing:
["Which part is affected? (e.g. AC, brakes, engine)",
 "When did this first happen?",
 "Current odometer reading (km)?"]

Photo evidence policy: a "[photo attached]" line means the customer already provided \
one. If the issue WOULD BE VISIBLE in a photo (body damage, dents, cracks, leaks, \
corrosion, worn tyres, dashboard warning lights) and no photo is attached yet, add a \
photo bullet as the LAST item in follow_up_bullets and set request_image=true. Do NOT \
ask for a photo for invisible issues (AC not cooling, noises, vibration, intermittent \
faults). Never ask for a photo more than once.

If everything needed is present, set enough_info=true and fill domain, summary, and \
the extracted fields."""


def _format_history(history: list[dict]) -> str:
    return "\n".join(f"{m['role']}: {m['content']}" for m in history)


def default_decider(history: list[dict]) -> IntakeDecision:
    from app.services.llm import decide

    return decide(
        IntakeDecision,
        system=INTAKE_SYSTEM,
        user=_format_history(history),
        tier="fast",
    )


def next_intake_step(
    history: list[dict],
    asked_count: int,
    *,
    decider: Decider | None = None,
    known_vin: str | None = None,
    max_followups: int = 1,
) -> tuple[IntakeDecision, bool]:
    """Evaluate the conversation and decide whether to proceed.

    Returns (decision, proceed). `proceed` is True when the agent has enough info OR
    we have already asked `max_followups` clarifying questions (bounded loop).

    `known_vin`, when the customer has already selected their vehicle, is injected as
    a context line so the agent doesn't re-ask for the VIN it already has.
    """
    decider = decider or default_decider
    eval_history = history
    if known_vin:
        eval_history = [
            {"role": "system",
             "content": f"VIN already on file: {known_vin}. Do not ask for the VIN."},
            *history,
        ]
    decision = decider(eval_history)

    if asked_count >= max_followups:
        return decision, True

    return decision, bool(decision.enough_info)


def format_follow_up(decision: "IntakeDecision") -> str:
    """Return the agent's follow-up message — bullets when multiple items missing,
    single question otherwise."""
    from app.schemas import IntakeDecision  # local import avoids circular
    if decision.follow_up_bullets:
        lines = "\n".join(f"• {b}" for b in decision.follow_up_bullets)
        return f"Just a few more details:\n{lines}"
    return decision.follow_up_question or "Could you tell me a bit more?"
