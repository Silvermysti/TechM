# APQC Coverage Map — After-Sales AI Command Center

Every APQC process this project covers, **sectioned by the six domains agreed in Meet 2**.

This is the scope reference: it answers "what APQC processes does Plan B touch, which domain owns each,
and what is the build status." It does **not** restate designs — see `FORWARD-PLAN.md` for build order
and `meet4-presentation.md` for what's demoable.

- **Framework:** APQC Automotive PCF v7.2.2, Section **6.0 Manage Customer Service** (Ref 10006).
- **Source extract:** `Meet2-prep/apqc_aftersales_processes.md`.
- **Domain sectioning rationale:** `Meet2-prep/plans/plan-b-unified-command-center/02-agent-hierarchy.md`.

**Status legend:** ✅ built · ◑ partial / stub · 🔲 planned (in scope) · ◻ future (domain stubbed) · ⊘ out of scope

---

## How the 13 process groups became 6 domains (Meet 2 decision)

The 13 APQC process groups (6.1–6.13) were collapsed into the smallest set of agents that each own a
coherent business outcome. The grouping:

| Domain | APQC groups absorbed | Owns the outcome of… |
|---|---|---|
| **Customer** | 6.1, 6.2, 6.4, 6.5 | a happy, heard customer (engagement, complaints, returns, satisfaction) |
| **Warranty** ★ | 6.7 | a settled warranty claim (the money + dispute risk) — **current build focus** |
| **Parts** | 6.11, 6.12 | a part on the shelf and on its way |
| **Quality** | 6.10 | early warning of systemic defects |
| **Recall** | 6.8 | a safe, compliant recall |
| **Service** | 6.3, 6.6, 6.7.7 | the physical repair, booked and done well |

Implemented as **specialist agents, not full domains:** Telematics (6.9) → feeds Service/Quality;
End-of-Life (6.13) → extension of the customer relationship. **Out of scope** for this project: 6.9, 6.13.

Current project reality: **Warranty is built deep; Recall + Parts exist as working demos; Customer,
Quality, Service are stubbed** behind the same node interface.

---

## Domain 1 — Customer  *(APQC 6.1, 6.2, 6.4, 6.5)*

All customer-facing engagement, complaints, returns, and satisfaction.
**Specialists:** Intake · Complaint · Returns · CSAT.

### 6.1 Develop customer-care strategy (12635)
| APQC | Process | Status |
|---|---|---|
| 6.1.1 | Customer service segmentation / prioritization (10381) | ◻ |
| 6.1.2 | Define service policies and procedures (10382) | ◻ |
| 6.1.3 | Establish target service level per segment (10383) | ◻ |
| 6.1.3.1 | Determine warranty policies vs. **goodwill** practices (12636) | 🔲 *(goodwill approvals — see FORWARD-PLAN §4B)* |

### 6.2 Plan and manage customer service contacts (10379)
| APQC | Process | Status |
|---|---|---|
| 6.2.1 | Plan/manage service workforce (10387) | ⊘ |
| 6.2.2 | Manage problems, requests, inquiries (10388) | ◑ *(guided intake = 6.2.2.1/.2; partial)* |
| 6.2.2.1 | Receive problems/requests/inquiries (10394) | ✅ *(intake chat)* |
| 6.2.2.2 | Analyze problems/requests/inquiries (13482) | ✅ *(intake classification)* |
| 6.2.2.3 | Resolve problems/requests/inquiries (10395) | ◑ |
| 6.2.2.4 | Respond to customer (10396) | ◑ *(draft message; real send is FORWARD-PLAN B1)* |
| 6.2.3 | Manage customer complaints (10389) | ◻ |
| 6.2.4 | Process returns (20094) | ◻ |
| 6.2.5 | Report incidents/risks to regulators (12840) | ⊘ |

### 6.4 Evaluate operations and satisfaction (20595)
| APQC | Process | Status |
|---|---|---|
| 6.4.1 | Measure satisfaction w/ inquiry handling (10401) | ◻ *(see also warranty CSAT 6.7.5.1)* |
| 6.4.2 | Measure satisfaction w/ complaint handling (10402) | ◻ |
| 6.4.3 | Measure satisfaction w/ products & services (10403) | ◻ |

### 6.5 Provide value-add services (12437)
| APQC | Process | Status |
|---|---|---|
| 6.5 | Value-add services (standalone group) | ⊘ |

---

## Domain 2 — Warranty ★  *(APQC 6.7)* — current build focus

The largest, highest-value group. The full lifecycle from registration through claim closure, supplier
recovery, and fraud. **Specialists:** Product Registration · Warranty Claims · Supplier Recovery · Fraud.
*(6.7.7 Service products is owned by the **Service** domain — see Domain 6.)*

