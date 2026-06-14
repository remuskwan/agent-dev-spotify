# AI Customer Service Agent for a Streaming Service — Design

## Context

This document designs an AI agent that handles customer service for a music/video
streaming product (Spotify-like): answering questions, troubleshooting playback
and billing, and **executing sensitive account actions** such as purchasing,
upgrading, downgrading, and cancelling subscriptions, and issuing refunds. The
business need is to deflect routine support volume, cut handle time, and stay
available 24/7 — without creating new risk around money movement, PII, or
account takeover.

**Scope decisions:**
- **Primary channel:** in-app / web chat (text). Other channels are out of scope
  for v1 but the architecture leaves room for them.
- **Sensitive actions:** the agent *executes* them directly, but every sensitive
  action is gated by identity verification, explicit user confirmation, and
  policy checks. This is the core reason the guardrail layer is non-negotiable.

The two cross-cutting requirements — **observability / performance measurement**
and **guardrails for sensitive flows** — are treated as first-class sections.

---

## 0. Agent Purpose & Configuration

### 0.1 Purpose (mission)
A support assistant for streaming-service customers that **resolves account,
billing, and playback issues in one conversation** — including executing plan
changes, cancellations, and refunds — while staying strictly within policy and
escalating to a human whenever it is uncertain, blocked, or out of scope. Success
is a *resolved* issue, not just a *deflected* one.

### 0.2 Persona & tone
Friendly, concise, plain-language; empathetic on billing/complaint topics;
never pushy on upsell. Identifies as the company's virtual assistant (not human),
and offers a human whenever asked.

### 0.3 Scope
- **In scope:** account/billing, plan changes, refunds, playback/device support,
  security/ATO routing, grounded policy Q&A.
- **Out of scope → refuse or hand off:** legal/financial advice, anything outside
  the user's own account, requests to bypass policy or verification, content
  outside the help/policy corpus.

### 0.4 Operating principles (system-prompt core)
1. **Ground or abstain** — factual/policy/billing claims must come from
   `search_knowledge` or `get_account_context`; cite them. If unsupported, say so
   and hand off. Never invent prices, discounts, waivers, or commitments.
2. **Verify before sensitive anything** — no sensitive read or write without a
   valid identity-verification token (§4.2).
3. **Confirm before money moves** — present an exact human-readable summary and
   require explicit user confirmation (§4.2).
4. **One sensitive action at a time** — never batch or chain money-moving actions
   in a single confirmation.
5. **Propose, don't decide policy** — eligibility/caps are decided by the policy
   engine, not the model.
6. **Fail to a human** — on low confidence, repeated guardrail blocks, fraud or
   vulnerable-user signals, or explicit request, call `escalate_to_human`.

### 0.5 Model & runtime config
- **Model routing:** triage/simple FAQ → small fast model (e.g., Claude Haiku
  4.5); complex reasoning + sensitive-flow drafting → capable model (e.g., Claude
  Sonnet 4.6, Opus 4.8 for the hardest cases).
- **Sampling:** low temperature (~0.2) for policy/transactional turns;
  moderately higher only for empathetic phrasing. Deterministic where it matters.
- **Context budget:** rolling summary + last *N* verbatim turns (§5.4); hard cap
  on output tokens.
- **Tool-use policy:** parallel **reads** allowed; sensitive **writes**
  serialized, verification-gated, idempotent; max tool iterations per turn capped.
- **Versioning:** system prompt + config are versioned; changes ship only through
  the eval gate (§3.3) with canary rollout.

---

## 1. Requirements

### 1.1 Functional requirements
- **Account & billing:** explain charges, change plan (upgrade/downgrade),
  start/cancel subscription, apply promos, issue refunds within policy, update
  payment method (via secure handoff, never raw card data in the LLM).
- **Playback / technical support:** troubleshoot streaming quality, offline
  downloads, device limits, login issues; walk users through fixes.
- **Content & discovery:** answer catalog/availability questions, explain
  features (e.g., lyrics, podcasts), report content problems.
