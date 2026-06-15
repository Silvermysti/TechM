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

Photo evidence policy: a "[photo attached]" line in the conversation means the \
customer has already provided one. If the issue is one that would be VISIBLE in a \
photograph (body damage, dents, cracked or broken parts, fluid leaks, corrosion, \
worn tyres, a dashboard warning light) and no photo has been attached yet, set \
request_image=true, set enough_info=false, and politely ask for a photo in your \
follow_up_question (you may combine it with any other missing detail). If the issue \
cannot be seen in a photo (AC not cooling, unusual noises, vibration, intermittent \
electrical faults, performance problems), set request_image=false and do not ask for \
one. Never ask for a photo more than once: if you already asked, or the customer \
declines or cannot provide one, proceed without it.

If something essential is missing, set enough_info=false and give ONE short, friendly \
follow_up_question. Otherwise set enough_info=true and fill domain, summary, and the \
extracted fields."""


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
    max_followups: int = 2,
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
        # Bounded: stop asking and proceed with what we have.
        return decision, True

    return decision, bool(decision.enough_info)
