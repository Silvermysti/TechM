# Warranty Blueprint — The Complete Picture

*Everything the warranty domain needs to cover, drawn out and explained in plain English.*

This describes the **finished warranty system** — every stage as it works when fully built, end to end,
with nothing left as a stub. It is the target we are building toward. Maps to **APQC PCF 6.7 — Service
Products After Sales**. For *current* status see `APQC-COVERAGE.md`; for *build order* see `FORWARD-PLAN.md`.

---

## The whole journey on one page

A warranty claim is a story with a beginning (the car is registered and a policy exists), a middle
(a problem happens, we investigate and decide), and an end (we pay, recover money, and learn from it).

```
   ┌────────────────────────────────────────────────────────────────────────────┐
   │  SET UP            The rules exist before anyone makes a claim               │
   │  (6.7.1, 6.7.2)    Register the car · Write the policy · Set claim codes     │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                   │
   ┌───────────────────────────────▼────────────────────────────────────────────┐
   │  ASK FIRST         "Will this be covered before I pay for the repair?"        │
   │  (6.7.2.6)         Optional pre-check — gives a yes/no before work starts     │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                   │
   ┌───────────────────────────────▼────────────────────────────────────────────┐
   │  THE CLAIM         Receive → Validate → Investigate → Decide who pays →      │
   │  (6.7.3)           Approve/Reject → Tell the customer                        │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                   │
   ┌───────────────────────────────▼────────────────────────────────────────────┐
   │  SETTLE THE MONEY  Pay the repair → Claim money back from the supplier →     │
   │  (6.7.3.7-9, 6.7.4) Reconcile the books → Close the claim                    │
   └───────────────────────────────┬────────────────────────────────────────────┘
                                   │
   ┌───────────────────────────────▼────────────────────────────────────────────┐
   │  LEARN             Ask "were you happy?" · Watch for repeat defects ·         │
   │  (6.7.5, 6.7.6)    Catch fraud · Report metrics · Warn the factory           │
   └────────────────────────────────────────────────────────────────────────────┘
```

Five acts: **Set up → Ask first → The claim → Settle the money → Learn.** The rest of this document
zooms into each.

---

## ACT 1 — Set up *(APQC 6.7.1, 6.7.2)*

Before anyone can claim, two things must exist: the **car** must be on record, and the **rules** that
say what's covered must be written down.

```
   ┌──────────────────┐        ┌──────────────────────────────────────────┐
   │  Register the    │        │  Define the warranty offering             │
   │  vehicle         │        │                                           │
   │                  │        │  • Policy:  what's covered, for how long   │
   │  VIN ─► owner    │  ───►  │  • Claim codes: standard repair time/rate  │
   │  start + expiry  │        │  • Supplier deals: who pays for what       │
   │                  │        │  • Customer offers: extended warranty/AMC  │
   └──────────────────┘        └──────────────────────────────────────────┘
       6.7.1                              6.7.2
```

**Register the vehicle (6.7.1)** — *Plain English:* the car is entered into the system with its VIN,
its owner, and the exact dates its warranty starts and ends. If the car is sold second-hand, ownership
transfers cleanly to the new person. This is the anchor everything else hangs off.

**Write the policy (6.7.2.1) & claim codes (6.7.2.2)** — *Plain English:* the policy is the rulebook —
"the AC is covered for 36 months." Claim codes are the price list — "fixing an AC takes 2.5 hours at
₹850/hour." Together they make every decision consistent and every cost fair, instead of guessed.

**Agree who pays with suppliers (6.7.2.3)** — *Plain English:* if Bosch makes the brake pad, we agree
in advance that Bosch refunds us when their pad fails. This deal is what makes Act 4 (recovery) possible.

**Customer offerings (6.7.2.4) & communicate (6.7.2.5)** — *Plain English:* customers can buy an
extended plan, and they can read, in clear language, exactly what their warranty covers — so there are
no surprises later.

---

## ACT 2 — Ask first (preauthorization) *(APQC 6.7.2.6)*

A convenience step. The customer (or dealer) asks **before** doing the repair: *"if I fix this, will
you cover it?"* The system runs the same coverage + cost checks and gives a provisional yes/no — but
does **not** open a full claim yet.

```
   Customer: "My AC is failing — will this be covered?"
            │
            ▼
   ┌─────────────────────────────┐
   │  Pre-check (no claim yet)    │
   │  • Is the part covered?      │  ──►  "Yes — pre-approved up to ₹30,000.
   │  • Is the warranty valid?    │        Bring it in and we'll process it."
   │  • Rough cost?               │
   └─────────────────────────────┘
              6.7.2.6
```

**Plain English:** it's a quote before the work. The customer avoids paying out of pocket and hoping
for a refund — they get peace of mind up front, and the dealer knows they'll be reimbursed.

