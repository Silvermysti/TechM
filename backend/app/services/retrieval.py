"""Policy RAG — the *retrieval* half of Retrieval-Augmented Generation.

Given a claim description, this finds the warranty clauses most relevant to it, so the
recommendation node can quote real contract wording instead of paraphrasing from the
model's memory (the usual source of hallucinated coverage terms).

How it works (semantic search):
  1. On first use we load a small embedding model (sentence-transformers) and turn every
     clause in `warranty_terms.py` into a vector — a list of numbers capturing its
     *meaning*. Done once, then cached.
  2. For a claim, we embed the claim text the same way and compare it to every clause
     vector by cosine similarity ("how close do these two meaning-vectors point").
  3. The closest clauses win — even when they share no literal words with the claim
     (e.g. "won't get cold" still matches the air-conditioning clause).

Offline-safe: if sentence-transformers / its weights aren't available, we fall back to a
plain keyword-overlap scorer so the app still runs (degraded, but never crashes) — the
same philosophy as the Ollama LLM fallback elsewhere in this project.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache

from app.data.warranty_terms import CLAUSES, Clause, clauses_for_model

logger = logging.getLogger(__name__)

# Small, fast, CPU-friendly embedding model — ~80MB, good enough for short clauses.
_EMBED_MODEL_NAME = "all-MiniLM-L6-v2"

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "and", "or", "is", "are", "of", "to", "for", "on", "in", "my",
    "it", "this", "that", "with", "i", "we", "was", "were", "be", "has", "have", "not",
    "from", "at", "as", "by", "but", "if", "so", "no",
}


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS}


# --------------------------------------------------------------------------- #
# Backends — both expose rank(query, candidates, k) -> [(Clause, score), ...]
# --------------------------------------------------------------------------- #
class _EmbeddingBackend:
    """Semantic search over clause meaning-vectors (the real RAG path)."""

    name = "embeddings"

    def __init__(self, model, vectors, np) -> None:
        self._model = model
        self._vectors = vectors  # clause.id -> normalized vector
        self._np = np

    def rank(self, query: str, candidates: list[Clause], k: int) -> list[tuple[Clause, float]]:
        # normalize_embeddings=True makes vectors unit-length, so a plain dot product
        # equals cosine similarity (a value in roughly [-1, 1]; higher = more similar).
        q = self._model.encode([query], normalize_embeddings=True)[0]
        scored = [
            (c, float(self._np.dot(q, self._vectors[c.id])))
            for c in candidates
            if c.id in self._vectors
        ]
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:k]


class _KeywordBackend:
    """Offline fallback: rank by how many meaningful words the clause shares."""

    name = "keyword"

    def rank(self, query: str, candidates: list[Clause], k: int) -> list[tuple[Clause, float]]:
        q_words = _tokens(query)
        scored = []
        for c in candidates:
            c_words = _tokens(c.text)
            overlap = len(q_words & c_words)
            denom = len(q_words) or 1
            scored.append((c, overlap / denom))
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:k]


@lru_cache(maxsize=1)
def _backend():
    """Build the retrieval backend once. Tries embeddings; falls back to keyword."""
    try:
        import numpy as np
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(_EMBED_MODEL_NAME)
        texts = [c.text for c in CLAUSES]
        embeddings = model.encode(texts, normalize_embeddings=True)
        vectors = {c.id: embeddings[i] for i, c in enumerate(CLAUSES)}
        logger.info("Policy RAG: embedded %d clauses with %s", len(CLAUSES), _EMBED_MODEL_NAME)
        return _EmbeddingBackend(model, vectors, np)
    except Exception as exc:  # ImportError, model-download failure, etc.
        logger.warning("Policy RAG: embeddings unavailable (%s) — using keyword fallback", exc)
        return _KeywordBackend()


def backend_name() -> str:
    """Which retrieval engine is live ('embeddings' or 'keyword'). Handy for tests/logs."""
    return _backend().name


def retrieve(query: str, *, model: str | None = None, k: int = 2) -> list[dict]:
    """Return the top-k warranty clauses most relevant to `query`.

    Each result is a plain dict (JSON-friendly, so it drops straight into the reasoning
    chain / audit log):
        {id, model, component, text, score, method}
    """
    if not query or not query.strip():
        return []
    candidates = clauses_for_model(model)
    ranked = _backend().rank(query.strip(), candidates, k)
    method = _backend().name
    return [
        {
            "id": c.id,
            "model": c.model,
            "component": c.component,
            "text": c.text,
            "score": round(score, 4),
            "method": method,
        }
        for c, score in ranked
    ]