### 6.7.1 Register products (20605)
| APQC | Process | Status |
|---|---|---|
| 6.7.1 | Register products / warranty activation | ◑ *(VIN claim + ownership transfer built; explicit activation = FORWARD-PLAN C2)* |

### 6.7.2 Define warranty offering (20089)
| APQC | Process | Status |
|---|---|---|
| 6.7.2.1 | Determine & document warranty policies (16893) | ◑ *(seeded; admin mgmt = FORWARD-PLAN §4A)* |
| 6.7.2.2 | Manage warranty rules / claim codes (16890) | ◑ *(claim_codes seeded; no UI)* |
| 6.7.2.3 | Agree warranty responsibilities w/ suppliers (20090) | 🔲 *(FORWARD-PLAN §4A)* |
| 6.7.2.4 | Define warranty offerings for customers (20091) | 🔲 *(extended warranty / AMC)* |
| 6.7.2.5 | Communicate warranty policies & offerings (12673) | 🔲 *(Policy RAG — FORWARD-PLAN §3)* |
| 6.7.2.6 | Manage preauthorizations (20102) | 🔲 *(FORWARD-PLAN C1)* |
| 6.7.2.7 | Develop recall strategy (20092) | ◻ *(handled in Recall domain)* |

### 6.7.3 Process warranty claims (12669) ★ highest-value automation target
| APQC | Process | Status |
|---|---|---|
| 6.7.3.1 | Receive warranty claim (20096) | ✅ |
| 6.7.3.2 | Validate warranty claim (12671) | ✅ *(deterministic coverage check)* |
| 6.7.3.3 | Investigate warranty issues (20097) | ◑ |
| 6.7.3.3.1 | Define issue (20098) | ✅ *(intake extraction)* |
| 6.7.3.3.2 | Schedule field service (12677) | 🔲 *(FORWARD-PLAN C3)* |
| 6.7.3.3.3 | Request & receive defective part (12678) | 🔲 *(FORWARD-PLAN C3)* |
| 6.7.3.3.4 | Investigate / root cause analysis (20099) | 🔲 *(feeds defect clustering)* |
| 6.7.3.3.5 | Receive investigation result / corrective action (20100) | 🔲 |
| 6.7.3.4 | Determine responsible party (20101) | ✅ *(A1 — `tools/responsible_party.py` + node; drives recovery)* |
| 6.7.3.5 | Approve or reject warranty claim (12668) | ✅ *(AI rec + tiered autonomy + HITL)* |
| 6.7.3.6 | Notify originator of decision (20103) | ◑ *(stub; real send = B1; appeals = B2)* |
| 6.7.3.7 | Authorize payment (20104) | ◑ *(mocked; real = FORWARD-PLAN A3)* |
| 6.7.3.8 | Close claim (20105) | ✅ |
| 6.7.3.9 | Reconcile warranty transaction disposition (12667) | 🔲 *(FORWARD-PLAN A4)* |

### 6.7.4 Manage supplier recovery (20106)
| APQC | Process | Status |
|---|---|---|
| 6.7.4.1 | Create supplier recovery claims (20107) | ✅ *(A2 — draft → send → recovered; `api/v1/recoveries.py`)* |
| 6.7.4.2 | Negotiate recoveries with suppliers (20108) | ⊘ *(out of scope — human negotiation)* |

### 6.7.5 Evaluate & manage warranty performance (12672)
| APQC | Process | Status |
|---|---|---|
| 6.7.5.1 | Measure customer satisfaction w/ warranty (20118) | 🔲 *(CSAT — FORWARD-PLAN §3)* |
| 6.7.5.2 | Monitor & report warranty metrics (12676) | ✅ *(metrics API + trends panel)* |
| 6.7.5.3 | Identify improvement opportunities (20119) | 🔲 *(defect clustering — FORWARD-PLAN §3)* |
| 6.7.5.4 | Identify opportunities to eliminate warranty waste (12674) | ◻ |
| 6.7.5.5 | Investigate fraudulent claims (20120) | ✅ *(fraud node + history check)* |

### 6.7.6 Evaluate recall performance (20121)
| APQC  | Process                     | Status                  |
| ----- | --------------------------- | ----------------------- |
| 6.7.6 | Evaluate recall performance | ◻ *(see Recall domain)* |

---

## Domain 3 — Parts  *(APQC 6.11, 6.12)*

Inventory and supply chain — the physical movement of a part.
**Specialists:** Inventory · Supply Chain · Parts Retail.

