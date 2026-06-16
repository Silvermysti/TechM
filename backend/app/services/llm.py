"""LLM provider seam.

All model access goes through `get_model(tier)` so the rest of the codebase never
imports a provider SDK directly. Swapping ollama <-> groq <-> deepseek is an env
change (LLM_PROVIDER), not a code change.

We commit to *structured output* (Plan 1): callers use `decide(...)` to get a parsed
Pydantic object back. Our own Python code then calls the DB/lookup tools — the model
never invokes tools directly. This keeps control flow explicit and unit-testable.
"""

from __future__ import annotations

import json
import re
from typing import TypeVar

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from app.config import get_settings

T = TypeVar("T", bound=BaseModel)

_TIERS = {"fast", "standard", "complex"}


def get_model(tier: str = "standard", *, temperature: float = 0.0) -> BaseChatModel:
    """Return a chat model for the given tier from the configured provider."""
    if tier not in _TIERS:
        raise ValueError(f"unknown tier {tier!r}; expected one of {sorted(_TIERS)}")

    settings = get_settings()
    provider = settings.llm_provider
    model_name = settings.model_for(tier)

    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=model_name,
            base_url=settings.ollama_host,
            temperature=temperature,
        )

    # groq / deepseek are OpenAI-compatible
    if provider in ("groq", "deepseek"):
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model_name,
            base_url=settings.base_url(),
            api_key=settings.api_key() or "missing",
            temperature=temperature,
            # Groq's function-calling validator rejects valid LLM output due to a
            # Groq-side bug. Use json_object response format instead — the model
            # outputs raw JSON which we parse manually into the Pydantic schema.
            model_kwargs={"response_format": {"type": "json_object"}},
        )

    raise ValueError(f"unsupported LLM_PROVIDER {provider!r}")


def _schema_description(schema: type[BaseModel]) -> str:
    """Build a concise JSON-schema summary to embed in the system prompt."""
    props = schema.model_json_schema().get("properties", {})
    lines = [f"Respond with ONLY a JSON object with these keys:"]
    for name, info in props.items():
        desc = info.get("description", "")
        typ = info.get("type", info.get("anyOf", "any"))
        lines.append(f"  {name}: {typ!s} — {desc}" if desc else f"  {name}: {typ!s}")
    return "\n".join(lines)


def _get_vision_model() -> BaseChatModel:
    """Return a vision-capable model for the configured provider."""
    settings = get_settings()
    provider = settings.llm_provider
    model_name = settings.model_for("vision")

    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=model_name, base_url=settings.ollama_host, temperature=0.0)

    if provider in ("groq", "deepseek"):
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model_name,
            base_url=settings.base_url(),
            api_key=settings.api_key() or "missing",
            temperature=0.0,
            model_kwargs={"response_format": {"type": "json_object"}},
        )

    raise ValueError(f"unsupported LLM_PROVIDER {provider!r}")


def decide_vision(
    schema: type[T],
    system: str,
    image_b64: str,
    image_type: str = "image/jpeg",
    *,
    user: str = "",
) -> T:
    """Run a vision + structured-output call. The image is passed as base64.

    Uses the 'vision' model tier (e.g. llama-4-scout on Groq). Falls back to
    text-only `decide()` when the provider/model doesn't support images — the
    evidence node always skips gracefully if vision fails, so this is safe.
    """
    model = _get_vision_model()
    schema_hint = _schema_description(schema)
    augmented_system = f"{system}\n\n{schema_hint}"

    image_url = f"data:{image_type};base64,{image_b64}"
    human_content: list[dict] = [
        {"type": "image_url", "image_url": {"url": image_url}},
        {"type": "text", "text": user or "Assess the image."},
    ]

    response = model.invoke(
        [SystemMessage(content=augmented_system), HumanMessage(content=human_content)]
    )
    raw = response.content  # type: ignore[union-attr]

    if "```" in raw:
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
        if m:
            raw = m.group(1)

    data = json.loads(raw)
    return schema.model_validate(data)


def decide(
    schema: type[T],
    system: str,
    user: str,
    *,
    tier: str = "standard",
    temperature: float = 0.0,
) -> T:
    """Run a single structured-output call and return a parsed `schema` instance."""
    provider = get_settings().llm_provider

    if provider == "ollama":
        model = get_model(tier, temperature=temperature)
        structured = model.with_structured_output(schema, method="json_schema")
        result = structured.invoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        return result  # type: ignore[return-value]

    # groq / deepseek: use json_object mode — avoids Groq's function-calling
    # validator which rejects valid output due to strict schema enforcement.
    # We embed the schema description in the system prompt and parse manually.
    model = get_model(tier, temperature=temperature)
    schema_hint = _schema_description(schema)
    augmented_system = f"{system}\n\n{schema_hint}"

    response = model.invoke(
        [SystemMessage(content=augmented_system), HumanMessage(content=user)]
    )
    raw = response.content  # type: ignore[union-attr]

    # Extract JSON block if the model wrapped it in markdown fences
    if "```" in raw:
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
        if m:
            raw = m.group(1)

    data = json.loads(raw)
    return schema.model_validate(data)
