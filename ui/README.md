# Streamify Agent UI

Next.js + shadcn/ui chat interface and observability inspector for the Streamify AI support agent.
Talks to the agent **only over HTTP** — no shared code with the agent package.

## Prerequisites

The agent service must be running:
```bash
# in the repo root (agent_dev_spotify/)
npm run serve        # starts on http://localhost:8787
```

## Setup

```bash
cp .env.local.example .env.local   # defaults point to localhost:8787
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_AGENT_API_URL` | `http://localhost:8787` | Agent service base URL |

## UI Layout

- **Chat panel** (left) — message bubbles, quick-start chips, confirmation affordance
- **Inspector** (right) — three tabs:
  - **Timeline** — per-turn trace spans (`turn ↻`, `llm 🤖`, `tool 🔧`, `guardrail 🛡`) with durations and guardrail verdicts
  - **Working Memory** — live session state (identity, pending action, rate caps, escalation)
  - **Audit** — redacted audit records for sensitive actions (refunds, subscription changes)
