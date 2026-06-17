# Automotive After-Sales AI Command Center — Detailed Build Plan

**Project:** Plan B "Unified AI Command Center" — working demo of agentified automotive after-sales
**Author:** Breeti · TechM Internship
**Status:** **Phase 1 complete & verified** (warranty vertical, end-to-end, 15 tests green) · **Updated:** 2026-06-09
**This is a learning-ordered build document for a first-timer on this stack.**

> **⚠️ Scope update (2026-06-09):** Breeti's reporting manager has re-scoped active work to **warranty
> only** for now. The full 6-domain Plan B (recall, parts, etc.) remains the long-term vision documented
> below, but the **current build focus is depth on warranty**. The detailed warranty component map, the
> ELI5 explanations, the tech stack per component, and the **locked build order** live in
> **`../Meet3-prep/warranty-component-plan.md`** — that is the active plan of record for what comes next.
> Phases 2–4 below (cross-domain recall, other portals) are **paused**, not cancelled.

---

## 1. Context & Goal

The mentor asked for **technical groundwork** to run in parallel with the pitch deck. This document
plans a **working demo** of the recommended solution — **Plan B, the Unified AI Command Center** — that
agentifies the automotive after-sales lifecycle (warranty, recalls, parts, complaints, service, quality).

The demo must:
- **Look like Plan B's full vision** — 3-tier agent hierarchy, 4 role portals, multiple APQC processes.
- **Run locally** on a laptop for live demos / screen-share.
- **Be buildable solo** by someone new to LangGraph / FastAPI / Next.js.
- **Tell a sales story** — Problem → Solution → Method, with a clear differentiator (cross-domain
  orchestration + human-in-the-loop that competitors' flat single-agent bots can't do).

> **Guiding principle (scope honesty):** This is a large build for one person. The plan is **phased so
> each phase is independently demoable**, and **Phase 1 alone is a complete, valid deliverable** (a full
> human-in-the-loop warranty workflow). If time runs short, stop after any phase — you still have
> something real to show. Everything after Phase 1 adds *breadth*, not core viability.

### Source specs to build against (do not re-invent — these already exist)
| File | What it gives you |
|---|---|
| `../Meet2-prep/plans/plan-b-unified-command-center/02-agent-hierarchy.md` | Tier-1/2/3 agents, domains, specialists, the cross-domain recall flow |
| `../Meet2-prep/plans/plan-b-unified-command-center/03-portal-designs.md` | Exact ASCII layouts/flows for all 4 portals — build the UI to match |
| `../Meet2-prep/plans/plan-b-unified-command-center/04-tech-stack.md` | DB schema, LangGraph state-machine pattern, multi-model strategy |
| `../Meet1-Research for DIscussion/Project_Option_B_Research.md` | APQC process refs + the agent-mapping table |
| `../Meet2-prep/apqc_aftersales_processes.md` | Condensed APQC after-sales process list |

---

