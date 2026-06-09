# Automotive After-Sales AI Command Center — Demo

A working demo of **Plan B (Unified AI Command Center)**: a 3-tier agent hierarchy that
automates automotive after-sales, with a **human in the loop** for every high-stakes
decision. This repo currently implements **Phase 1 — the warranty vertical, end to end**.

See `PLAN.md` for the full roadmap (Phases 0–4).

---

## What works today (Phase 1)

- **Guided intake** — a customer picks a category, describes the issue; the intake agent
  asks a clarifying question if needed (bounded), then creates a ticket.
- **Master orchestrator (LangGraph)** — classifies → routes → runs the **warranty**
  domain (validate against the mock warranty DB → fraud check → recommendation) →
  **pauses for human approval** (`interrupt()`) → finalizes.
- **Customer Portal** — submit + live status tracker (polls).
- **Manager Command Center** — KPIs, approval queue, full AI **reasoning chain**, and
  Approve / Reject / Escalate (the human can override the AI).

Domains Recall/Parts (real) and Customer/Quality/Service (stub) + live SSE monitor land
in Phase 2/3.

---

## Architecture

```
Customer Portal ─┐                              ┌─ Manager Command Center
                 │   FastAPI (REST)             │   (KPIs, approval queue, reasoning)
                 └──────────►  api/v1  ◄────────┘
                                  │
                        services/graph_runner
                                  │
                  LangGraph Master Orchestrator
        enrich → route → warranty(validate→fraud→recommend) → await_human → finalize
                                  │
                     Postgres/SQLite  +  Ollama/Groq/DeepSeek (via services/llm.py seam)
```

- **Agents use structured output** (`with_structured_output`): the LLM returns a decision
  object; our Python calls the DB tools. Deterministic and unit-testable.
- **Provider seam** (`backend/app/services/llm.py`): one env var (`LLM_PROVIDER`) switches
  between `ollama` (local, free), `groq`, and `deepseek` (hosted, OpenAI-compatible).

---

## Prerequisites

- Python 3.12, Node 20+
- An LLM provider — **one of**:
  - **Ollama** (local, default): `ollama pull mistral` (mistral is non-reasoning and
    reliably produces JSON; qwen3.5 reasoning models do not, locally).
  - **Groq** or **DeepSeek** API key (recommended — fast + much better reasoning).
- Postgres is optional; the demo defaults to SQLite so no DB server is needed.

---

## Run it

### 1. Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # then edit .env (provider, keys) — defaults to ollama+sqlite
python -m app.seed.seed       # load the mock fleet
uvicorn app.main:app --reload # http://localhost:8000  (/docs for the API)
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

### Switching to Groq / DeepSeek (recommended for a smooth demo)
In `backend/.env`:
```
LLM_PROVIDER=groq            # or deepseek
GROQ_API_KEY=...             # or DEEPSEEK_API_KEY=...
```
Model names per tier auto-default per provider (see `app/config.py`); override with
`MODEL_FAST` / `MODEL_STANDARD` / `MODEL_COMPLEX` if desired.

> **Note on local Ollama:** on CPU it works but is slow (~50s per LLM call, so ~2–3 min
> per ticket) and mistral's reasoning is rough. Hosted Groq/DeepSeek is near-instant and
> far more accurate — use it for live demos.

### Postgres (optional, production parity)
```bash
docker compose up -d postgres
# then in backend/.env set:
# DATABASE_URL=postgresql+psycopg://aftersales:aftersales@localhost:5432/aftersales
python -m app.seed.seed
```

---

## Demo script

1. Open **http://localhost:3000** → **Customer Portal**.
2. Pick **Warranty Issue**, keep the prefilled demo VIN `MA3DEMO00000SWIFT`, and send:
   *"My AC stopped working 3 months after I bought my Swift VXI."*
   → the agent logs a ticket and shows the status tracker.
3. Open **Manager Command Center** in another tab → the ticket is in **Needs your
   attention** with the full AI reasoning chain (validate → fraud → recommendation).
4. Click **Approve** → the Customer Portal status flips to **Decision Made / resolved**.

The demo VIN is a Swift VXI purchased 90 days ago with valid AC warranty coverage. The
Honda City 2023 recall cohort is also seeded, ready for the Phase 2 recall fan-out.

---

## Tests

```bash
cd backend && source .venv/bin/activate && pytest      # 15 tests
```
Covers warranty eligibility, the bounded intake loop, orchestrator routing, the full
LangGraph pause/resume cycle, and the ticket HTTP lifecycle. LLM calls are faked in
tests so they run offline and fast.

---

## Layout

- `backend/app/core/langgraph/` — orchestrator + domains (the agent graph)
- `backend/app/tools/` — plain-Python tools the agents call (warranty/VIN lookups)
- `backend/app/services/llm.py` — the provider seam
- `backend/app/api/v1/` — REST endpoints (intake, tickets, decision)
- `frontend/app/` — `/customer`, `/manager` (built), `/dealer`, `/admin` (Phase 3)
- One deliberate demo shortcut: no real auth — a role launcher stands in for Cognito.