### 6.11 Manage parts (12685)
| APQC | Process | Status |
|---|---|---|
| 6.11.1 | Manage inventory after sale (12686) | ◑ *(stock check in parts demo)* |
| 6.11.2 | Manage electronic parts catalog (12687) | ◑ *(seeded catalog)* |
| 6.11.3 | Exchange / locate parts (12688) | ◻ |
| 6.11.4 | Manage returns (12689) | ◻ |
| 6.11.5 | Rebuild part (12690) | ⊘ |
| 6.11.6 | Manage parts retail operations (12691) | ◻ |

### 6.12 Service parts (12692)
| APQC | Process | Status |
|---|---|---|
| 6.12.1 | Perform service parts planning (12693) | ◻ |
| 6.12.2 | Perform service parts execution (12702) | ◑ *(order recommendation in parts demo)* |
| 6.12.2.6 | Process sales order (12709) | 🔲 *(parts order on claim approval)* |

---

## Domain 4 — Quality  *(APQC 6.10)*

Early-warning and feedback analysis — cross-cutting, reads signals from every domain.
**Specialists:** Early Warning · Feedback Loop.

| APQC | Process | Status |
|---|---|---|
| 6.10.1 | Identify quality management (12680) | ◻ |
| 6.10.2 | Analyze early-warning data (12682) | 🔲 *(defect cluster + CAPA — FORWARD-PLAN §3)* |
| 6.10.3 | Provide feedback to enterprise (12683) | 🔲 *(CAPA alert to engineering)* |

---

## Domain 5 — Recall  *(APQC 6.8)*

Time-critical, regulator-facing recall lifecycle.
**Specialists:** VIN Lookup · Communication · Regulatory Reporting.

| APQC | Process | Status |
|---|---|---|
| 6.8.1 | Initiate recall (20111) | ◑ *(recall trigger + assess in demo)* |
| 6.8.2 | Assess hazard likelihood & consequences (20112) | ◑ *(recall_assess node)* |
| 6.8.3 | Manage recall communications (20113) | ◑ *(recall_draft_comms node)* |
| 6.8.4 | Submit regulatory reports (20114) | ◻ |
| 6.8.5 | Monitor & audit recall effectiveness (20115) | ◻ |
| 6.8.6 | Manage recall termination (20116) | ◻ |

---

## Domain 6 — Service  *(APQC 6.3, 6.6, 6.7.7)*

Physical execution of service — booking, technician assignment, repair, QA.
**Specialists:** Scheduling · Technician Coordinator · Service QA.

### 6.3 Enable & support service / repairs (12643)
| APQC | Process | Status |
|---|---|---|
| 6.3.1–6.3.7 | Dealer installs, service procedures, technical/collision resolution | ◻ |

### 6.6 Train & manage service workforce (12651)
| APQC | Process | Status |
|---|---|---|
| 6.6.1–6.6.2 | Training/certification, evaluate agent interaction quality | ⊘ |

### 6.7.7 Service products (10218)
| APQC | Process | Status |
|---|---|---|
| 6.7.7.1 | Identify & schedule resources for service (10321) | ◻ *(overlaps warranty C3 field-service)* |
| 6.7.7.2 | Provide service to customers / execute repair (10322) | ◻ |
| 6.7.7.3 | Ensure quality of service (10323) | ◻ |

---

## Specialist agents (not promoted to domains)

| Capability | APQC | Status |
|---|---|---|
| Telematics service | 6.9 | ⊘ *(needs connected-vehicle data)* |
| End-of-life / dismantling | 6.13 | ⊘ *(physical ops, limited AI fit)* |

---

## Coverage summary

| Domain | In active scope | Build depth |
|---|---|---|
| **Warranty (6.7)** | ✅ primary | deep — spine built; lifecycle completion in `FORWARD-PLAN.md` |
| Recall (6.8) | demo | shallow — assess + comms |
| Parts (6.11/6.12) | demo | shallow — stock check + order rec |
| Customer (6.1/6.2/6.4/6.5) | partial | intake only; complaints/returns/CSAT stubbed |
| Quality (6.10) | planned | defect clustering on the roadmap |
| Service (6.3/6.6/6.7.7) | future | stubbed |
| Telematics (6.9), EoL (6.13) | out of scope | — |

**Bottom line:** the project's committed deliverable is the **Warranty domain (6.7) end-to-end**; the
other five domains exist to prove the Plan B architecture (one orchestrator, six addressable domains)
without being built to the same depth.

---

*Source: APQC Automotive PCF v7.2.2 (March 2025). Sectioning per Plan B agent hierarchy (Meet 2).*
