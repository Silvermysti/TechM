# Forward Plan — After-Sales AI Command Center (post-Meet 4)

*Plan only. No code is written from this document — it is the agreed build order and the menu of
options. Scope is **warranty (APQC 6.7)** per the current manager directive.*

Source of truth for "what's done": `Meet4-prep/meet4-presentation.md` and `CLAUDE.md`.
APQC reference: `Meet2-prep/apqc_aftersales_processes.md` (section 6.7).

---

## 1. Where we are against the full APQC 6.7 lifecycle

Honest coverage map. ✅ built · ◑ partial / stubbed · 🔲 not started.

| APQC | Process | Status | Notes |
|---|---|---|---|
| 6.7.1 | Register products | ◑ | VIN claim + ownership transfer exist; no warranty *activation at purchase* |
| 6.7.2.1 | Document warranty policies | ◑ | Policies seeded in DB; no admin management screen |
| 6.7.2.2 | Manage warranty rules / claim codes | ◑ | `claim_codes` seeded; no UI to edit |
| 6.7.2.3 | Agree responsibilities with suppliers | 🔲 | — |
| 6.7.2.4 | Define warranty offerings for customers | 🔲 | extended warranty / AMC |
| 6.7.2.5 | Communicate warranty policies | 🔲 | overlaps with Policy RAG |
| 6.7.2.6 | Manage preauthorizations | 🔲 | pre-approve a repair before work starts |
| 6.7.3.1 | Receive claim | ✅ | guided intake chat |
| 6.7.3.2 | Validate claim | ✅ | deterministic coverage check |
| 6.7.3.3 | Investigate warranty issues | ◑ | Vision evidence done; no field service / part return / root cause |
| 6.7.3.4 | Determine responsible party | ✅ | A1 — `tools/responsible_party.py` + node |
| 6.7.3.5 | Approve / reject claim | ✅ | AI recommendation + tiered autonomy + HITL |
| 6.7.3.6 | Notify originator | ◑ | email stub only (console fake), no SMS |
| 6.7.3.7 | Authorize payment | ◑ | mocked `pay` endpoint |
| 6.7.3.8 | Close claim | ✅ | `close` endpoint, status lifecycle |
| 6.7.3.9 | Reconcile transaction disposition | 🔲 | accounting reconciliation / export |
| 6.7.4.1 | Create supplier recovery claims | 🔲 | flag set, no workflow |
| 6.7.4.2 | Negotiate recoveries | 🔲 | — |
| 6.7.5.1 | Measure customer satisfaction | 🔲 | CSAT |
| 6.7.5.2 | Monitor / report metrics | ✅ | metrics API + trends panel |
| 6.7.5.3 | Identify improvement opportunities | 🔲 | overlaps defect clustering |
| 6.7.5.5 | Investigate fraudulent claims | ✅ | fraud node + history check |
| 6.7.6 | Evaluate recall performance | 🔲 | — |

**Takeaway:** the **claim *decision* spine is complete**, but the **warranty *pipeline* is not.** A real
claim must continue past "approved" — pay out, recover from the supplier, reconcile — and should begin
*before* the claim (preauthorization). Several of those steps are stubs or missing.

**Decision (this revision): finish the warranty pipeline end-to-end *first*. CSAT, defect clustering,
and the eval harness are a *performance layer* that comes only once the pipeline is whole. Policy RAG is
an *enhancement* to validation, not a missing step, so it also waits.**

---

## 2. Finish the warranty pipeline first

A claim must be able to travel the entire APQC 6.7 lifecycle with **no stubs**:

```
Register → [Preauth] → Receive → Validate → Investigate → Determine party
   ◑          🔲          ✅         ✅          ◑              ◑
   → Decide → Notify → [Appeal] → Authorize payment → Recover from supplier → Reconcile → Close
       ✅      ◑ stub    🔲            ◑ mock                🔲                    🔲          ✅
```

Eight gaps remain. They are grouped into three phases by dependency and by where they sit in the claim's
journey. Build order is A → B → C; within a phase, top to bottom.

### Phase A — Close the money tail  *(the biggest "it doesn't actually end" gap)*

