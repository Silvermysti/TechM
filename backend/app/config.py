"""Application settings (pydantic-settings).

Reads from environment / .env. The LLM provider is pluggable: `ollama` (default,
no API key) or the OpenAI-compatible hosted providers `groq` / `deepseek`.
Model names per tier fall back to per-provider defaults when not set explicitly.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Per-provider default model names for the three tiers (fast/standard/complex).
# Overridable via MODEL_FAST / MODEL_STANDARD / MODEL_COMPLEX env vars.
_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    # mistral is non-reasoning and reliably respects Ollama's JSON-schema grammar;
    # qwen3.5 reasoning models emit prose and break structured output locally.
    "ollama": {
        "fast": "mistral:latest",
        "standard": "mistral:latest",
        "complex": "mistral:latest",
    },
    "groq": {
        "fast": "llama-3.1-8b-instant",
        "standard": "llama-3.3-70b-versatile",
        "complex": "llama-3.3-70b-versatile",
    },
    "deepseek": {
        "fast": "deepseek-chat",
        "standard": "deepseek-chat",
        "complex": "deepseek-reasoner",
    },
}

# OpenAI-compatible base URLs for the hosted providers.
_PROVIDER_BASE_URL: dict[str, str] = {
    "groq": "https://api.groq.com/openai/v1",
    "deepseek": "https://api.deepseek.com/v1",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # LLM
    llm_provider: str = "ollama"
    groq_api_key: str = ""
    deepseek_api_key: str = ""
    model_fast: str = ""
    model_standard: str = ""
    model_complex: str = ""
    ollama_host: str = "http://localhost:11434"

    # Database
    database_url: str = (
        "postgresql+psycopg://aftersales:aftersales@localhost:5432/aftersales"
    )

    # App
    cors_origins: str = "http://localhost:3000"

    # ---- derived helpers ---------------------------------------------------

    def model_for(self, tier: str) -> str:
        """Resolve the model name for a tier, honouring env overrides."""
        override = {
            "fast": self.model_fast,
            "standard": self.model_standard,
            "complex": self.model_complex,
        }.get(tier, "")
        if override:
            return override
        defaults = _PROVIDER_DEFAULTS.get(self.llm_provider, _PROVIDER_DEFAULTS["ollama"])
        return defaults[tier]

    def api_key(self) -> str:
        return {
            "groq": self.groq_api_key,
            "deepseek": self.deepseek_api_key,
        }.get(self.llm_provider, "")

    def base_url(self) -> str | None:
        return _PROVIDER_BASE_URL.get(self.llm_provider)

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
