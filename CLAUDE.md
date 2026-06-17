# CLAUDE.md — After-Sales AI Command Center

Project context for Claude. Keep this file up to date as the project evolves.

## What this is
A working demo of **Plan B — Unified AI Command Center**: a 3-tier LangGraph agent pipeline
that automates automotive after-sales (warranty, recall, parts), with a **human in the loop**
on every high-stakes decision. Built for a Tech Mahindra internship.

## Stack
- **Backend:** Python 3.12, FastAPI, LangGraph, LangChain, Pydantic, SQLAlchemy. `backend/app/`.
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 4. `frontend/`.
- **DB (dev):** SQLite (`backend/aftersales.db`). Postgres is the prod target (docker-compose has it).
- **LLM:** pluggable via `LLM_PROVIDER` (groq | deepseek | ollama). Dev `.env` uses Groq.

## How to run
```bash
# Backend
cd backend
source .venv/bin/activate            # venv is at backend/.venv
python -m app.seed.seed              # (re)create + seed the DB
uvicorn app.main:app --reload        # http://localhost:8000  (/docs for API)
pytest                               # 61 tests

# Frontend
cd frontend
npm run dev                          # http://localhost:3000
npx tsc --noEmit                     # typecheck

# Full stack via Docker (postgres + backend + frontend)
docker compose up --build            # seeds DB automatically on first start
```
Demo logins (after seeding): customer `rajesh.demo@example.com / demo1234`,
manager `manager@techmahindra.com / manager123`.

## Architecture (the important parts)

### Agent flow (`backend/app/core/langgraph/`)
`orchestrator.py` is the LangGraph StateGraph:
```
enrich → route → domain pipeline → (auto-finalize | await_human interrupt) → finalize
```
Domain pipelines:
- **Warranty** (`domains/warranty.py`): evidence (vision, 6.7.3.3) → validate (6.7.3.2) →
  fraud_check (6.7.5.5) → recommend (6.7.3.5) → cost_estimate (6.7.3.5) →
  responsible_party (6.7.3.4) → autonomy_router
- **Recall** (`domains/recall.py`): recall_assess → recall_draft_comms → await_human
- **Parts** (`domains/parts.py`): parts_check → parts_recommend → autonomy_router
- Customer / Quality / Service: stubbed (same node interface, no LLM cost)

### Key patterns
- **Structured-output, not tool-calling:** the LLM returns a Pydantic decision object
  (`services/llm.py` `decide()`); our Python code calls DB tools. Deterministic + testable.
- **Human-in-the-loop:** `interrupt()` pauses the graph; `Command(resume=...)` resumes it.
  **Escalate ≠ terminal:** a manager's `escalate` does NOT resume the graph — `decide_ticket` just
  re-labels the ticket `escalated` (interrupt stays pending) and re-queues it; a later approve/reject
  resumes the same paused thread. (Same-role for now; `senior_manager` separation is a planned refinement.)
- **Tiered autonomy:** low-cost + high-confidence + low-fraud claims auto-finalize; clear
  `reject` decisions also auto-finalize (no manager needed for clean denials); everything else
  waits for a manager. Logic in `orchestrator.py` `autonomy_router`; thresholds in `config.py`.
- **Background execution:** `intake.py` calls `create_ticket_record()` (immediate, status=processing)
  then `background_tasks.add_task(run_ticket_graph, ticket.id)`. The pipeline runs in a separate
  thread with its own DB session (`SessionLocal()`), not the request session.
