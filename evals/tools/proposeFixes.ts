#!/usr/bin/env tsx
/**
 * proposeFixes.ts — Stage 4 of the eval-driven improvement loop.
 *
 * Reads triage.json and emits a human-readable FIXES.md with one section per
 * cluster. Safety-gate clusters are annotated "REQUIRES HUMAN SIGN-OFF —
 * tighten only" and the tool refuses to suggest edits that would loosen a
 * protected surface.
 *
 * Usage: tsx evals/tools/proposeFixes.ts
 * Invoked via: npm run eval:triage  (chained after triage.ts)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_MAP } from "./surfaceMap.js";
import type { TriageReport, TriageCluster, Polarity } from "./triage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "../..");
const reportsDir = join(rootDir, "evals", "reports");
const triageFile = join(reportsDir, "triage.json");
const fixesFile = join(reportsDir, "FIXES.md");

if (!existsSync(triageFile)) {
  console.error("[eval:propose] triage.json not found — run eval:triage first");
  process.exit(1);
}

const triage: TriageReport = JSON.parse(readFileSync(triageFile, "utf-8"));

// ── Proposal helpers ──────────────────────────────────────────────────────────

function polarityLabel(p: Polarity): string {
  switch (p) {
    case "unsafe-pass":  return "🔴 **unsafe-pass** (should have been blocked)";
    case "false-block":  return "🟡 **false-block** (should have been allowed)";
    case "quality-miss": return "🔵 **quality-miss** (classification / scoring error)";
  }
}

/** Returns true if the proposed edit text contains a pattern that would loosen the surface. */
function wouldLoosenSurface(suiteLetter: string, editText: string): boolean {
  const entry = SURFACE_MAP[suiteLetter];
  if (!entry?.looseningPatterns) return false;
  return entry.looseningPatterns.some((re) => re.test(editText));
}

function buildHypothesis(cluster: TriageCluster): string {
  const { polarity, suiteLetter } = cluster;
  switch (polarity) {
    case "unsafe-pass":
      return `The ${suiteLetter} surface is not catching a new variant. ` +
        `The blocking condition needs to be extended (add a new rule/pattern).`;
    case "false-block":
      return `The ${suiteLetter} surface is too broad — it is catching benign inputs. ` +
        (cluster.safetyGate
          ? `Because this is a safety-gate suite, ONLY removing the over-broad pattern ` +
            `while retaining or tightening other rules is safe. Human sign-off required.`
          : `The classifier or regex can be narrowed for this case.`);
    case "quality-miss":
      return `The ${suiteLetter} surface produces incorrect output (wrong classification, ` +
        `wrong score, etc.). Root cause is likely in the prompt or keyword list.`;
  }
}

function buildCandidateEdit(cluster: TriageCluster): string {
  const { polarity, suiteLetter, safetyGate } = cluster;

  if (safetyGate) {
    if (polarity === "unsafe-pass") {
      return `Add a new entry to the relevant pattern list (e.g. INJECTION_PATTERNS, ` +
        `policy engine rules, or error-handling block) that captures the failing variant. ` +
        `**Do not remove or relax any existing rule.**`;
    }
    if (polarity === "false-block") {
      return `⚠️ SAFETY GATE — false-block on a safety surface is unusual. ` +
        `Before narrowing any pattern, confirm it is genuinely over-blocking a benign case ` +
        `and that the narrowed version still blocks all malicious variants. ` +
        `Submit a PR with both the narrowed pattern AND a new test proving the malicious ` +
        `variant is still blocked.`;
    }
  }

  // Free surfaces
  switch (polarity) {
    case "unsafe-pass":
      return `Extend the relevant list in src/ to capture the failing variant. ` +
        `If the surface is src/prompts.ts, add a more explicit instruction. ` +
        `If the surface is a keyword list or regex, add the new pattern.`;
    case "false-block":
      return `Narrow the keyword/regex in src/guardrails/input.ts (e.g. SENSITIVE_KEYWORDS ` +
        `or INJECTION_PATTERNS) to exclude the benign variant. ` +
        `Or, if the surface is src/prompts.ts, add a clarifying instruction ` +
        `that distinguishes this input.`;
    case "quality-miss":
      if (suiteLetter === "B") {
        return `In src/guardrails/input.ts, consider making classifyIntent() context-aware — ` +
          `e.g. detect the question form (starts with "what", "how", "why") to route ` +
          `purely-informational questions even when they contain sensitive keywords.`;
      }
      return `Review src/prompts.ts SYSTEM_PROMPT for the principle governing this behavior. ` +
        `If the model is producing wrong output, tighten the instruction. ` +
        `If it's a classifier error, fix the relevant list in src/guardrails/.`;
  }
}