**A1 · Responsible-party determination**  *(6.7.3.4)*  ·  ✅ DONE
- **What:** explicit, reasoned call — manufacturer / supplier / indeterminate. Drives supplier recovery.
- **Built:** `tools/responsible_party.py` (deterministic, like cost) + `warranty_responsible_party`
  node (after `warranty_cost`, tagged 6.7.3.4); `build_warranty_claim` reuses it for
  `supplier_recoverable`. Tests: `tests/test_responsible_party.py` (6). Shows in the manager reasoning
  chain as "Responsible Party Specialist".
- **Note:** deterministic (supplier-part vs OEM/manufacturer) rather than LLM — money routing must be
  auditable, consistent with the cost node.

**A2 · Supplier recovery workflow**  *(6.7.4)*  ·  ✅ DONE
- **What:** manager generates an AI-drafted recovery claim for a supplier-recoverable claim, sends it,
  and marks it recovered. Lifecycle draft → sent → recovered (writes `claim.recovered_amount`).
- **Built:** `SupplierRecovery` model · `SupplierRecoveryDraft`/`SupplierRecoveryOut` schemas ·
  `services/supplier_recovery.py` (LLM draft) · `api/v1/recoveries.py` (generate/list/send/recovered) ·
  manager "Supplier Recovery" tab. Tests: `tests/test_supplier_recovery.py` (7).

**A3 · Authorize payment**  *(6.7.3.7)*  ·  ~2 hrs
- **What:** turn the mocked pay step into a real authorization action — payment record, authorizer
  identity, `paid` status with timestamp and audit entry.
- **Files:** extend `claims.py` pay endpoint + `WarrantyClaim` fields; audit log.

**A4 · Reconcile + export**  *(6.7.3.9)*  ·  ~2 hrs
- **What:** tie payments and recoveries together; CSV/PDF export of claims + costs for finance.
- **Files:** `GET /api/v1/claims/export`; small reconciliation view in the manager portal.

### Phase B — Close customer communication + recourse

**B1 · Real notifications**  *(6.7.3.6)*  ·  ~2 hrs
- **What:** replace the console stub with real SMTP email (+ optional SMS); fire on every decision with
  the claim reference number.
- **Files:** flesh out `services/notify.py`; SMTP config in `.env`; call on finalize.

**B2 · Appeals / dispute**  *(6.7.3.6)*  ·  ~2–3 hrs
- **What:** a rejected customer can submit one rebuttal (+ new evidence) that reopens the ticket for
  manager review.
- **Files:** `POST /api/v1/tickets/{id}/appeal`; status `appealed`; reopen logic; customer-portal button.

### Phase C — Close the front of the pipeline

**C1 · Preauthorization**  *(6.7.2.6)*  ·  ~3 hrs
- **What:** "will this be covered before I pay for the repair?" — runs validate + cost and returns a
  pre-approval without filing a full claim. A second, lighter entry path.
- **Files:** `POST /api/v1/preauth`; reuse coverage + cost tools; customer-portal entry.

**C2 · Warranty activation / registration**  *(6.7.1)*  ·  ~2 hrs
- **What:** record warranty start/expiry per VIN explicitly instead of deriving from purchase date;
  supports transferred and extended warranties cleanly.
- **Files:** add fields/table for activation; update coverage lookup to read them.

**C3 · Investigation depth + physical part loop**  *(6.7.3.3.2 / .3.3 / .3.4)*  ·  ~4–5 hrs
- **Model it as a thin HITL state-tracker, not automation.** The physical events (customer ships the
  part, an inspector examines it) happen *outside* the software — so the system only tracks state and
  **gates recovery on a human-recorded outcome**. That human confirmation is permanent by design, not a
  temporary stub.
- **Not every part is returned (real OEM practice).** A deterministic rule (same style as A1) decides
  `requires_part_return`:
  `parts_cost ≥ RETURN_THRESHOLD (e.g. ₹10,000)  OR  coverage_category ∈ {safety, powertrain}  OR
  component under active investigation`. Otherwise **"scrap in place"** → recovery proceeds on a
  documentary basis (A2 as-is). Threshold + categories live in `config.py`.
