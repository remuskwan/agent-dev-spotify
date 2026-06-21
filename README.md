# Streamify Agent

AI customer support agent for a Spotify-like streaming service. Handles account questions, plan changes, cancellations, and refunds with identity verification, policy guardrails, and an audit trail.

## Prerequisites

- Node.js 20+
- OpenAI API key

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

## Running the app

### CLI (interactive chat)

```bash
npm run dev
```

Starts an interactive terminal session with the agent. Useful for manual testing and exploration.

### HTTP service

```bash
npm run serve
```

Starts the REST API on `http://localhost:8787` (configurable via `PORT` in `.env`).

**Key endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Liveness check |
| `POST` | `/sessions` | Create a new conversation session |
| `POST` | `/sessions/:id/messages` | Send a message, get agent reply + tool logs + spans |
| `GET` | `/sessions/:id` | Full session snapshot (transcript, spans, audit) |
| `DELETE` | `/sessions/:id` | End a session |

See [`src/service/API.md`](src/service/API.md) for the full contract including request/response shapes.

## Tests

```bash
npm test          # run all CI-safe tests (~700ms, no LLM calls)
npm run test:watch  # watch mode
```

The suite has 11 test files covering guardrail units, policy conformance, adversarial inputs, server concurrency, and regression cases. 5 tests are live-eval only and are skipped in CI.

**Safety-gate suites** (must be 100%): D guardrail-conformance, E policy-adherence, F adversarial, G failsafe, I regression, K server-concurrency.

**Quality-bar suites** (scored thresholds): A grounded-qa ≥95%, B intent-routing ≥90%, H tone-safety ≥90%.

## Eval-driven improvement loop

The eval tooling runs the suite, buckets failures, and proposes targeted fixes. All stages except the final verify gate produce artifacts for human review — no tooling writes to `src/`.

```bash
# Stage 1 — run and produce failure report
npm run eval:report           # mock LLM (fast, CI-safe)
npm run eval:report:live      # real LLM (needs OPENAI_API_KEY)

# Stages 2–4 — triage failures and propose fixes
npm run eval:triage           # reads latest.failures.json → triage.json + FIXES.md

# Stages 1–4 in one command
npm run eval:loop

# Stage 5 — verify fixes (run after applying edits from FIXES.md)
npm run eval:verify
npm run eval:verify -- --live

# Live eval (real LLM, verbose output)
npm run eval:live
```

**Reports** are written to `evals/reports/` (git-ignored):

| File | Written by | Purpose |
|------|------------|---------|
| `<timestamp>.json` | `eval:report` | Raw Vitest JSON |
| `latest.failures.json` | `eval:report` | Normalized failure list |
| `triage.json` | `eval:triage` | Bucketed failures + evidence |
| `FIXES.md` | `eval:triage` | Fix proposals for human review |
| `pre-fix.failures.json` | `eval:verify` | Baseline snapshot before re-run |

See [`evals/LOOP.md`](evals/LOOP.md) for the full playbook including the surface map, tighten-only rule for safety gates, and golden-set expansion conventions.

## Observability

The agent writes two JSONL streams per session:

- `traces/<conversationId>.jsonl` — spans (turn, llm, tool, guardrail) with durations and attributes
- `audit/<conversationId>.jsonl` — audit records for every sensitive action (PII fields redacted)

## Type checking

```bash
npm run typecheck
```

Checks both `src/` and `evals/` TypeScript configs.