- **Account security:** detect and route suspected account takeover / fraud;
  trigger password reset and session revocation flows.
- **Knowledge Q&A:** policy, regions, pricing, feature availability — grounded in
  a retrieval corpus, not model memory.
- **Escalation / handoff:** seamless transfer to a human agent with full context
  when confidence is low, policy requires it, or the user asks.

### 1.2 Non-functional requirements
- **Latency:** first token < 1.5s p50 / < 3s p95; tool calls < 2s p95.
- **Availability:** 99.9%; graceful degradation to FAQ + human queue if the LLM
  or a tool is down.
- **Security & privacy:** PII minimization, encryption in transit/at rest,
  data-retention limits, GDPR/CCPA delete/export, PCI-DSS scope kept *out* of the
  LLM path (tokenized payments only).
- **Scalability:** stateless agent workers behind a session store; horizontal
  scale on concurrent conversations.
- **Cost:** per-conversation token + tool budget with model routing (small model
  for triage, larger for complex reasoning).
- **Auditability:** every sensitive action fully reconstructable from logs.

### 1.3 Out of scope (v1)
Voice/IVR, email/social channels, proactive outbound messaging, agent-initiated
marketing. Architecture must not preclude them.

---

## 2. Features

| Capability | Description |
|---|---|
| Conversational triage | Classify intent, sentiment, urgency; route to the right toolset / sub-flow. |
| Grounded answers (RAG) | Retrieval over help-center + policy docs with citations; refuse/handoff when no grounding. |
| Account tools | Read account/subscription/billing state via internal APIs (least-privilege, per-session scoped tokens). |
| Transactional tools | Execute plan changes, cancellations, refunds — each wrapped in the guardrail pipeline (§4). |
| Identity verification | Step-up auth before any sensitive read/write (re-auth, OTP, or session-binding check). |
| Confirmation & receipts | Explicit "confirm" step with a human-readable summary + amount before money moves; emit receipt. |
| Memory | Three-tier model — short-term conversation, working task state, long-term user profile (see §5.4). |
| Human handoff | Warm transfer with transcript, intent, and proposed action; agent never silently drops. |
| Multilingual | Detect and respond in the user's language; route to localized policy. |
| Feedback capture | Post-resolution CSAT + thumbs; feeds eval set (§3). |

---

## 3. Observability & Performance Measurement

Three layers — **traces, metrics, evals** — so we can answer "what happened in
this one conversation?" and "is the system healthy / improving?"

### 3.1 Tracing (per-conversation, per-turn)
- Adopt **OpenTelemetry GenAI semantic conventions**. One trace per
  conversation; spans per turn, per LLM call, per tool call, per guardrail check.
- Span attributes: model + version, prompt/response token counts, latency,
  retrieval doc IDs + scores, tool name + args (PII-redacted) + result, guardrail
  verdicts, cost.
- Use an LLM-observability backend (e.g., Langfuse / Arize Phoenix / LangSmith,
  or OTel → Grafana Tempo) for trace search and replay.

### 3.2 Metrics / KPIs (dashboards + alerts)
- **Quality:** containment/deflection rate, resolution rate, escalation rate,
  CSAT, handoff reason mix.
- **Trust/safety:** guardrail trigger rate, hallucination/groundedness score,
  refusal rate, sensitive-action confirmation drop-off, false-block rate.
- **Performance:** first-token & full-response latency (p50/p95/p99), tool
  latency/error rate, LLM error/timeout rate.
- **Cost:** tokens & $ per conversation, per resolved issue; model-routing mix.
- **Business:** subscription saves vs. churn, refund $ volume, upsell conversion
  via agent.

### 3.3 Evaluation harness (offline + online)
This section is the *approach*; the concrete, runnable suite and gating
thresholds are in §7.
- **Golden set** of representative conversations per intent, including adversarial
  and sensitive-flow cases; run on every prompt/model/tool change in CI.
- **LLM-as-judge** scorers for groundedness, helpfulness, policy adherence, tone;
  calibrated against human-labeled samples.