- **Lifecycle (when return is required):** `return_requested → received → inspected (defect confirmed /
  not) → root-cause noted`. Confirmed by a human (manager, or a dedicated inspector role) recording the
  outcome — optionally with an inspection photo through the existing attachment + vision pipeline so the
  verdict is evidence-backed.
- **Gates A2:** no physical return needed → recover directly; return required → recovery unlocked only on
  *defect confirmed*; a *"not a defect / misuse"* result **blocks recovery and raises the fraud signal**
  (closes the loop to `warranty_fraud`).
- **Files:** `requires_part_return` rule (tool) + `RETURN_THRESHOLD`/categories in `config.py`;
  `PartReturn` model + status endpoints; root-cause field on the claim; manager/inspector action; wire
  outcome into A2 recovery + the fraud node.
- **⏳ OPEN DECISION (settle before building C3):** who confirms the inspection — the **manager**
  (simpler, demo-friendly) or a **dedicated inspector role** (separation of duties — the approver isn't
  the confirmer; more realistic). Leaning manager-confirmed now, inspector role as a later refinement.

**After Phase C the warranty pipeline is genuinely complete end-to-end.**

---

## 2b. Phase D — Real-world rigor (deadlines + customer relations)

Added per review against real OEM warranty operations. After-sales is fundamentally about the
**customer relationship**, so our **customer-submitted, customer-facing** design is intentional (not a
gap vs. the dealer-DMS model). A dealer-submission channel is an *optional additive* later, not a fix.

**D1 · Recovery & claim deadlines (SLAs)**  *(6.7.4 / 6.7.5.2)*  ·  ~3 hrs
- **Supplier-recovery deadline:** real OEMs must charge back within ~90 days or forfeit. Add
  `recovery_deadline` on `SupplierRecovery`, surface "days remaining," and flag/alert ones nearing
  expiry — directly attacks the industry's "<50% recovered due to missed deadlines" loss.
- **Claim SLA / turnaround:** target resolution time per claim; show the customer "expected by" and the
  manager an SLA-breach view.
- **Files:** deadline fields + a recovery-deadline dashboard panel; SLA target in `config.py`.

**D2 · Goodwill / ex-gratia approvals**  *(6.1.3.1)*  ·  ~2 hrs
- **What:** approve an *out-of-warranty* claim as a retention gesture, recorded distinctly from a
  coverage approval (the key customer-relations lever real OEMs use).
- **Files:** decision option + claim flag + audit reason.

**D3 · Proactive warranty-expiry outreach**  *(6.7.2.4)*  ·  ~2 hrs
- **What:** reach out *before* a warranty lapses ("3 months left — extend?"). Turns warranty from
  reactive settlement into relationship-building + an upsell surface.
- **Files:** a scheduled query over activation dates (C2) + notification (B1).

---

## 3. Performance layer + enhancements (only after the pipeline is whole)

These were the original "5 deck items" minus supplier recovery (now A2). They are valuable but do **not**
complete the pipeline — they sit around it.

| Item | APQC | Effort | Note |
|---|---|---|---|
| Policy RAG (cite clauses) | 6.7.2.5 / 6.7.3.2 enhancement | ~4–6 hrs | The "wow" upgrade to validation; makes the AI cite the governing clause. |
| CSAT survey | 6.7.5.1 | ~2–3 hrs | 1–5 star rating after a terminal claim; avg on manager dashboard. |
| Defect cluster + CAPA | 6.7.5.3 / 6.7.6 | ~4–5 hrs | Group resolved claims → threshold → CAPA alert → recall investigation. |
| Eval harness (LLM-as-judge) | engineering quality | ~3–4 hrs | ~20 labelled scenarios scoring decision *quality*. Do last. |

---

## 4. Additional features we may have missed (beyond the pipeline)

The high-value APQC gaps (preauthorization, appeals, activation, responsible-party, field-service,
reconciliation) are **now scheduled inside the pipeline phases in §2**. What remains here is a menu of
*optional* extras — not needed to call the pipeline complete. Each tagged with effort.