---

## ACT 3 — The claim *(APQC 6.7.3)*

The heart of the system. A problem is reported, the AI works it step by step, and a person makes the
final call. Each box is one specialist doing one job.

```
   Customer describes the problem (+ photo)
            │
            ▼
   ┌─────────────────────┐
   │ 1. RECEIVE          │  Read the message. Ask one question only if something
   │    6.7.3.1          │  important is missing. Pull out: part, symptom, car.
   └─────────┬───────────┘
            ▼
   ┌─────────────────────┐
   │ 2. VALIDATE         │  Fixed rule check: is this part covered, and is the
   │    6.7.3.2          │  warranty still in date? (Never an AI guess.)
   └─────────┬───────────┘
            ▼
   ┌─────────────────────┐
   │ 3. INVESTIGATE      │  Look at the photo ("does it match?"). If needed:
   │    6.7.3.3          │  book a workshop slot, request the broken part back,
   │                     │  and note the root cause for the factory.
   └─────────┬───────────┘
            ▼
   ┌─────────────────────┐
   │ 4. WHO IS AT FAULT? │  Manufacturer defect? Supplier's part? Or customer
   │    6.7.3.4          │  damage (not covered)? This decides who pays.
   └─────────┬───────────┘
            ▼
   ┌─────────────────────┐
   │ 5. CHECK FOR FRAUD  │  Look at past claims for this car/owner. Score how
   │    6.7.5.5          │  unusual it is. "Not covered" is a plain no, not fraud.
   └─────────┬───────────┘
            ▼
   ┌─────────────────────┐
   │ 6. COST + DECIDE    │  Add up parts + labour. Recommend approve / reject /
   │    6.7.3.5          │  escalate, with a clear reason and a draft message.
   └─────────┬───────────┘
            ▼
       ┌─────┴───────────────────────────┐
       │  Is it clearly safe & cheap?     │
       │  high confidence · low fraud ·   │
       │  low cost · clear coverage       │
       └─────┬───────────────────┬────────┘
        yes │                  │ no / rejection / risk
            ▼                  ▼
   ┌──────────────┐   ┌──────────────────────────┐
   │ AUTO-DECIDE  │   │ HUMAN REVIEW             │
   │ system       │   │ Manager sees the whole   │
   │ finalises    │   │ reasoning chain + photo  │
   │              │   │ → Approve / Reject       │
   └──────┬───────┘   └────────────┬─────────────┘
         └──────────────┬──────────┘
                        ▼
   ┌─────────────────────┐
   │ 7. NOTIFY           │  Tell the customer the outcome by email/SMS, with a
   │    6.7.3.6          │  claim reference number and a clear explanation.
   └─────────┬───────────┘
            ▼
       If rejected, the customer may APPEAL once (with new evidence) → back to review.
```

**The one rule that matters:** nothing expensive or risky is ever finalised by the AI alone. A human
confirms every consequential decision, and the system records who did it.

**Three speeds of decision:**
- **Auto** — small, safe, clearly-covered claims close instantly (and clear rejections too).
- **Human** — anything expensive, doubtful, or flagged goes to a manager.
- **Appeal** — a rejected customer gets one fair chance to come back with more proof.

---

## ACT 4 — Settle the money *(APQC 6.7.3.7–6.7.3.9, 6.7.4)*

Approval isn't the end. Real money now moves — out to fix the car, and back from the supplier who
caused the failure.

```
   Claim approved
        │
        ▼
   ┌──────────────────┐   ┌──────────────────────────────────────────────┐
   │ AUTHORIZE PAY    │   │  The claim record (the money document)        │
   │ 6.7.3.7          │──►│  Labour: 2.5h × ₹850        = ₹2,125          │
   │ Pay the repair   │   │  Parts:  AC compressor      = ₹28,000         │
   └────────┬─────────┘   │  Total                      = ₹30,125         │
            │             └──────────────────────────────────────────────┘
            ▼
   ┌──────────────────────────────────────────────────────────┐
   │ RECOVER FROM SUPPLIER  6.7.4                              │
   │ The AC compressor is a Continental part, not ours.        │
   │ → Draft a recovery claim to Continental for ₹28,000.      │
   │ → Manager reviews and sends it.                           │
   │ → Track it until they pay us back.                        │
   └────────┬─────────────────────────────────────────────────┘
            ▼
   ┌──────────────────┐        ┌──────────────────┐
   │ RECONCILE        │        │ CLOSE            │
   │ 6.7.3.9          │  ───►  │ 6.7.3.8          │
   │ Match what we    │        │ Mark the claim   │
   │ paid vs got back │        │ done. Full trail │
   │ Export for finance│       │ saved for audit. │
   └──────────────────┘        └──────────────────┘
```

