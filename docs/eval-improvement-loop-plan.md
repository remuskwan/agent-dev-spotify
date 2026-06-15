# Eval-Driven Improvement Loop for Streamify

> **Status:** Plan (approved for execution). This document is the implementation
> spec — the loop tooling described here is **not yet built**. Execution to be
> carried out as a follow-up.

## Context

Streamify is a safety-critical customer-support agent. It already has a strong
8-suite Vitest eval harness (`evals/suites/a..h`), but there is **no tooling to
close the loop** from a failed eval back to a fix (confirmed: no
auto-improve/reflection code exists). Today `npm test` (mock LLM) passes 108/108
deterministically, so the only places real failures surface are `npm run
eval:live` (real LLM, 3 live tests today) and any newly added harder cases.

The goal is a repeatable, **guarded-hybrid** loop: tooling auto-runs evals,
triages the FAILED cases, correlates them with traces/audit, and drafts
candidate fixes pointed at the correct behavior surface — but a human reviews and
applies edits. Safety gates (suites D/E/F/G + A's groundedness bar) may only get
**stricter**, never auto-loosened. This matches DESIGN.md §3.3/§7 (golden set in
CI, zero-tolerance on guardrail/adversarial/policy/fail-safe, ≥0.95 grounded).

Decisions locked:
- **Automation:** guarded hybrid (auto-run + triage + draft fixes; human applies).
- **Failure source:** live LLM evals **and** an expanded golden set.
- **Deliverable:** runnable tooling + docs.
- **Edit scope:** prompts.ts + config.ts freely; guardrail/policy edits only if
  they tighten safety, with explicit human sign-off.

## The Loop (5 stages)

```
        ┌──────────────────────────────────────────────────┐
        │  0. EXPAND golden set (feeder, run as needed)     │
        └──────────────────────────────────────────────────┘
                              │
   1. RUN ──► 2. TRIAGE ──► 3. DIAGNOSE ──► 4. PROPOSE ──► 5. VERIFY
   (json)    (bucket by    (correlate     (draft edits    (re-run; gates
              suite +       live fails     to surface;     stay green,
              polarity)     w/ traces)     gated safety)   safety = 100%)
                                                │
                                                └─ human applies + re-runs
```

## What gets built

All new tooling lives under `evals/tools/` (TS, run via `tsx`, no new deps —
`tsx`/`vitest` already present). Reports land in `evals/reports/` (gitignorable).

### 1. Eval runner with machine-readable output — `evals/tools/runReport.ts`
- Wraps `vitest run --config evals/vitest.config.ts --reporter=json` (Vitest
  already supports the JSON reporter; no harness change needed).
- Mock mode by default; `--live` sets `EVAL_MODE=live` to exercise the real LLM
  and the `it.skipIf(!isLive)` live tests (e.g. `h-tone-safety.test.ts:94`).
- Writes the raw JSON to `evals/reports/<ISO-timestamp>.json` and a normalized
  `evals/reports/latest.failures.json`: one entry per failed `assertionResult`
  with `{ suite, fullName, title, failureMessages, ancestorTitles }`.
- New scripts in `package.json`: `eval:report`, `eval:report:live`.

### 2. Surface map + safety-gate registry — `evals/tools/surfaceMap.ts`
Single source of truth mapping each suite letter → its primary edit surface(s)
and whether it is a safety gate. Derived from exploration of the codebase:

| Suite | Tests | Primary fix surface | Safety gate? |
|-------|-------|---------------------|--------------|
| A grounded-qa | groundedness ≥0.95 | `prompts.ts` (ground-or-abstain) + `guardrails/output.ts` grounding rules (gated) | **bar ≥0.95** |
| B intent-routing | ≥0.90 | `guardrails/input.ts` SENSITIVE_KEYWORDS / `classifyIntent`; `llm.ts` routeModel | no |
| C sensitive-happy-path | state machine | `prompts.ts` confirm-flow; `agentLoop.ts` AFFIRMATION/NEGATION regex (`:15-16`) | no |
| D guardrail-conformance | 100% | `guardrails/action.ts` pipeline | **YES** |
| E policy-adherence | 0 violations | `guardrails/action.ts` policy engine; `config.ts` caps | **YES** |
| F adversarial | 100% block | `guardrails/input.ts` injection patterns; `guardrails/output.ts` | **YES** |
| G failsafe | 100% fail-closed | `agentLoop.ts` error handling / fail-closed paths | **YES** |
| H tone-safety | ≥0.90 | `prompts.ts` persona (free); `guardrails/output.ts` no-promise (gated) | no |

The registry exports `SAFETY_GATES = {D,E,F,G}` and the quality bars (A≥0.95,
B≥0.90, H≥0.90) so stage 5 can assert the right thresholds.

### 3. Triage + diagnosis — `evals/tools/triage.ts`
- Reads `latest.failures.json`, buckets each failure by suite via `surfaceMap`.
- Classifies **failure polarity** from the assertion's custom message (the suites
  already encode intent in messages like `"should not block: ..."` —
  e.g. `b-intent-routing` and `h-tone-safety:88`):
  - `unsafe-pass` — should-block-but-didn't (any safety-gate suite failing here is P0).
  - `false-block` — should-allow-but-blocked (over-strict; common in B/H).
  - `quality-miss` — groundedness/tone/routing score below bar (A/B/H).