function buildSafetyCheck(cluster: TriageCluster): string {
  if (cluster.safetyGate) {
    return (
      `1. Re-run \`npm run eval:loop\` — all safety-gate suites (D/E/F/G/I/K) must remain at 100%.\n` +
      `2. Run \`npm run eval:report:live\` if the fix touches injection/policy logic — confirm live behavior unchanged.\n` +
      `3. The new pattern/rule must not break any currently-passing test.`
    );
  }
  return (
    `1. Run \`npm run eval:loop\` — confirm this cluster's cases now pass.\n` +
    `2. Check that no currently-passing tests in the same suite regressed.\n` +
    `3. Run \`npm run eval:verify\` to confirm no overall regressions.`
  );
}

// ── Render FIXES.md ───────────────────────────────────────────────────────────

const lines: string[] = [
  `# Eval Fix Proposals`,
  ``,
  `> Generated: ${triage.generatedAt}  `,
  `> Run mode: \`${triage.runMode}\`  `,
  `> Total failures: ${triage.totalFailures}  `,
  `> Clusters: ${triage.clusters.length}`,
  ``,
  `---`,
  ``,
  `## How to use this file`,
  ``,
  `1. Read each cluster section below.`,
  `2. ✅ FREE TO APPLY — apply the candidate edit to \`src/\` yourself (prompts, config, keyword lists).`,
  `3. ⚠️ REQUIRES HUMAN SIGN-OFF — only make edits that *tighten* the safety surface. Never loosen.`,
  `4. After applying, run \`npm run eval:verify\` to confirm no regression.`,
  ``,
  `---`,
  ``,
];

if (triage.clusters.length === 0) {
  lines.push(`## No failures — all gates green ✅`);
  lines.push(``);
  lines.push(`Nothing to fix. Run \`npm run eval:report\` again after your next change.`);
} else {
  for (const cluster of triage.clusters) {
    const gateTag = cluster.safetyGate
      ? `\n> ⚠️ **REQUIRES HUMAN SIGN-OFF — tighten only.** This is a zero-tolerance safety gate. Edits must make it stricter, never more permissive.`
      : `\n> ✅ **FREE TO APPLY** — prompt/config/keyword-list changes; no safety-gate impact.`;

    const candidateEdit = buildCandidateEdit(cluster);

    // Guard: refuse to emit loosening advice for safety surfaces
    if (cluster.safetyGate && wouldLoosenSurface(cluster.suiteLetter, candidateEdit)) {
      lines.push(`## [${cluster.suiteLetter}] ${cluster.description} — ${polarityLabel(cluster.polarity)}`);
      lines.push(gateTag);
      lines.push(``);
      lines.push(`**⛔ Proposed edit refused:** the auto-generated edit for this cluster would loosen a safety surface.`);
      lines.push(`A human must inspect these ${cluster.cases.length} case(s) directly and propose a tightening fix.`);
      lines.push(``);
    } else {
      lines.push(`## [${cluster.suiteLetter}] ${cluster.description} — ${polarityLabel(cluster.polarity)}`);
      lines.push(gateTag);
      lines.push(``);
      lines.push(`**Affected tests (${cluster.cases.length}):**`);
      for (const c of cluster.cases) {
        lines.push(`- \`${c.fullName}\``);
      }
      lines.push(``);
      lines.push(`**Hypothesis:** ${buildHypothesis(cluster)}`);
      lines.push(``);
      lines.push(`**Target surface:**`);
      for (const s of cluster.primarySurfaces) {
        lines.push(`- \`${s}\``);
      }
      lines.push(``);
      lines.push(`**Candidate edit:**`);
      lines.push(candidateEdit);
      lines.push(``);
      lines.push(`**Safety check:**`);
      lines.push(buildSafetyCheck(cluster));
      lines.push(``);
    }

    // Evidence from live traces (if any)
    if (cluster.evidence.length > 0) {
      lines.push(`**Live trace evidence:**`);
      for (const ev of cluster.evidence) {
        lines.push(`- Conversation \`${ev.conversationId}\``);
        const guardSpans = ev.spans.filter((s) => s.type === "guardrail");
        if (guardSpans.length > 0) {
          lines.push(`  - Guardrail spans: ${guardSpans.map((s) => `\`${s.name}\``).join(", ")}`);
        }
        if (ev.auditRecords.length > 0) {
          lines.push(`  - Audit actions: ${ev.auditRecords.map((a) => `\`${a.action}\``).join(", ")}`);
        }
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
  }
}

writeFileSync(fixesFile, lines.join("\n"));

console.log("\n── eval:propose summary ─────────────────────────────────");
console.log(`  Clusters: ${triage.clusters.length}`);
for (const c of triage.clusters) {
  const tag = c.safetyGate ? " [SIGN-OFF REQUIRED]" : " [free-to-apply]";
  console.log(`    [${c.suiteLetter}] ${c.polarity} — ${c.cases.length} case(s)${tag}`);
}
console.log(`  Output:   ${fixesFile}`);
console.log("─────────────────────────────────────────────────────────\n");
