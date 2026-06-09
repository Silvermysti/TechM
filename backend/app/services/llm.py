"""LLM provider seam.

All model access goes through `get_model(tier)` so the rest of the codebase never
imports a provider SDK directly. Swapping ollama <-> groq <-> deepseek is an env
change (LLM_PROVIDER), not a code change.

We commit to *structured output* (Plan 1): callers use `decide(...)` to get a parsed
Pydantic object back. Our own Python code then calls the DB/lookup tools — the model
never invokes tools directly. This keeps control flow explicit and unit-testable.
"""

from __future__ import annotations

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
        )

    raise ValueError(f"unsupported LLM_PROVIDER {provider!r}")


def decide(
    schema: type[T],
    system: str,
    user: str,
    *,
    tier: str = "standard",
    temperature: float = 0.0,
) -> T:
    """Run a single structured-output call and return a parsed `schema` instance."""
    model = get_model(tier, temperature=temperature)
    # Ollama needs the native JSON-schema grammar to guarantee parseable output;
    # OpenAI-compatible providers use their default structured-output method.
    if get_settings().llm_provider == "ollama":
        structured = model.with_structured_output(schema, method="json_schema")
    else:
        structured = model.with_structured_output(schema)
    result = structured.invoke(
        [SystemMessage(content=system), HumanMessage(content=user)]
    )
    return result  # type: ignore[return-value]