- **Live correlation:** for live failures, glob `traces/<conversationId>.jsonl`
  and `audit/<conversationId>.jsonl` (live tests build ids like
  `"live-eval-h-"+Date.now()`, written by `src/observability/tracer.ts` /
  `auditLog.ts`) and attach the relevant `llm`/`tool`/`guardrail` spans +
  policy verdicts so the root cause is visible (which guardrail fired, what the
  model emitted, whether output guardrail blocked).
- Emits `evals/reports/triage.json`: clusters of `{ surface, polarity,
  safetyGate, cases[], evidence[] }`.

### 4. Fix proposal — `evals/tools/proposeFixes.ts`
- Turns each triage cluster into a human-readable `evals/reports/FIXES.md`
  section: **hypothesis → target surface (file:line) → candidate edit → safety
  check**.
- **Guard rail on the loop itself:** if a cluster's surface is a safety gate,
  the proposal is annotated `REQUIRES HUMAN SIGN-OFF — tighten only` and the tool
  refuses to suggest any edit that would *loosen* a check (e.g. removing a keyword
  from `SENSITIVE_KEYWORDS`, widening `VALID_PLAN_TRANSITIONS`, or raising
  `REFUND_CAP_USD`). Prompt/persona/routing clusters are marked free-to-apply.
- This file is the loop's primary artifact; the human applies the edits.

### 5. Verify gate — `evals/tools/verify.ts` + `eval:loop` script
- Re-runs `eval:report` (and `eval:report:live` when live failures were in play),
  then asserts: all safety-gate suites at 100%, A/B/H at their bars, and **no new
  failures vs. the pre-fix `latest.failures.json`** (regression diff).
- Non-zero exit on regression so it can sit in CI. `package.json` `eval:loop`
  chains run → triage → propose for one command.

### 0. Golden-set expansion (feeder) — convention + seed cases
- Document the case-authoring convention in the playbook (inline arrays for
  classifier/guardrail suites; `makeHarness` + `programLLM` for E2E; `it.skipIf
  (!isLive)` for judged live cases) — mirrors existing `evals/suites/*`.
- Seed a first batch of harder cases to create a real failure surface, added
  **directly into the existing suite files** (keeps one runner): e.g. ambiguous
  intents and false-block probes in B/H, new injection variants in F, a
  multi-refund-attempt scenario in E, a tool-timeout path in G. New fixtures go
  in `evals/fixtures/accounts.ts` (pattern already there: `HIGH_CHARGE_ACCOUNT`).

### Docs — `evals/LOOP.md`
Playbook: the 5 stages, the surface map, the safety-gate "tighten-only" rule, how
to read `FIXES.md`, and the case-authoring conventions. Cross-links DESIGN.md §7.

## Critical files

- **New:** `evals/tools/{runReport,surfaceMap,triage,proposeFixes,verify}.ts`,
  `evals/LOOP.md`, `evals/reports/` (output dir, git-ignored).
- **Edited:** `package.json` (scripts `eval:report`, `eval:report:live`,
  `eval:triage`, `eval:loop`); `evals/suites/*.test.ts` + `evals/fixtures/accounts.ts`
  (seed harder cases).
- **Touched only when applying fixes (later iterations, not loop infra):**
  `src/prompts.ts`, `src/config.ts` (free); `src/guardrails/{input,action,output}.ts`,
  `src/agentLoop.ts`, `src/llm.ts` (gated, tighten-only).
- **Read-only inputs to the loop:** `traces/*.jsonl`, `audit/*.jsonl`,
  `src/observability/{tracer,auditLog}.ts`.

## Reuse (don't rebuild)

- Vitest's built-in `--reporter=json` — no custom reporter needed.
- `evals/helpers/{agentHarness,mockLlm,nullTracer,nullAuditLog}.ts` — new E2E
  golden cases use `makeHarness` + `programLLM` exactly as existing suites do.
- The inline assertion custom-messages already encode expected behavior — triage
  parses them rather than re-specifying intent.
- `src/observability/tracer.ts` / `auditLog.ts` JSONL output is the live
  diagnosis substrate; the loop reads it, doesn't duplicate it.

## Verification

1. `npm run eval:report` → confirm `evals/reports/latest.failures.json` is
   written and empty (108/108 mock pass today).
2. Add 2–3 deliberately failing seed cases (one safety-gate, one false-block,
   one quality) → `npm run eval:loop` → confirm `triage.json` buckets them by
   correct surface + polarity and `FIXES.md` marks the safety-gate one
   "tighten-only / sign-off".
3. `npm run eval:report:live` → confirm a live failure (if any) is correlated
   with its `traces/<id>.jsonl` spans in the triage output.
4. Apply one *free-surface* fix (a `prompts.ts` or `config.ts` tweak) by hand →
   `npm run eval:loop` → `verify.ts` shows the case resolved and reports **no
   regression**; safety gates still 100%.
5. `npm run typecheck` stays green.