- **Online:** sampled production conversations auto-scored; CSAT + thumbs as
  ground-truth signal; regression alerts.
- **Experimentation:** A/B and shadow/canary on prompts and models, gated by
  guardrail + eval metrics, with rollback.

---

## 4. Guardrails (sensitive-flow focus)

The agent can move money, so guardrails are a **pipeline around every turn and
every tool call**, not a single prompt instruction. Defense in depth:

### 4.1 Input guardrails (before the model acts)
- Prompt-injection / jailbreak detection (esp. against retrieved content and
  user-supplied text).
- PII / payment-data detection → block raw card numbers from ever entering the
  LLM context; redact before logging.
- Intent + risk classification: tag turns as `info` vs. `sensitive` (purchase,
  refund, cancel, PII change). Sensitive tags raise the gate.

### 4.2 Action guardrails (before a sensitive tool runs) — the critical path
1. **Identity verification / step-up auth:** require a fresh, verified session
   (re-auth or OTP) before any sensitive read or write. No verification → no tool.
2. **Authorization / scope check:** session token grants least privilege; the
   action must match the authenticated user's own account.
3. **Policy engine:** deterministic rules outside the LLM (refund eligibility,
   refund $ caps, plan-change legality, region/age constraints). The LLM
   *proposes*; policy code *decides* whether it's allowed.
4. **Explicit confirmation:** present a human-readable summary — exact plan,
   price, billing date, refund amount — and require an unambiguous user
   confirmation before execution. Re-confirm on any change.
5. **Limits & rate caps:** per-user/per-session caps on refunds, plan changes,
   and retries; anomalies → hold + human review.
6. **Idempotency:** every transactional tool call carries an idempotency key to
   prevent double charges/refunds on retry.

### 4.3 Output guardrails (before the user sees the response)
- Groundedness/citation check on factual claims; block ungrounded
  billing/policy statements.
- Toxicity / tone / brand-safety filter.
- No-promise rule: agent cannot invent discounts, waivers, or commitments outside
  policy.

### 4.4 Escalation & fail-safe
- Low confidence, repeated guardrail blocks, fraud signals, vulnerable-user
  signals, or explicit request → **human handoff** with full context.
- Fail **closed** on sensitive actions: if a guardrail/policy/identity service is
  unavailable, do not execute — offer handoff or retry later.

### 4.5 Audit
- Immutable, tamper-evident log of every sensitive action: who, what, policy
  verdict, confirmation token, idempotency key, outcome — for dispute resolution
  and compliance.

---

## 5. Architecture

### 5.1 High-level components
```
Web/in-app chat UI
        │  (streaming)
        ▼
API / orchestration layer ──► Session & memory store (short + long term)
        │
        ▼
   Agent runtime (the loop)
   ├─ Guardrail pipeline (input → action → output)   [§4]
   ├─ Model router (small triage model ↔ large reasoning model)
   ├─ RAG retriever ──► Vector store + help/policy corpus
   └─ Tool layer — focused catalog (§5.5)
            ├─ search_knowledge      (read · grounded answers)
            ├─ get_account_context   (read · identity-gated)
            ├─ verify_identity       (auth · gates sensitive tools)
            ├─ manage_subscription   (write · sensitive · idempotent)
            ├─ issue_refund          (write · sensitive · idempotent)
            └─ escalate_to_human     (handoff)
        │
        ▼
   Backend services / internal APIs  (payments stay tokenized, PCI out of LLM scope)
        │
        ▼
   Observability bus: OTel traces + metrics + eval scores  [§3]
```

### 5.2 Key design decisions
- **Tools, not free-form actions.** All side effects go through typed,
  least-privilege tools with server-side validation — the LLM never calls
  internal APIs directly.
- **Policy as deterministic code**, separate from the prompt. LLM proposes,
  policy engine authorizes. This is what makes "agent executes" safe.
- **Stateless agent workers + external session store** for horizontal scale and
  crash-safe resume of multi-step sensitive flows.
- **Model routing** for cost/latency: cheap model for triage/simple FAQ, capable
  model (latest Claude) for complex reasoning and sensitive-flow drafting.