## 2. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Goal | Working demo MVP | Mentor wants runnable groundwork, not just slides |
| Scope | **Current: warranty depth only** (manager's instruction, 2026-06-09). Long-term: Plan B full 6-domain vision | Mentor re-scoped to warranty; other domains paused, not cancelled |
| Stack | Next.js + TS · Python 3.12 + FastAPI + LangGraph · Postgres/SQLite · Docker | Matches Plan B's `04-tech-stack.md`; SQLite used in dev (Docker perms) |
| Agent depth | **Warranty = real & deepening** (see `../Meet3-prep/warranty-component-plan.md`); Recall/Parts/Customer/Quality/Service = paused stubs | Focus all effort on a convincing, deep warranty vertical |
| LLM | **DeepSeek = primary** (text reasoning), **Groq = standby** (vision node, Wave B); both behind the provider seam; Ollama optional offline fallback | Keys configured & live-tested; provider switch is env-only, no code change |
| Agent mechanism | **Structured output** (LLM returns a decision object; our Python calls the tools) | Deterministic, unit-testable, easy to learn vs flaky native tool-calling |
| Realtime | **SSE** (server→client) + REST for actions | Dashboard data flows one way; SSE is far simpler than WebSocket |
| Customer intake | **Light guided conversation** (agent asks 1–2 clarifying questions, then proceeds) | Visible "agentic" loop, small scope; still REST-up / SSE-down |
| Human-in-the-loop | LangGraph `interrupt()` + `Command(resume=...)` + checkpointer | Current API; structurally prevents auto-approval of high-stakes actions |
| Deploy | Local first; containerized so AWS is a later, no-rework step | Lowest friction; pitch keeps the AWS story as the upgrade path |

---

## 3. Architecture

### 3.1 The 3-Tier Agent Hierarchy (from `02-agent-hierarchy.md`)

```
TIER 1  ── Master Orchestrator (LangGraph StateGraph)
            classify+enrich → route → domain → await_human(interrupt) → finalize
              │
TIER 2  ── Domain Agents (6)
            Warranty*  Recall*  Parts*   Customer°  Quality°  Service°
              │            (* = real subgraph,  ° = stub returning realistic canned output)
TIER 3  ── Specialist nodes (within each domain)
            e.g. Warranty: Intake → Claims-validate → Fraud-check → Recommendation
```

- **Tier 1 (Orchestrator):** one `StateGraph` over a minimal `AfterSalesState`. Routes by classification,
  runs the chosen domain subgraph, pauses for human approval on high-stakes outputs, composes the reply.
- **Tier 2 (Domains):** each implements the same interface (`run(state) -> state`). Real domains are
  LangGraph subgraphs; stubs return structured canned data so all 6 appear "live" in the UI.
- **Tier 3 (Specialists):** graph nodes inside a domain. Each node either calls the LLM for a *decision*
  (structured output) or calls a plain-Python **tool** (DB lookup) — never both in a tangled way.

### 3.2 Agent mechanism — structured output, not native tool-calling

```
free text ──► LLM.with_structured_output(DecisionSchema) ──► decision object
                                                                  │
                                              our Python reads the decision and
                                              calls tools/ functions (DB lookups),
                                              writes results back into state
```

The LLM only **classifies / decides / drafts**. All side-effects (DB reads/writes, notifications) are
plain Python functions in `tools/`, invoked by our code. This makes every step independently testable and
keeps control flow explicit — important while learning.

### 3.3 Human-in-the-loop

The `await_human` node calls `interrupt({...payload for the manager...})`. The graph pauses (state saved
by the checkpointer). The Manager Command Center shows the paused item; an Approve/Reject/Escalate POST
resumes the thread with `Command(resume={"decision": "..."})`. Compiled so nothing high-stakes finalizes
without a human. **Checkpointer:** `InMemorySaver` for dev/tests, `PostgresSaver`
(`langgraph-checkpoint-postgres`) for real runs. **Keep state minimal** — IDs + short strings, not raw
LLM blobs (bloated state makes checkpoint writes slow).

### 3.4 Realtime (SSE)

- **Down (server→client):** agent-activity events, ticket-status changes, streamed agent replies →
  one SSE endpoint (`StreamingResponse`), consumed in the browser via `EventSource` (`useSSE` hook).
- **Up (client→server):** submit message, approve/reject, trigger recall → ordinary REST POST.
- No WebSocket. (Documented in the pitch as: production swaps SSE → API-Gateway WebSocket if/when
  bidirectional streaming is needed.)

### 3.5 Data model (from `04-tech-stack.md`)

Operational tables: `tickets`, `agent_executions`, `audit_log`.
Mock-domain tables: `customers`, `vehicles`, `warranty_policies`, `parts_inventory`, `recalls`.
The mock fleet drives VIN lookups, warranty eligibility, and the recall fan-out.

### 3.6 Auth (demo simplification)

No Cognito. A **role/portal switcher** on the landing page (Customer / Dealer / Manager / Admin). This is
the **one deliberate shortcut** vs. the production pitch — note it in the README.

---

## 4. Repository Layout

```
Project/
  docker-compose.yml            # postgres (backend+frontend added in Phase 4)
  .env.example                  # LLM_PROVIDER, GROQ_API_KEY / DEEPSEEK_API_KEY, MODEL_FAST/STD/COMPLEX,
                                #   DATABASE_URL, OLLAMA_HOST (optional)
  README.md
  PLAN.md                       # this file
  .gitignore                    # node_modules, .venv, __pycache__, .env, pgdata/
  backend/
    pyproject.toml
    app/
      main.py                   # FastAPI app: routers, CORS, lifespan
      config.py                 # pydantic-settings: db url, provider, model tiers, ollama host
      api/v1/
        intake.py               # POST /intake — guided customer conversation
        tickets.py              # GET /tickets, GET /tickets/{id}, POST /tickets/{id}/decision
        recalls.py              # POST /recalls/{id}/trigger
        stream.py               # GET /stream — SSE endpoint
        admin.py                # agent prompts, rules, users, audit log
      core/langgraph/
        state.py                # AfterSalesState (minimal TypedDict)
        orchestrator.py         # Tier-1 StateGraph + checkpointer + interrupt
        domains/
          base.py               # DomainAgent interface
          warranty.py recall.py parts.py        # real subgraphs
          customer.py quality.py service.py      # stubs (same interface)
        prompts/                # one prompt module per specialist
      tools/
        vin_lookup.py warranty_check.py parts_check.py notify.py
      services/
        llm.py                  # provider seam: get_model(tier) + structured-output helper
        graph_runner.py         # start/resume a graph thread; map state↔API
        events.py               # in-process SSE event bus (publish/subscribe)
      models/                   # SQLAlchemy ORM + session
      schemas/                  # Pydantic: requests/responses + LLM decision schemas
      seed/seed.py              # mock fleet loader
    tests/                      # pytest
  frontend/
    app/
      layout.tsx
      page.tsx                  # role/portal launcher
      (customer)/page.tsx
      (dealer)/page.tsx
      (manager)/page.tsx
      (admin)/page.tsx
    components/                 # IntakeChat, KpiCard, ApprovalQueue, AgentMonitor,
                                #   StatusTracker, ReasoningChain
    lib/
      api.ts                    # REST client
      useSSE.ts                 # EventSource hook
      roles.ts                  # 4 roles + active-role state
```

---

## 5. Tech Stack & Key Dependencies

**Backend** (`pyproject.toml`):
`fastapi`, `uvicorn[standard]`, `langgraph`, `langgraph-checkpoint-postgres`,
`langchain-openai` (for DeepSeek/Groq via base_url) — optionally `langchain-groq` / `langchain-deepseek`
and `langchain-ollama` (offline fallback), `sqlalchemy`, `psycopg[binary]`, `pydantic`,
`pydantic-settings`, `sse-starlette` (clean SSE), `pytest`, `pytest-asyncio`, `httpx`.

**Frontend:** Next.js (App Router) + TypeScript + Tailwind. Native `EventSource` for SSE
(or `react-use-websocket`'s SSE-style hook if preferred). A lightweight chart lib (Recharts) for KPIs.

**Infra:** Docker Compose (`postgres:16` now; backend + frontend images in Phase 4).

### Model-tier mapping (`services/llm.py`)
| Tier | Used for | Example model (env-configurable) |
|---|---|---|
| `fast` | intake classification, CSAT, simple lookups | Groq small/fast model |
| `standard` | warranty validation, recommendation, comms drafting | DeepSeek-chat or Groq 70B-class |
| `complex` | fraud detection, recall risk assessment | deepseek-reasoner |

`get_model(tier)` reads `LLM_PROVIDER` + the `MODEL_*` env vars and returns a configured chat model.
Switching provider = changing env, no code change. Ollama path used only when `LLM_PROVIDER=ollama`.

---

## 6. Build Roadmap (phase by phase, step by step)

Legend: **[TDD]** = write the test first. **✅** = independently demoable milestone.

### PHASE 0 — Foundations & three isolated spikes
*Goal: learn each unfamiliar piece alone, then scaffold the repo. Nothing depends on the others yet.*

**0a — LLM spike** (`scratch/spike_llm.py`)
- [ ] `get_model("standard")` against DeepSeek/Groq via `ChatOpenAI(base_url=..., api_key=...)`.
- [ ] Define a small Pydantic schema; call `.with_structured_output(Schema)` on a free-text input;
      print the parsed object.
- [ ] Flip `LLM_PROVIDER` groq↔deepseek and confirm both satisfy the schema; confirm Ollama fallback.
- **Done when:** the same script returns a valid decision object across providers.

**0b — LangGraph spike** (`scratch/spike_graph.py`)
- [ ] 3-node `StateGraph`; middle node calls `interrupt({"question": ...})`.
- [ ] Run with `InMemorySaver` + a `thread_id`; observe the pause; resume with `Command(resume=...)`.
- **Done when:** you can pause and resume a graph and read the final state.

**0c — FE↔BE SSE spike**
- [ ] FastAPI `GET /health` (JSON) + `GET /stream` (SSE emitting a tick every second).
- [ ] Next.js page fetches `/health` and renders the live SSE ticks via `EventSource`.
- **Done when:** numbers update live in the browser with no manual refresh.

**0d — Repo scaffold**
- [ ] `.gitignore`, `backend/pyproject.toml`, `python -m venv .venv`, install deps.
- [ ] `config.py` (settings) + `services/llm.py` (provider seam, lifted from 0a).
- [ ] `models/` SQLAlchemy tables (§3.5) + `db` session; `docker-compose.yml` postgres service.
- [ ] `seed/seed.py`: ~30 customers, ~40 vehicles (varied models / purchase dates / warranty windows),
      `warranty_policies`, `parts_inventory` (some 0-stock), 1–2 `recalls` targeting a specific
      model+year (this drives the Phase 2 demo).
- [ ] `frontend` via `create-next-app` (TS, App Router, Tailwind); strip boilerplate; `lib/roles.ts`;
      landing `page.tsx` launcher; four empty portal routes.
- **✅ Demoable:** `docker compose up postgres` healthy; `python -m app.seed.seed` populates DB;
  `uvicorn app.main:app` `/health` 200; `npm run dev` renders the launcher + 4 portals.

---

### PHASE 1 — Warranty vertical, end-to-end (FIRST REAL DEMO) ✅ **COMPLETE**
*Goal: a customer describes an issue, the agent clarifies + decides, a manager approves, status flips.*
*Delivered: 15 tests green; full live cycle verified (intake → validate → fraud → recommend →*
*interrupt → manager approve → resolved). One deviation: status uses 3s polling (SSE deferred to P2).*

**1.1 Warranty tools** (`tools/`) — pure functions, **[TDD]** first
- [ ] `get_vehicle_by_vin(vin)`, `get_warranty_policy(model, purchase_date)`.
- [ ] `is_covered(vehicle, policy, claim_date, component) -> {covered: bool, reason}`
      (date-window + component-coverage logic). **[TDD]** `tests/test_eligibility.py`.

**1.2 Schemas** (`schemas/`)
- [ ] `IntakeDecision { enough_info: bool, follow_up_question?: str, classification?: str(APQC ref),
      extracted: {vin?, component?, symptom?, onset?} }`.
- [ ] `WarrantyRecommendation { decision: approve|reject|escalate, confidence: float, reasoning: str,
      draft_email: str }`.

**1.3 Guided intake (light conversation)**
- [ ] `intake` node: LLM (`fast`) → `IntakeDecision`. If `enough_info=false`, return the follow-up to
      the client and wait for the next message (bounded to ~2 clarifying turns), then proceed.
- [ ] `api/v1/intake.py` `POST /intake {session_id, message}` → streams the agent reply over SSE;
      once `enough_info`, creates a ticket and starts the orchestrator thread. **[TDD]** intake loop.

**1.4 Warranty domain subgraph** (`core/langgraph/domains/warranty.py`)
- [ ] Nodes: `validate(tool) → fraud_check(LLM complex) → recommend(LLM standard) → END`.
- [ ] Conditional edge: `fraud_risk > 0.7` ⇒ force escalate.

**1.5 Master orchestrator** (`core/langgraph/orchestrator.py`)
- [ ] `classify_and_enrich → route_to_domain (conditional) → warranty subgraph →
      await_human(interrupt) → finalize`.
- [ ] Compile with `PostgresSaver`. Each node writes an `agent_executions` row, publishes an SSE event,
      appends to `audit_log`. **[TDD]** `tests/test_routing.py`.

**1.6 Ticket API** (`api/v1/tickets.py`)
- [ ] `GET /tickets`, `GET /tickets/{id}` (incl. reasoning trace), `POST /tickets/{id}/decision`
      (resume via `Command(resume=...)`). **[TDD]** `tests/test_tickets_api.py` (submit→pause→approve→resolved).

**1.7 Customer Portal** `(customer)`
- [ ] `IntakeChat` panel (1–2 clarifying turns, SSE-streamed replies) → AI pre-check banner → ticket
      confirmation → `StatusTracker` page (Submitted → Under Review → Awaiting Approval → Resolved).

**1.8 Manager Command Center** `(manager)` (match `03-portal-designs.md`)
- [ ] KPI cards (counts/savings/CSAT from seed + live data).
- [ ] `ApprovalQueue` "Needs your attention" list.
- [ ] `ReasoningChain` detail view: full step-by-step reasoning + data used + editable draft email.
- [ ] Approve / Reject / Escalate buttons → decision endpoint; customer status updates (poll now, SSE in P2).

**✅ Demoable:** submit *"AC failed 3 months after purchase"* → agent asks a clarifying question →
manager sees the reasoning chain → Approve → customer status flips to Resolved. `pytest` green.

---

### PHASE 1.5 — Warranty depth (◀ ACTIVE — current focus)
*Goal: take warranty from "demo skeleton" to a convincing, deep vertical covering the full APQC 6.7
lifecycle.*

**Plan of record (current): `FORWARD-PLAN.md`** — supersedes the older ordering below. Target ("done")
picture: `WARRANTY-BLUEPRINT.md`. Full APQC scope across all six domains: `APQC-COVERAGE.md`.

**Done so far (the decision spine):** claim-history fraud · cost estimator (₹) · tiered auto-approve
(+ auto-reject) · audit log · photo upload + **vision** evidence (Groq) · pay/close lifecycle ·
metrics dashboard · email **stub**.

**Next — finish the pipeline first, then the performance layer** (see `FORWARD-PLAN.md` for files/tests):
- **Part A (pipeline):** A1 responsible-party (6.7.3.4) → A2 supplier recovery (6.7.4) →
  A3 real payment (6.7.3.7) → A4 reconcile (6.7.3.9) → B1 real notifications (6.7.3.6) →
  B2 appeals (6.7.3.6) → C1 preauthorization (6.7.2.6) → C2 warranty activation (6.7.1).
- **Part B (performance layer, after the pipeline):** Policy RAG · CSAT · defect cluster + CAPA · eval harness.

> **APQC note:** `6.7.3.4` = *Determine responsible party* (the A1 node). Cost estimation has no
> dedicated APQC sub-code and is tagged under `6.7.3.5` (the decision). Corrected in code + deck.

---

### PHASE 1.6 — Vehicle ownership & self-registration ⏳ **PLANNED**
*Goal: real people buy second-hand cars and change ownership. The system must support new user
sign-up, VIN self-registration, and safe ownership transfers without a government API.*

**Context / motivation:**
- Currently every customer + VIN is hard-coded in `seed.py`. A live demo (or any real user)
  has no way to create an account or register a vehicle they bought.
- Second-hand purchases mean a VIN may already be in the DB under the original owner.
  The old owner must lose access the moment a verified transfer is approved — not before,
  not after. Until approval, only the current owner can file claims.
- Without VAHAN API access (India's national vehicle registry) we cannot programmatically
  verify ownership, so the flow uses RC document upload + manager (human-in-the-loop) review.
  When vision (C9) is added later, the AI can read the RC automatically.

**Flow design:**

```
New user → POST /auth/register → account created, no vehicles yet
                 │
                 └─► POST /api/v1/vehicles/claim  (VIN + optional RC photo)
                           │
                           ├─ VIN not in DB          → 404 "VIN not found" (UPDATED)
                           │                            only seeded/registered vehicles can be claimed;
                           │                            customers cannot invent a vehicle
                           │
                           ├─ VIN owned by same user  → "already_owned"
                           │
                           └─ VIN owned by another    → create VINTransferRequest (pending)
                                                         old owner: read-only, cannot file new claims
                                                         manager reviews RC photo → approve / reject
                                                         on approve: vehicle.customer_id flips
                                                         on reject:  request closed, old owner restored
```

**What to build:**

**1.6.1 — New user registration** (`api/v1/auth.py`)
- [ ] `POST /api/v1/auth/register` — `{name, email, password, phone?}` → creates `Customer`,
      returns JWT (same shape as login response). Email uniqueness enforced.
- [ ] Frontend `app/login/page.tsx` — "Create account" toggle on the login page; form sends to register.
- **[TDD]** `tests/test_auth.py` — register → login → token valid; duplicate email → 409.

**1.6.2 — VIN claim endpoint** (`api/v1/vehicles.py`)
- [ ] New `VINTransferRequest` model: `id, vin, requester_id, current_owner_id, rc_attachment_id,
      status (pending|approved|rejected), requested_at, decided_at, decided_by`.
- [ ] `POST /api/v1/vehicles/claim` (customer-scoped):
      - Body: `{vin, rc_attachment_id?}` (RC photo uploaded via existing `/intake/upload` first).
      - Returns: `{status: "registered"|"transfer_requested"}` + vehicle or transfer record.
- [ ] `GET /api/v1/vehicles` — list vehicles for current customer.
- **[TDD]** three cases: new VIN, own VIN, transfer.

**1.6.3 — Transfer approval** (`api/v1/vehicles.py` + manager portal)
- [ ] `GET /api/v1/vehicles/transfers` (manager) — list pending transfers with RC attachment link.
- [ ] `POST /api/v1/vehicles/transfers/{id}/approve` → flips `vehicle.customer_id`.
- [ ] `POST /api/v1/vehicles/transfers/{id}/reject` → closes the request.
- [ ] Manager portal: new "Vehicle Transfers" tab showing pending requests, RC photo preview,
      Approve / Reject buttons.
- **[TDD]** approve flips ownership; old owner can no longer file claims on that VIN.

**1.6.4 — Seed & login page cleanup**
- [ ] Expand `seed.py` with more models, components, and a broader coverage list so demo queries
      don't hit hard coverage-rejection edges (see gap analysis above).
- [ ] Login page: add "Register" path; quick-demo accounts stay for convenience.

**✅ Demoable:** a new visitor registers, enters a VIN for a second-hand car, uploads an RC
photo, manager approves the transfer → original owner can no longer claim on that VIN → new
owner submits a warranty claim successfully.

**Open questions (settle before building):**
1. ~~Should "auto-register" (VIN not yet in DB) require manager approval?~~ **RESOLVED:** auto-register
   was removed entirely — an unknown VIN now returns **404**. Only seeded/registered vehicles can be
   claimed, so customers cannot invent a vehicle.
2. During a pending transfer, should the original owner still be able to file claims?
   *Current plan: yes — until transfer is approved, they retain full access.*
3. When vision (C9) is added: RC is read by AI → name/VIN extracted → auto-approve if match.
   Flag this as the future upgrade path in code comments.

---

### PHASE 1.7 — Smarter intake: bulk follow-ups + contextual uploads ⏳ **PLANNED**
*Goal: cut the back-and-forth to one exchange, reduce token cost, and make image upload
a visible first-class feature rather than a hidden paperclip. No forms — pure chat.*

**Context / motivation:**
- Currently the intake agent asks ONE follow-up question per turn (bounded at 2 turns). If
  three fields are missing the customer must reply three separate times — wasting tokens and
  patience. The agent should ask for everything at once as a compact bullet list.
- The photo upload button is hidden in a paperclip icon. Customers miss it. Different contexts
  need different evidence (component photo for warranty, RC doc for VIN transfer, invoice for
  parts) — the UI should surface the right prompt before the customer even types.

**Design: pure chat, agent communicates efficiently**

```
Customer types: "My AC stopped working"
        │
        ▼
Agent: "Got it — a few more details:
        • Which vehicle? (model if not already shown)
        • When did this start?
        • Current odometer (km)?
        • Photo of the affected part helps — attach one if you can 📎"
        │
        ▼
Customer replies with all of the above in one message + optional photo
        │
        ▼
Agent: enough_info=true → ticket created
```

**1.7.1 — Bulk follow-up bullets** (`schemas/__init__.py` + `core/langgraph/intake.py`)
- [ ] Extend `IntakeDecision` schema with:
  ```python
  follow_up_bullets: list[str] = Field(
      default_factory=list,
      description=(
          "All missing items as short bullet strings — use when two or more things "
          "are needed. E.g. ['When did it start?', 'Odometer reading (km)?']. "
          "Leave empty and use follow_up_question for single-item cases."
      )
  )
  ```
- [ ] Update `INTAKE_SYSTEM` prompt: instruct the agent to collect ALL missing fields in one
  reply as a bulleted list, never one at a time. If a photo would help, add it as the last
  bullet. Example:
  ```
  Need a bit more:
  • Which part is affected? (e.g. AC, brakes, engine)
  • When did you first notice this?
  • Odometer reading (km)?
  • A photo of the affected part if you have one 📎
  ```
- [ ] `next_intake_step()`: when `follow_up_bullets` is non-empty, join as a markdown bullet
  string and return that as the reply; otherwise fall back to `follow_up_question`.
- [ ] Lower `max_followups` from 2 → 1 — bulk bullets mean one exchange should always suffice.
- [ ] **[TDD]** assert multiple missing fields → `follow_up_bullets` has ≥ 2 items; assert a
  complete first message → `enough_info=true`, no follow-up.

**1.7.2 — Contextual upload prompt** (`frontend/app/customer/page.tsx` + `api/v1/intake.py`)
- [ ] Show the upload zone above the chat input as soon as a category is selected — not hidden.
  Label and hint text change by category:
  - Warranty / Service → *"Photo of the broken part (optional — speeds up approval)"*
  - Parts query → *"Invoice or diagnostic report (optional)"*
  - VIN registration (Phase 1.6) → *"RC document — required for transfer requests"*
  - Recall check → hide the upload zone (nothing to attach)
- [ ] Accept images AND PDF. Extend `upload_evidence` backend to allow `application/pdf`
  alongside `image/*`. Frontend shows filename chip for PDFs, thumbnail for images.
- [ ] When the agent sets `request_image=true` in a follow-up bullet, pulse-highlight the
  upload zone so the customer notices they need to attach something.

**1.7.3 — Token budget visibility** (`core/langgraph/intake.py`)
- [ ] Store char count of each intake exchange on `IntakeSession` as a token proxy (or use
  provider `usage` metadata if available). Surface in the performance trends panel as
  avg tokens per ticket type.

**✅ Demoable:** customer types "My AC stopped working" → agent replies with a 3-bullet list
(component, onset date, odometer + photo prompt) → customer answers all in one message →
ticket created. One round-trip total.

**Open questions (settle before building):**
1. Keep `follow_up_question` alongside `follow_up_bullets` in the schema, or remove it?
   Recommendation: keep as fallback for the single-missing-field case.
2. PDF upload: manager portal needs inline viewer or download link?
   Recommendation: download link for now.

---

### PHASE 2 — Cross-domain recall + live monitor (THE "WOW") ⏸ **PAUSED** (per scope update)
*Goal: one recall trigger fans out across recall + warranty + parts, visibly, in real time.*

**2.1 Tools**
- [ ] `vin_lookup.find_affected(model, year)` over `vehicles`.
- [ ] `parts_check.check_stock(part)` + `parts_check.create_supply_order(part, qty)`.

**2.2 Real domains**
- [ ] `recall.py`: `assess_scope(LLM complex) → vin_lookup(tool) → draft_comms(LLM standard) → END`.
- [ ] `parts.py`: `check_availability(tool) → recommend_order(LLM standard) → END`.

**2.3 Orchestrator fan-out**
- [ ] A recall trigger spawns parallel domain work: recall(comms) + warranty(proactive claims for
      affected VINs) + parts(pre-order) + quality(stub flag); aggregate into one manager approval.
- **[TDD]** `tests/test_recall_fanout.py` (correct affected-VIN count; warranty + parts tasks created).

**2.4 SSE bus + live monitor**
- [ ] `services/events.py` publish/subscribe; nodes emit `agent_status` / `ticket_update`.
- [ ] `api/v1/stream.py` SSE endpoint; Manager `AgentMonitor` subscribes via `useSSE` (live progress
      bars, e.g. "Recall Comms 2,103/3,247"); customer `StatusTracker` switches from poll → live.

**2.5 Trigger + approval**
- [ ] `POST /recalls/{id}/trigger`; Admin / "Manufacturer Alert" button fires it; Manager bulk-approves
      the broadcast; affected customers' portals show the recall notice.

**✅ Demoable:** trigger brake recall → `AgentMonitor` shows recall + warranty + parts agents working
live → Manager approves broadcast → recall notices appear in customer portals.

---

### PHASE 3 — Breadth & polish (full Plan B surface) ⏸ **PAUSED** (per scope update)
*Goal: all 4 portals + all 6 domains visible; production-looking.*

- [ ] Stub domains `customer.py` / `quality.py` / `service.py` implement the `DomainAgent` interface
      returning realistic structured output; orchestrator routes to them so all 6 show as live.
- [ ] **Dealer Portal** `(dealer)`: today's schedule, parts status, open jobs, AI-assist panel
      (reads tickets/parts) — per `03-portal-designs.md`.
- [ ] **Admin Console** `(admin)`: view/edit agent system prompts, warranty-rule list, user list,
      **searchable audit log** (`audit_log` populated by every node + human action).
- [ ] Manager **performance-trends** panel aggregated from `agent_executions`.
- [ ] **Frontend polish pass** — invoke the `frontend-design` skill for a cohesive "command center"
      look matching the deck (dark navy + off-white, accent palette). Add empty/loading/error states.
- [ ] Enrich seed data so dashboards/trends look populated.

**✅ Demoable:** full 4-portal / 6-domain walkthrough.

---

### PHASE 4 — Packaging & handoff (optional) ⏸ **PAUSED** (per scope update)
*Goal: one-command up + materials for the pitch.*

- [ ] Backend + frontend Dockerfiles; add both services to `docker-compose.yml` → `docker compose up`
      brings up db + be + fe (Ollama stays host-side, configurable).
- [ ] `README.md`: prerequisites (provider API key), env setup, seed command, and the **demo script**
      (the three beats below, step by step).
- [ ] **AWS-readiness table** mapping each local piece → Plan B production target
      (Postgres→Aurora, SSE→API-Gateway WebSocket, containers→ECS Fargate, etc.) — strengthens the pitch.
- [ ] Final `pytest` + a full demo-script run-through.

---

## 7. Cross-Cutting Conventions

- **TDD** for logic-bearing code (eligibility, routing, fan-out, tools, endpoints); UI verified manually.
- **Every agent node** → write an `agent_executions` row + emit an SSE event + append to `audit_log`.
- **Human-in-the-loop** is structural (`interrupt()`); nothing high-stakes auto-finalizes.
- **Keep LangGraph state minimal** (IDs + short strings; store conversation/turn history compactly).
- **Secrets** live in `.env` (gitignored); `.env.example` holds placeholders only.
- **Git:** branch off `main`; commit per step group; push/commit only when you ask.
- **LLM calls** go to the hosted provider via the seam; everything else is local. Keep the Ollama
  fallback path working so the UI can be iterated offline without burning API quota.

---

## 8. Verification (whole system)

1. `docker compose up postgres` healthy; `python -m app.seed.seed` populates the mock fleet.
2. `pytest` green — eligibility, intake loop, routing, tickets API, recall fan-out.
3. **Demo script:**
   a. **Customer Portal:** submit *"AC failed 3 months after purchase"* → agent asks a clarifying
      question → AI pre-check → ticket created.
   b. **Manager Command Center:** claim appears in the approval queue with a full reasoning chain →
      Approve → Customer status flips to Resolved live (SSE).
   c. **Admin:** trigger the brake recall → Agent Activity Monitor shows recall + warranty + parts
      agents working live → Manager approves broadcast → recall notices appear in customer portals.
4. Runs against the configured hosted provider (DeepSeek/Groq); the offline Ollama fallback also works.

---

## 9. Risk Register (first-timer focus)

| Risk | Mitigation |
|---|---|
| API key leak / committed secret | keys in `.env` (gitignored); `.env.example` placeholders only |
| API rate limits / quota burn during UI work | cheap `fast` model for classify; cache LLM calls in dev; Ollama fallback for pure-UI iteration |
| Reasoning model pollutes state | use only the parsed structured object; non-reasoning model for high-volume nodes |
| LangGraph interrupt/resume confusion | isolate in spike 0b before touching the real graph |
| Realtime complexity | SSE not WebSocket; prove it in spike 0c first |
| Scope creep (the build is large) | phases are independent; **Phase 1 alone is a valid deliverable** |
| Provider/SDK churn | keep all LLM access behind `services/llm.py`; never call the SDK directly elsewhere |

---

## 10. Research Sources

- LangGraph HITL & checkpointing — `docs.langchain.com/oss/python/langchain/human-in-the-loop`;
  *Mastering LangGraph Checkpointing (2025)*, sparkco.ai
- Ollama / structured output & tool-calling — `docs.ollama.com/capabilities/tool-calling`;
  `ollama/ollama#14601`; langchain-ollama `with_structured_output`
- FastAPI + LangGraph project structure — `github.com/wassim249/fastapi-langgraph-agent-production-ready-template`
- Next.js + FastAPI realtime (SSE vs WebSocket) — `testdriven.io` FastAPI/Postgres/WebSockets;
  jaehyeon.me realtime-dashboard series

---

## 11. First Runnable Milestone

**End of Phase 1 = a complete human-in-the-loop warranty demo** (guided intake → agent decision →
manager approval → live status). Everything after is breadth. Build to that line first.
