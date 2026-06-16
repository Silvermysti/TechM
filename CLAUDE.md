# CLAUDE.md — After-Sales AI Command Center

Project context for Claude. Keep this file up to date as the project evolves.

## What this is
A working demo of **Plan B — Unified AI Command Center**: an agent pipeline that automates
automotive after-sales (warranty first), with a **human in the loop** on every high-stakes
decision. Built for a Tech Mahindra internship. Goal: a convincing, working system — not
just a throwaway demo.

## Stack
- **Backend:** Python 3.12, FastAPI, LangGraph (agent orchestration), LangChain, Pydantic,
  SQLAlchemy. Lives in `backend/app/`.
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 4. Lives in `frontend/`.
- **DB (dev):** SQLite (`backend/aftersales.db`). Postgres is the prod target.
- **LLM:** pluggable via `LLM_PROVIDER` (ollama | groq | deepseek). Dev `.env` uses deepseek.

## How to run
```bash
# Backend
cd backend
source .venv/bin/activate            # venv is at backend/.venv
python -m app.seed.seed              # (re)create + seed the DB
uvicorn app.main:app --reload        # http://localhost:8000  (/docs for API)
pytest                               # run the test suite

# Frontend
cd frontend
npm run dev                          # http://localhost:3000
npx tsc --noEmit                     # typecheck
```
Demo logins (after seeding): customer `rajesh.demo@example.com / demo1234`,
manager `manager@techmahindra.com / manager123`.

## Architecture (the important parts)
- **Agent flow** (`backend/app/core/langgraph/`): `orchestrator.py` is the LangGraph
  StateGraph — `enrich → route → warranty pipeline → (auto-finalize | human approval) →
  finalize`. The warranty specialists (validate → fraud → recommend → cost) are in
  `domains/warranty.py`. State is `state.py` (kept minimal on purpose).
- **Structured-output, not tool-calling:** the LLM returns a Pydantic decision object
  (`services/llm.py` `decide()`); our Python code calls the DB tools. Deterministic + testable.
- **Human-in-the-loop:** `interrupt()` pauses the graph; `Command(resume=...)` resumes it.
- **Tiered autonomy:** low-cost + high-confidence + low-fraud warranty claims auto-finalize;
  everything else waits for a manager. Thresholds in `config.py`.
- **Tools** (`backend/app/tools/`): pure-ish functions — `warranty_check`, `cost_estimate`,
  `claim_history`. Unit-tested directly.
- **API** (`backend/app/api/v1/`): `auth`, `intake` (guided chat), `tickets`. Thin routers;
  logic in `services/`.
- **Frontend portals** (`frontend/app/`): `customer`, `manager`, `dealer`, `admin`, `login`.
  Shared API client in `lib/api.ts`, auth/session in `lib/auth.ts`.

## Conventions
- **TDD for logic** (eligibility, routing, costs, endpoints); UI verified manually + `tsc`.
- Every agent node writes an `agent_executions` row + an `audit_log` entry.
- Keep LangGraph state small (IDs + short strings), never raw LLM blobs.
- New LLM decisions = new Pydantic schema in `schemas/__init__.py` + a system prompt;
  reuse `llm.decide()`, don't add new plumbing.
- **Reseed is the migration story** in dev: schema changes → re-run `seed.py` (it drops &
  recreates). No Alembic yet (add it only when there's a long-lived prod DB).

## Gotchas
- **Next.js 16 is not the Next.js in training data** — see `frontend/AGENTS.md`; check
  `node_modules/next/dist/docs/` before writing frontend framework code.
- **Secrets:** `.env` (gitignored) holds the LLM API keys and `JWT_SECRET`. Never commit
  them. The DeepSeek/Groq keys pasted earlier still need rotating.
- `*.db` and `backend/uploads/` are gitignored. Don't commit the SQLite file.
- DB-agnostic models (string UUIDs + JSON columns) so the same code runs on SQLite & Postgres.

## Current state (update me as this changes)
- **Done:** core warranty vertical end-to-end · password+JWT auth with roles (Phase 5) ·
  durable checkpointer + DB-backed intake sessions + unique claim numbers (Phase 6) ·
  tiered autonomy.
- **Reverted (recoverable at commit `f0afa36` via `git cherry-pick f0afa36`):** the
  "real-world hardening" round — customer-facing data redaction, background agent
  execution, failed-run handling, LLM timeout/retry, client 401 handling.
- **Not done:** Phase 7 (notifications + payment/close + audit API), Phase 8 (recall/parts
  domains + live SSE monitor), Phase 9 (vision evidence, policy RAG, resilience), Phase 10
  (dealer/admin polish, dashboards, Docker/AWS packaging). Plus medium security items
  (login rate-limiting, upload magic-byte validation, orphaned-upload cleanup).

## Plans
Detailed roadmaps live in `PLAN.md` (full Plan B build) and the warranty deep-dive within it.