- **Streaming responses** for low perceived latency; guardrail output checks run
  on the assembled response before commit of any action.
- **Human-in-the-loop** as a first-class path, not an error state.

### 5.3 Data & privacy
- PII minimization in context; redaction before logging; payment data tokenized
  and never in LLM context. Retention limits + GDPR/CCPA export/delete. Consent
  for long-term memory.

### 5.4 Memory architecture

We model **three tiers**, each with a distinct lifetime, store, and privacy rule.
RAG (§5.1) is organizational knowledge, *not* user memory, and is kept separate.

| Tier | What it holds | Lifetime | Store | Notes |
|---|---|---|---|---|
| **Short-term (conversational)** | Running message history of the current chat — user/agent turns, tool results. | Session; archived/expired shortly after close. | Fast session store (e.g., Redis), keyed by `conversation_id`. | Rolling summarization past the context window: keep last *N* turns verbatim, summarize older. Pin critical facts so they survive summarization. PII-redacted before logging. |
| **Working (task scratchpad)** | Transient state of the *current task*: intent, in-progress plan, retrieved snippets, tool outputs, and the **guardrail state machine** (identity verified? policy passed? confirmation token issued? idempotency key minted?). | One task/flow; discarded on completion or handoff. | Per-turn orchestration state object, **persisted to the session store** for crash-safe resume of multi-step flows. | Holds security/money-relevant state as *explicit deterministic state*, not prompt text. Enables stateless workers (§5.2) to resume a mid-flow cancel+refund. |
| **Long-term (user profile)** | Durable, cross-conversation facts: plan/billing history, prior issues & resolutions, device list, language/comms preferences, consent flags, prior fraud/handoff signals. | Persistent; governed by retention + consent. | **System-of-record backend services** (account/billing DB), read via least-privilege tools. | Not a free-form "memory blob" the model writes. Consented, redacted, GDPR/CCPA export/delete. No LLM-readable payment data. |

**Load-bearing rule:** security- and money-relevant state lives in deterministic
**working memory** and the **system-of-record** — never reconstructed by the LLM
from conversational memory. The chat transcript is a convenience layer; it is
**never** the source of truth for "is this user verified" or "did they already
get refunded." This mirrors §5.2: policy/authorization is deterministic code, not
prompt content.

**Boundary with RAG:** long-term memory is *about this user*; RAG is *about the
product/policy*. Keeping them distinct prevents one user's data from leaking into
another's context.

#### 5.4.1 Context-window management

The short-term tier feeds the LLM, so what enters the context window each turn is
explicitly budgeted, not just "the whole transcript." The orchestration layer
assembles context deterministically before every model call.

**Budget allocation (per turn).** The window is partitioned with a reserved
output headroom; sections are filled in priority order and the lowest-priority
ones are truncated first when space runs low:

| Priority | Segment | Policy |
|---|---|---|
| 1 | System prompt + operating principles (§0.4) | Always present, never summarized. |
| 2 | Pinned facts | Small, high-value items (current intent, account/plan identifiers, open ticket, language). Survive summarization. |
| 3 | Working-memory state digest (§5.4) | A compact, deterministic render of the guardrail state machine (verified? policy verdict? confirmation issued?). Read from the state object, **never** free-text from the transcript. |
| 4 | Retrieved snippets (RAG, current turn) | Only the top-k for the active question; dropped after the turn (re-fetchable via `search_knowledge`). |
| 5 | Recent verbatim turns (last *N*) | Full-fidelity tail of the conversation. |
| 6 | Rolling summary of older turns | Structured summary that replaces evicted verbatim history. |

**Rolling summarization.** When input tokens cross a high-water mark (e.g., ~70%
of the window), the oldest verbatim turns beyond the last *N* are folded into a
**structured** summary (open issue, decisions, facts established, pending action)
rather than a prose blob — structure keeps it compact and lossy-in-the-right-
places. Summaries are generated by the small model to keep cost down.

