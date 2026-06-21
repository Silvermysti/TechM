"""Run the warranty decision-quality eval against the configured LLM provider.

Usage (from backend/, venv active):
    python -m tests.eval.run_eval

It uses an isolated temporary SQLite DB (so it never touches your dev data), seeds the
demo fleet into it, then runs every labeled scenario through the real pipeline + the
LLM judge and prints a scorecard. The LLM provider/keys come from your .env.
"""

from __future__ import annotations

import os
import pathlib
import tempfile

# Point at an isolated DB *before* importing any app module (config reads this at import).
_EVAL_DB = pathlib.Path(tempfile.gettempdir()) / "aftersales_eval.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_EVAL_DB}"


def main() -> None:
    from app.config import get_settings
    from app.seed.seed import seed
    from tests.eval.harness import evaluate, score_run
    from tests.eval.scenarios import SCENARIOS

    provider = get_settings().llm_provider
    print(f"\nRunning warranty eval — provider={provider}, {len(SCENARIOS)} scenarios\n")
    if provider == "ollama":
        print("  (note: provider is 'ollama' — set LLM_PROVIDER=deepseek/groq in .env "
              "for a hosted run)\n")

    seed()  # fresh isolated DB with the deterministic demo VINs

    results = []
    for sc in SCENARIOS:
        r = evaluate(sc, judge=True)
        results.append(r)
        ok = "✓" if r.decision_match else "✗"
        judge = f"judge {r.judge_score}/5" if r.judge_score is not None else "judge n/a"
        print(f"  {ok} {sc.id:28} decision={r.decision:8} "
              f"(want {sc.expected_decision:8}) clause={r.cited_clause or '-':12} {judge}")

    s = score_run(results)
    print("\n── Scorecard ─────────────────────────────")
    print(f"  decision accuracy : {s['decision_accuracy']:.0%}")
    print(f"  coverage accuracy : {s['coverage_accuracy']:.0%}")
    if s["avg_judge_score"] is not None:
        print(f"  avg reasoning score: {s['avg_judge_score']:.2f} / 5")
    print()


if __name__ == "__main__":
    main()
