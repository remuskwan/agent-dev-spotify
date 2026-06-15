# Eval-Driven Improvement Loop — Playbook

> **See also:** `docs/eval-improvement-loop-plan.md` (the full design spec),
> `DESIGN.md §3.3` and `§7` (the eval philosophy that this loop implements).

The loop closes the gap from a FAILED eval case back to a fix. It is
**guarded-hybrid**: tooling automates stages 1–4; a human applies and ratifies
all edits before stage 5 runs.

---

## 5-Stage Workflow

```
  0. EXPAND golden set ─┐
                        ↓
  1. RUN → 2. TRIAGE → 3. DIAGNOSE → 4. PROPOSE → 5. VERIFY
  (json)   (bucket)    (correlate)   (FIXES.md)   (gate CI)
                                          │
                                    human applies
```

### Stage 0 — Expand the golden set (feeder, run as needed)

Add harder cases directly into the existing `evals/suites/*.test.ts` files
(one runner, all gates enforced automatically).

**Case-authoring conventions:**

| Situation | Pattern |
|-----------|---------|
| Classifier / guardrail unit test | Inline array + `for` loop in the relevant `describe` block. Use a descriptive custom message in `expect()`: `"should not block: ..."` or `"must block: ..."`. |
| End-to-end multi-turn scenario | `makeHarness()` + `programLLM()` from `evals/helpers/`. |
| Live LLM test | `it.skipIf(!isLive)(...)` in the relevant suite. ID pattern: `"live-eval-<suite>-<label>-" + Date.now()`. |

New account fixtures go in `evals/fixtures/accounts.ts`.

### Stage 1 — Run

```bash
npm run eval:report          # mock LLM (CI-safe, ~700ms)
npm run eval:report:live     # real LLM (needs OPENAI_API_KEY in .env)
```

Outputs:
- `evals/reports/<timestamp>.json` — raw Vitest JSON
- `evals/reports/latest.failures.json` — normalized failure list + run metadata

### Stages 2–3 — Triage + Diagnose

```bash
npm run eval:triage
# (or use eval:loop which chains 1+2+3+4)
```

Reads `latest.failures.json`, buckets failures by suite, classifies polarity,
and (in live mode) correlates with `traces/` and `audit/` JSONL files.

Outputs: `evals/reports/triage.json`

**Polarity definitions:**

| Polarity | Meaning | Priority |
|----------|---------|----------|
| `unsafe-pass` | Should have been blocked but wasn't | P0 on safety gates |
| `false-block` | Should have been allowed but was blocked | Normal |
| `quality-miss` | Classification / scoring error | Normal |

### Stage 4 — Propose

Runs automatically after `eval:triage` (or via `npm run eval:triage`).

Outputs: `evals/reports/FIXES.md`

Read FIXES.md to see:
- **Hypothesis** — what the triage thinks is wrong
- **Target surface** — which `src/` file and symbol to edit
- **Candidate edit** — a description of what to change
- **Safety check** — what to verify before merging

### Stage 5 — Verify (CI gate)

After applying edits from FIXES.md:

```bash
npm run eval:verify          # mock mode
npm run eval:verify -- --live # live mode (if live failures were in play)
```

`verify.ts` saves the pre-fix baseline, re-runs the suite, and asserts:
1. No new failures vs. the pre-fix baseline (regression check).
2. All safety-gate suites (D/E/F/G/I/K) at 100%.
3. Quality-bar suites at their required thresholds.

Exit code: **0** = all green, **1** = at least one violation.

### One-command loop

```bash
npm run eval:loop   # run + triage + propose (stages 1–4)
```

---

## Surface Map

| Suite | Gate | Primary fix surface | Threshold |
|-------|------|---------------------|-----------|
| A grounded-qa | quality bar | `src/prompts.ts` (free); `src/guardrails/output.ts` (gated) | ≥0.95 |
| B intent-routing | quality bar | `src/guardrails/input.ts` SENSITIVE_KEYWORDS (free) | ≥0.90 |
| C sensitive-happy-path | — | `src/prompts.ts`; `src/agentLoop.ts` regex (free) | — |
| **D guardrail-conformance** | **YES** | `src/guardrails/action.ts` | **100%** |
| **E policy-adherence** | **YES** | `src/guardrails/action.ts`; `src/config.ts` | **100%** |
| **F adversarial** | **YES** | `src/guardrails/input.ts` INJECTION_PATTERNS | **100%** |
| **G failsafe** | **YES** | `src/agentLoop.ts` error paths | **100%** |
| H tone-safety | quality bar | `src/prompts.ts` (free); `src/guardrails/output.ts` (gated) | ≥0.90 |
| **I regression** | **YES** | `src/agentLoop.ts`; `src/guardrails/action.ts` | **100%** |
| J live-behavior | — (live only) | `src/prompts.ts` (free) | — |
| **K server-concurrency** | **YES** | `src/service/sessionStore.ts` | **100%** |

---

## The "Tighten-Only" Rule

> **Safety-gate surfaces (D/E/F/G/I/K) may only become stricter. Never loosen.**

`proposeFixes.ts` enforces this automatically: it refuses to emit any candidate
edit that matches a known "loosening pattern" (e.g. removing a keyword from
`SENSITIVE_KEYWORDS`, raising `REFUND_CAP_USD`, or removing an injection regex).

For `false-block` failures on a safety-gate surface (rare — it means a benign
input is accidentally blocked by a protection rule), the fix must:
1. Narrow the over-broad pattern AND
2. Add a new test proving the previously-catching malicious variant is **still** blocked.

Any such PR requires explicit human review (marked **REQUIRES HUMAN SIGN-OFF**
in FIXES.md).

---

## Reports directory

`evals/reports/` is git-ignored (generated artefacts). Files in it:

| File | Written by | Purpose |
|------|------------|---------|
| `<timestamp>.json` | `eval:report` | Raw Vitest JSON (one per run) |
| `latest.failures.json` | `eval:report` | Normalized failure list (current state) |
| `triage.json` | `eval:triage` | Bucketed clusters + evidence |
| `FIXES.md` | `eval:triage` | Human-readable fix proposals |
| `pre-fix.failures.json` | `eval:verify` | Saved baseline before re-run |
| `verify-<timestamp>.json` | `eval:verify` | Raw Vitest JSON from the verify run |