**Eviction order.** Reclaim space cheapest-first: (1) stale tool outputs and
retrieved snippets (re-fetchable), (2) older verbatim turns → summary, (3) older
summary spans compacted further. Priorities 1–3 above are never evicted.

**Hard caps (§0.5).** Max input tokens, max output tokens, and max tool-call
iterations per turn are all capped; exceeding the tool-iteration cap forces a
checkpoint to the user or `escalate_to_human` instead of looping.

**Determinism guardrail.** Summarization and eviction are *lossy*, so they must
never become the source of truth for anything security- or money-relevant. Per
the §5.4 load-bearing rule, "is the user verified?", "what did policy decide?",
and "was the refund already issued?" are always read from the working-memory
state object and the system-of-record — so a turn whose history has been
summarized away still cannot bypass a guardrail. The context window is a view
for the model, not the ledger.

**Degradation.** If assembly still overflows after eviction, fail safe: drop to
pinned facts + state digest + the latest user turn and, for any in-progress
sensitive flow, prefer a confirmation checkpoint or handoff over proceeding on
thinned context.

### 5.5 Tool catalog (focused)

Deliberately small — **6 tools** covering the full journey (read → verify → act →
escalate). A tight surface is easier to secure, test, and observe than a sprawling
one. Each sensitive write runs the §4.2 pipeline server-side.

| Tool | Type | Guardrails | Purpose |
|---|---|---|---|
| `search_knowledge` | read · non-sensitive | — | RAG over help/policy corpus; returns snippets + citations to ground every factual answer. |
| `get_account_context` | read · PII | identity-gated for PII fields | Snapshot of the authenticated user's account, subscription, billing, and devices. |
| `verify_identity` | auth | — (it *is* the gate) | Initiates/confirms step-up auth (re-auth/OTP); issues the short-lived verification token that sensitive tools require. |
| `manage_subscription` | write · sensitive | verify + policy + confirm + idempotency-key | Start / upgrade / downgrade / cancel a plan. |
| `issue_refund` | write · sensitive | verify + policy ($ caps) + confirm + idempotency-key | Refund within policy. |
| `escalate_to_human` | handoff | — | Warm transfer with transcript, intent, and proposed action. |

> To shrink to **5 tools**, `manage_subscription` and `issue_refund` can merge
> into one `modify_billing(action, …)` tool. Kept separate here for clearer
> per-action guardrails, auditing, and rate caps.

Payment-method updates are intentionally **not** a tool: they route to a secure,
tokenized payment flow so raw card data never enters the agent/LLM path.

---

## 6. Verification / Acceptance Criteria
A later implementation must meet:
- **Guardrail conformance tests:** every sensitive tool is unreachable without
  passing identity + policy + confirmation; idempotency prevents double
  execution; fail-closed under dependency outage.
- **Eval gate in CI:** golden-set + adversarial suite must pass thresholds for
  groundedness, policy adherence, and false-block rate before deploy.
- **Observability check:** every conversation produces a complete trace; sensitive
  actions produce an audit record reconstructable end-to-end.
- **Memory integrity:** guardrail/verification state is read only from working
  memory and the system-of-record, never inferred from the transcript; a mid-flow
  worker crash resumes from persisted working memory without re-charging or
  skipping verification.
- **Load/latency test:** meets p50/p95 latency and availability targets under
  target concurrency, with graceful degradation when the LLM/tool is down.

---

## 7. Eval suite

This is the concrete, runnable instantiation of the §3.3 harness and the §6
acceptance criteria. It is the **deploy gate**: every prompt, model, tool, or
policy change runs the offline suite in CI, and a sampled version scores
production online. A change ships only if it clears the thresholds below.

### 7.1 Suite structure

Each eval case is a fixture: `{ conversation, account/policy fixtures, tool mocks,
expected outcome, scorers }`. Cases are versioned with the prompt/config they
target. Tools are mocked deterministically so the suite tests the *agent's*
decisions, not backend availability (outages are exercised separately in 7.2).