### 4A — APQC-grounded extras (warranty setup / breadth, not on the critical path)

| Feature | APQC | Effort | What it adds |
|---|---|---|---|
| **Extended-warranty / AMC offering** | 6.7.2.4 | ~3 hrs | Sell/track an extended plan — natural upsell surface in the customer portal. |
| **Admin: policy & claim-code management** | 6.7.2.1/2.2 | ~3 hrs | Edit policies, covered components, claim codes & rates from the admin UI instead of reseeding. |
| **Supplier responsibility agreements** | 6.7.2.3 | ~2 hrs | Record per-supplier recovery terms so A2 drafts cite the agreed split. |

### 4B — General convenience / production-readiness (not strictly APQC)

| Feature | Effort | What it adds |
|---|---|---|
| **Self-service "what's covered on my car?"** | ~2 hrs | Q&A using Policy RAG (Wave 3) so customers check coverage without filing a claim. Deflects load (APQC 8.2). |
| **Real notifications (email + SMS)** | ~2 hrs | Replace the console stub with real SMTP + an SMS provider; fire on every decision with the claim reference. |
| **Admin: prompt & threshold tuning UI** | ~3 hrs | Edit agent prompts and the auto-approve thresholds (confidence/fraud/cost) without touching code. |
| **Model version stamping in audit** | ~1 hr | Record which LLM + prompt version produced each decision — compliance/explainability (called out in Meet 3 "next steps"). |
| **Multi-language intake (Hindi + regional)** | ~2 hrs | India-context: accept and reply in the customer's language. High demo impact, low effort with hosted models. |
| **Dealer-submitted claims** | ~3 hrs | Let a dealer file on the customer's behalf (the 2nd intake channel from the architecture). |
| **Security hardening** | ~2 hrs | Login rate-limiting + upload magic-byte validation + orphaned-upload cleanup (all already noted as gaps in `CLAUDE.md`). |

---

## 5. Recommended path

**Finish the warranty pipeline first (§2 + §2b), then the performance layer (§3), then optional extras (§4).**

1. **Phase A** — A1 responsible-party ✅ → A2 supplier recovery ✅ → A3 payment → A4 reconcile
2. **Phase B** — B1 real notifications → B2 appeals
3. **Phase C** — C1 preauthorization → C2 activation → C3 investigation + physical part loop
   *(→ the warranty pipeline is now complete end-to-end)*
4. **Phase D (real-world rigor)** — D1 deadlines/SLAs → D2 goodwill → D3 proactive expiry outreach
5. **Performance layer** — Policy RAG → CSAT → Defect/CAPA → Eval harness
6. **Optional** — cherry-pick from §4 by what the audience reacts to

Sequencing notes:
- C3's part-inspection outcome **feeds A2** (gates recovery) and the **fraud node** (misuse → deny) — so
  although A2 ships first as routing-only, C3 makes it faithful to the real OEM flow.
- D1's recovery deadline attaches to A2; D3's outreach builds on C2 (activation dates) + B1 (notify).
- After-sales is customer-relationship work: the **customer-facing D2C design is intentional**. A
  dealer-submission channel (§4B) is an *optional additive* channel, not a correction.

Immediate next build: **A3 — authorize payment**.

---

## 6. Explicitly out of scope (for now)

- The other five Plan B domains (recall/parts exist as demos; customer/quality/service stay stubbed).
- 6.7.4.2 supplier *negotiation*, 6.7.7 service execution, real payment-gateway integration.
- Cloud deployment (the AWS-readiness mapping in the deck stands; no migration until the demo is signed off).

---

## 7. Build conventions (carried forward, unchanged)

- **Plan first, TDD for logic** (eligibility, routing, costs, endpoints); UI verified manually + `tsc`.
- New LLM decision = new Pydantic schema + system prompt; reuse `llm.decide()` — no new plumbing.
- Every node writes `agent_executions` + emits SSE + writes `audit_log`.
- Keep LangGraph state minimal. Reseed is the migration story in dev.
- Secrets stay in gitignored `.env`. Never commit keys; rotate the pasted keys before any public demo.
