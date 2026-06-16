# Automotive After-Sales AI Command Center

A working demo of **Plan B (Unified AI Command Center)**: a 3-tier LangGraph agent hierarchy
that automates automotive after-sales — warranty, recall, and parts — with a **human in the
loop** for every high-stakes decision. Built for a Tech Mahindra internship project.

---

## What's built

| Portal | Who uses it | What they can do |
|--------|-------------|-----------------|
| Customer | Vehicle owners | Guided intake chat · live status tracker · claim reference |
| Manager | After-sales managers | Approval queue · AI reasoning chain · live agent monitor · audit log · performance trends |
| Dealer | Technicians | Open warranty jobs · parts inventory |
| Admin | Manufacturer ops | Recall management · trigger recall pipeline · audit log |

**Domains implemented:**
- **Warranty** (full) — validate coverage → fraud check → cost estimate → tiered auto-approve or human HITL
- **Recall** (full) — assess severity → draft customer comms → human approval
- **Parts** (full) — stock check → recommend reorder or service-ready
- Customer / Quality / Service — stubbed (same interface, no LLM cost)

---

## Architecture

```
Customer Portal ──┐                           ┌── Manager Command Center
Dealer Portal  ──┤   FastAPI REST + SSE      ├── Admin Console
Admin Console  ──┘   api/v1/                 └── (live agent monitor via EventSource)
                          │
               services/graph_runner
                 (BackgroundTasks — returns immediately)
                          │
          LangGraph Master Orchestrator
   enrich → route → domain pipeline → (auto-finalize | await_human interrupt) → finalize
                          │
            SQLite (dev) / Postgres (prod)
            Groq / DeepSeek / Ollama  (via services/llm.py seam)
```

**Key design choices:**
- **Structured output, not tool-calling** — the LLM returns a Pydantic decision object; our Python calls DB tools. Deterministic + unit-testable.
- **Human-in-the-loop via `interrupt()`** — the graph pauses at `await_human`; manager resumes with `Command(resume=...)`. Nothing high-stakes auto-finalizes.
- **Tiered autonomy** — low-cost + high-confidence + low-fraud warranty claims auto-approve; everything else queues for review. Thresholds in `backend/app/config.py`.
- **SSE live monitor** — agent steps are published to a thread-safe event bus; the Manager's Agent Monitor streams them via `EventSource` (no WebSocket).
- **Background execution** — intake returns in milliseconds; the LangGraph pipeline runs in a FastAPI `BackgroundTask` with its own DB session.
- **Data redaction** — customers receive `CustomerTicketOut` (no fraud scores, no internal trace); managers get the full `TicketOut`.

---

## Prerequisites

- Python 3.12, Node 20+
- **LLM provider (one of):**
  - **Groq** API key — fast, free tier available, recommended for demos
  - **DeepSeek** API key — strong reasoning models
  - **Ollama** (local) — zero cost but slow on CPU; use `ollama pull mistral`

---

## Run locally (SQLite, no Docker)

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # fill in LLM_PROVIDER + key; defaults to groq
python -m app.seed.seed       # seed the mock fleet
uvicorn app.main:app --reload # http://localhost:8000  (/docs for the API)
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Demo logins (after seeding):
- Customer: `rajesh.demo@example.com` / `demo1234`
- Manager: `manager@techmahindra.com` / `manager123`

---

## Run with Docker Compose (Postgres + backend + frontend)

```bash
cp backend/.env.example backend/.env    # fill in your LLM key
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000 · Docs: http://localhost:8000/docs

The backend container seeds the database automatically on first start.

---

## Tests

```bash
cd backend && source .venv/bin/activate && pytest
```

40 tests covering: warranty eligibility, intake loop, orchestrator routing, LangGraph
pause/resume, ticket HTTP lifecycle, SSE event types, recall domain, parts domain, audit
log, claims API. LLM calls are monkeypatched so tests run offline and fast.

---

## Demo walkthrough

### Warranty claim (full HITL loop)
1. Open http://localhost:3000 → **Login as Customer** (Rajesh)
2. Pick **Warranty Issue**, describe: *"My AC stopped working 3 months after purchase"*
3. The agent asks one clarifying question if needed, then creates a ticket (returns in ~1s)
4. Switch to **Manager Portal** → the ticket appears in **Approval Queue** with the full AI
   reasoning chain (validate → fraud → cost → recommendation)
5. **Approve** → Customer Portal status flips to **resolved** with a claim reference number
6. Manager **Trends** tab shows updated approval rate, automation rate, total claim cost

### Recall pipeline
1. Login as **Admin** → **Recall Management** tab
2. Trigger a recall on the seeded RC-2026-BRK01 (brake recall)
3. Manager receives a recall ticket in the Agent Monitor showing the draft comms

### Parts check
1. Login as **Dealer** → **Parts Inventory** tab — shows stock levels, ETA, supplier
2. Out-of-stock parts are highlighted in red

---

## AWS-readiness map

| Local component | AWS target |
|----------------|-----------|
| SQLite | Amazon RDS PostgreSQL / Aurora Serverless |
| `uvicorn` process | ECS Fargate task (auto-scaling) |
| `BackgroundTasks` | AWS SQS + Lambda / Celery worker on ECS |
| SSE event bus (`services/events.py`) | API Gateway WebSocket / SQS fan-out |
| `backend/uploads/` | Amazon S3 + CloudFront CDN |
| `next dev` / standalone | ECS Fargate + CloudFront |
| JWT in-process | Amazon Cognito (User Pools + tokens) |
| `seed.py` one-time | RDS init via CodeBuild migration step |
| `.env` secrets | AWS Secrets Manager / Parameter Store |
| `docker compose` postgres | Aurora Multi-AZ |

---

## Layout

```
backend/
  app/
    api/v1/          — intake, tickets, claims, audit, recalls, parts, metrics, stream, auth
    core/langgraph/  — orchestrator + domain nodes (warranty, recall, parts)
    services/        — llm.py (provider seam), graph_runner.py, events.py (SSE bus), notify.py
    tools/           — pure Python: warranty_check, cost_estimate, claim_history
    models/          — SQLAlchemy ORM (tickets, claims, audit, recalls, parts, vehicles…)
    schemas/         — Pydantic: LLM decision objects + API contracts + CustomerTicketOut
    seed/            — seed.py: mock fleet of 32 customers, 50 vehicles, 6 parts, 1 recall
frontend/
  app/
    customer/        — intake chat + status tracker
    manager/         — approval queue + reasoning chain + trends + audit + agent monitor
    dealer/          — open jobs + parts inventory
    admin/           — recall management + audit
    login/           — role switcher + quick demo accounts
  lib/               — api.ts, auth.ts, useSSE.ts, types.ts
```
