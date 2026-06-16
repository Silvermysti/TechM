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
        # deepseek-reasoner ("thinking mode") rejects forced tool_choice, which
        # our function-calling structured output requires, so the chat model is
        # used for the complex tier too. Override via MODEL_COMPLEX if needed.
        "complex": "deepseek-chat",
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

    # Durable LangGraph checkpoints. For a sqlite DATABASE_URL we keep a sidecar
    # sqlite file so the ORM's drop_all/create_all never touches checkpoint tables;
    # for Postgres the saver creates its own tables in the same database.
    checkpoint_db_path: str = "./checkpoints.db"

    # Auth (JWT). Override JWT_SECRET in every real environment.
    jwt_secret: str = "dev-insecure-secret-change-me-0123456789abcdef"
    jwt_expire_minutes: int = 720  # 12h demo sessions

    # Intake session store (DB-backed) — abandoned chats expire after this.
    intake_session_ttl_minutes: int = 120

    # Tiered autonomy (Wave A): auto-finalize only clearly-safe warranty claims;
    # everything else still routes to a human. Disable to force HITL on everything.
    auto_approve_enabled: bool = True
    auto_approve_min_confidence: float = 0.85
    auto_approve_max_fraud: float = 0.15
    auto_approve_max_cost: float = 15000.0  # INR

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