**Authorize payment (6.7.3.7)** — *Plain English:* the system actually pays the repair and records who
approved the payout and when.

**Recover from supplier (6.7.4)** — *Plain English:* if an outside supplier's part failed, we get our
money back from them. The system drafts the recovery letter; a manager checks and sends it; we track it
until they pay. This is how warranty stops being pure cost.

**Reconcile (6.7.3.9)** — *Plain English:* balance the books — what we paid out vs. what we recovered —
and hand finance a clean report.

**Close (6.7.3.8)** — *Plain English:* the claim is finished, and every step (AI and human) is saved
permanently so it can be audited or disputed later.

---

## ACT 5 — Learn *(APQC 6.7.5, 6.7.6)*

Every claim is also data. The finished system turns settled claims into feedback that improves the
product, catches cheats, and warns the factory early.

```
   Closed claims  ─────────────────────────────────────────────┐
        │                  │                  │                 │
        ▼                  ▼                  ▼                 ▼
   ┌──────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │ ASK      │   │ WATCH FOR    │   │ CATCH        │   │ REPORT       │
   │ "Happy?" │   │ DEFECT       │   │ FRAUD        │   │ METRICS      │
   │ 6.7.5.1  │   │ PATTERNS     │   │ 6.7.5.5      │   │ 6.7.5.2      │
   │ ★ rating │   │ 6.7.5.3      │   │ repeat/odd   │   │ approval %,  │
   │          │   │ "14 same     │   │ claims       │   │ avg cost,    │
   │          │   │ failures →   │   │              │   │ $ recovered  │
   │          │   │ tell factory"│   │              │   │              │
   └──────────┘   └──────┬───────┘   └──────────────┘   └──────────────┘
                        ▼
              ┌────────────────────────┐
              │ CAPA ALERT → ENGINEERING│  Possible batch defect — investigate,
              │ (feeds Recall 6.7.6)    │  maybe trigger a recall.
              └────────────────────────┘
```

**Satisfaction / CSAT (6.7.5.1)** — *Plain English:* after a claim is resolved, ask the customer to
rate it 1–5 stars. The manager dashboard shows the average, so we know if people are actually happy,
not just whether claims were closed.

**Defect patterns & improvement (6.7.5.3)** — *Plain English:* if many owners of the same model report
the same part failing, that's not bad luck — it's a manufacturing defect. The system spots the cluster
and raises a CAPA (Corrective and Preventive Action) alert to the engineering team automatically.

**Fraud (6.7.5.5)** — *Plain English:* keep watching for the same repair claimed again and again, or
stories that don't add up, and flag them for a human to investigate.

**Metrics (6.7.5.2)** — *Plain English:* a live dashboard — how many approved, average cost, fraud
caught, money recovered — so managers see the health of the whole operation at a glance.

**Recall performance (6.7.6)** — *Plain English:* if a defect cluster leads to a recall, measure how
well that recall is going (how many cars fixed) and close the loop.

---

## The complete coverage checklist

The finished warranty domain covers all of these — no gaps, no stubs:

| Act | APQC | What it guarantees |
|---|---|---|
| Set up | 6.7.1 | every car is registered with real warranty dates |
| Set up | 6.7.2.1 / .2 | coverage and costs come from a written rulebook, not guesses |
| Set up | 6.7.2.3 | supplier refunds are agreed in advance |
| Set up | 6.7.2.4 / .5 | customers can buy extended cover and read clear terms |
| Ask first | 6.7.2.6 | a quote before the repair — no out-of-pocket surprises |
| The claim | 6.7.3.1 / .2 | claims are received and checked against fixed rules |
| The claim | 6.7.3.3 | evidence is examined; service booked; root cause noted |
| The claim | 6.7.3.4 | the system knows who is at fault, so who pays |
| The claim | 6.7.3.5 | every decision is reasoned, with a human on anything risky |
| The claim | 6.7.3.6 | the customer is told clearly, and can appeal a rejection |
| Settle | 6.7.3.7 | approved claims are actually paid |
| Settle | 6.7.4 | money is recovered from at-fault suppliers |
| Settle | 6.7.3.9 / .8 | books are reconciled and the claim is closed with a full audit trail |
| Learn | 6.7.5.1 | customers rate the outcome |
| Learn | 6.7.5.2 | managers see live performance metrics |
| Learn | 6.7.5.3 | repeat defects raise automatic factory alerts |
| Learn | 6.7.5.5 | fraud is continuously watched for |
| Learn | 6.7.6 | recall effectiveness is measured |

---

*Framework: APQC Automotive PCF v7.2.2 — 6.7 Service Products After Sales. This is the target ("done")
picture; build order and current status live in `FORWARD-PLAN.md` and `APQC-COVERAGE.md`.*