- **SSE live monitor:** `services/events.py` is a thread-safe event bus (`publish` + `subscribe`).
  Nodes call `_emit()` in `graph_runner.py`. Browser subscribes via `EventSource` with `?token=`
  query param (EventSource can't set headers). History is buffered so late subscribers replay it.
- **Data redaction:** customers get `CustomerTicketOut` (no fraud scores, no agent trace);
  managers get the full `TicketOut`. See `api/v1/tickets.py` + `schemas/__init__.py`.
- **Failed runs:** if the graph throws, `run_ticket_graph` sets `status=failed`, emits SSE `done`,
  and writes an audit log entry.

### API (`backend/app/api/v1/`)
`auth`, `intake` (guided chat + photo upload), `tickets`, `claims`, `recoveries` (supplier recovery),
`audit`, `recalls`, `parts`, `metrics`, `stream` (SSE), `decisions` (via `tickets.py`).
Thin routers; logic in `services/`.

### Frontend portals (`frontend/app/`)
- `customer/` — intake chat, status tracker, my requests rail
- `manager/` — approval queue, reasoning chain, agent monitor (SSE), performance trends, transfers,
  supplier recovery, audit log
- `dealer/` — open jobs, parts inventory
- `admin/` — recall management, audit log
- `login/` — role switcher + quick demo accounts

Shared: `lib/api.ts` (REST + 401 auto-redirect), `lib/auth.ts`, `lib/useSSE.ts`, `lib/types.ts`.

## Conventions
- **TDD for logic** (eligibility, routing, costs, endpoints); UI verified manually + `tsc`.
- Every agent node writes an `agent_executions` row + emits an SSE event + writes `audit_log`.
- Keep LangGraph state small (IDs + short strings), never raw LLM blobs.
- New LLM decisions = new Pydantic schema in `schemas/__init__.py` + a system prompt in
  `core/langgraph/prompts/`; reuse `llm.decide()`, don't add new plumbing.
- **Reseed is the migration story** in dev: schema changes → re-run `seed.py` (drops & recreates).
  No Alembic yet.

## Gotchas
- **Next.js 16 is not the Next.js in training data** — see `frontend/AGENTS.md`; check
  `node_modules/next/dist/docs/` before writing frontend framework code.
- **Secrets:** `.env` (gitignored) holds `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `JWT_SECRET`.
  Never commit them. `.env.example` has placeholders only.
- `*.db` and `backend/uploads/` are gitignored. Don't commit the SQLite file.
- DB-agnostic models (string UUIDs + JSON columns) so the same code runs on SQLite & Postgres.
- `run_ticket_graph()` opens its own `SessionLocal()` — never pass a request-scoped session to it.
- SSE token auth: `deps.py` `get_current_principal` accepts `?token=` query param as fallback
  because `EventSource` cannot set the `Authorization` header.
- Uploaded files (photos + RC documents) are **private**: served only via authed
  `GET /api/v1/attachments/{id}` (manager = any; customer = own ticket only), NOT a public static
  mount. Frontend builds image URLs with `attachmentUrl(id)` (appends `?token=` for `<img>`/`<a>`).

## Current state
Demo phases complete; now finishing the warranty pipeline end-to-end (see `FORWARD-PLAN.md`).
71 tests passing, TypeScript clean.
- **Phase 5:** password + JWT auth with roles
- **Phase 6:** durable LangGraph checkpointer, DB-backed intake sessions, unique claim numbers
- **Phase 7:** notifications (`services/notify.py`), claim lifecycle (pay/close), audit API
- **Phase 8:** recall + parts domains, SSE live agent monitor, recall trigger endpoint
- **Phase 9:** background task execution, failed-run handling, `CustomerTicketOut` data redaction,
  frontend 401 auto-redirect
- **Phase 10:** performance trends panel (`GET /api/v1/metrics`), Docker Compose (all 3 services),
  backend + frontend Dockerfiles, full README with AWS-readiness table
- **Phase 1.6:** user self-registration (`POST /auth/register`), VIN claim flow (unknown VIN → **404**,
  own → already_owned, other's → transfer_requested), manager approve/reject with ownership flip,
  `VINTransferRequest` model, `GET /vehicles`, `GET /vehicles/transfers`
- **Phase 1.7:** bulk follow-up bullets in intake agent (all missing fields in one reply, max 1
  clarifying round), contextual upload zone per category, RC + PDF upload support
- **Phase 10 (vision):** `warranty_evidence` node — Groq vision photo assessment (`EvidenceAssessment`)

### Warranty pipeline completion (in progress — `FORWARD-PLAN.md` Part A/B/C)
- **A1 ✅ DONE:** responsible-party determination (APQC 6.7.3.4) — `tools/responsible_party.py` +
  `warranty_responsible_party` node; deterministic (manufacturer / supplier / indeterminate), drives
  supplier recovery; `build_warranty_claim` reuses it for `supplier_recoverable`.
- **A2 ✅ DONE:** supplier recovery workflow (APQC 6.7.4) — `SupplierRecovery` model,
  `services/supplier_recovery.py` (LLM draft), `api/v1/recoveries.py` (generate→send→recovered),
  manager "Supplier Recovery" tab. Lifecycle: draft → sent → recovered (writes `claim.recovered_amount`).
- **Next:** A3 real payment → A4 reconcile → B1 notifications → B2 appeals → C1 preauthorization →
  C2 activation → C3 investigation + **physical part-return/inspection loop** (gates A2 recovery + feeds
  fraud) → Phase D (deadlines/SLAs, goodwill, proactive warranty-expiry outreach). Then performance
  layer (Policy RAG, CSAT, CAPA, eval). Note: customer-facing **D2C design is intentional** (after-sales
  = customer relations); dealer-submission is an optional additive channel, not a gap.

> **APQC tagging:** `6.7.3.4` = *Determine responsible party*. Cost estimation has no dedicated APQC
> sub-code and is tagged under `6.7.3.5` (the decision).

### Medium-priority items not yet built
- Login rate-limiting
- Upload magic-byte validation (currently only checks `content_type` header)
- Orphaned-upload cleanup (uploads not linked to a ticket after TTL)

## Plans
- `FORWARD-PLAN.md` — **current plan of record**: warranty pipeline completion order (Part A/B/C) +
  performance layer + optional extras.
- `WARRANTY-BLUEPRINT.md` — the target ("done") warranty lifecycle, drawn + explained in plain English.
- `APQC-COVERAGE.md` — full APQC 6.7 scope across all six Plan B domains, with build status.
- `PLAN.md` — original full Plan B build doc (older wave ordering superseded by `FORWARD-PLAN.md`).