| # | Suite | What it checks | Scorer(s) | Type |
|---|---|---|---|---|
| A | **Grounded Q&A** | Answers come from `search_knowledge` with citations; abstains + hands off when no grounding exists. | Groundedness (LLM-judge), citation-present (deterministic), no-hallucination | Offline |
| B | **Intent & routing** | Correct intent/risk tag (`info` vs `sensitive`), correct model route, correct sub-flow. | Classification accuracy/F1 vs. labels | Offline |
| C | **Sensitive happy path** | Refund / plan-change / cancel each run verify → policy → confirm → idempotent execute, in order. | State-machine assertion (deterministic), order check | Offline |
| D | **Guardrail conformance** | Sensitive tool is **unreachable** without verify + policy + confirm; one-action-per-confirmation; idempotency blocks double execution. | Tool-precondition assertion; replayed call returns original result | Offline |
| E | **Policy adherence** | Denials/caps respected; agent never waives, invents discounts, or exceeds refund caps (no-promise rule). | Policy-violation rate (must be 0), LLM-judge | Offline |
| F | **Adversarial / red-team** | Prompt injection (incl. via retrieved docs), jailbreaks, social-engineering ("skip the code, I'm the owner"), cross-account access ("refund my friend"), PII/card exfiltration. | Attack-success rate (must be ≈0); injection-resistance judge | Offline |
| G | **Fail-safe & resilience** | Identity/policy service down → fail **closed**; tool error → graceful degradation; mid-flow crash resumes from working memory without re-charging. | Outcome assertion under fault injection | Offline |
| H | **Tone & safety** | Empathetic on billing/complaints, never pushy on upsell, brand-safe, toxicity-free; correct persona (identifies as non-human). | Tone/brand LLM-judge, toxicity classifier | Offline |
| I | **Multilingual** | Detects user language, responds in it, routes to localized policy. | Language-match + per-language groundedness | Offline |
| J | **Online / production** | Sampled live conversations auto-scored; CSAT + thumbs as ground truth; regression alerting. | Same judges as A/E/H, calibrated to human labels | Online |

The **golden set** is the union of A–I; adversarial (F) and guardrail (D) cases
are mandatory and expanded whenever an incident or red-team finding surfaces a
new failure mode (every production guardrail block worth investigating becomes a
fixture).

### 7.2 Gating thresholds (illustrative)

CI fails the build — and blocks deploy — if any of these regress:

- **Guardrail conformance (D) & adversarial (F):** 100% / attack-success ≈ 0%.
  Zero tolerance; a single bypass is a hard fail.
- **Policy violations (E):** 0 — no invented waivers, no cap breaches.
- **Groundedness (A):** ≥ target (e.g., 0.95) with citation present on every
  factual/billing claim.
- **Routing accuracy (B):** ≥ target; **false-block rate** (legit sensitive
  request wrongly refused) ≤ target — guards against over-blocking from F.
- **Fail-safe (G):** 100% fail-closed under dependency outage; crash-resume never
  double-executes.
- **Tone/safety (H):** ≥ target, toxicity ≈ 0.
- **No net regression** vs. the current production baseline on the full golden set.

### 7.3 Calibration & change management

- **Judge calibration:** LLM-as-judge scorers are validated against human-labeled
  samples; agreement is itself tracked, and judges are re-calibrated when they
  drift. A judge change is a versioned change that re-runs the suite.
- **Rollout:** changes that pass offline go to **shadow → canary** with the §3.2
  trust/safety + cost metrics as live guardrails and automatic rollback on
  regression (§3.3).
- **Maintenance:** fixtures are reviewed for staleness as policy/pricing change;
  online-discovered failures are back-ported into the offline golden set so the
  suite monotonically hardens over time.

---

## 8. Phased roadmap
1. **v0 — Grounded Q&A + read-only tools** (no money movement). Establish RAG,
   tracing, evals, handoff.
2. **v1 — Sensitive actions behind full guardrail pipeline** (plan change,
   cancel, refund) with identity step-up, policy engine, confirmation, audit.
3. **v2 — Optimization & expansion:** model routing/cost tuning, proactive
   churn-save offers, additional channels (voice/email).
