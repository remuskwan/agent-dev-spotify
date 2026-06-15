#!/usr/bin/env tsx
/**
 * triage.ts — Stage 2-3 of the eval-driven improvement loop.
 *
 * Reads latest.failures.json, buckets each failure by behavior surface,
 * classifies its polarity, and (for live failures) correlates with trace/audit
 * JSONL files produced by src/observability/.
 *
 * Emits: evals/reports/triage.json
 *
 * Usage: tsx evals/tools/triage.ts
 * Invoked via: npm run eval:triage
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_MAP, SAFETY_GATES, type SurfaceEntry } from "./surfaceMap.js";
import type { ReportOutput, FailureEntry } from "./runReport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "../..");
const reportsDir = join(rootDir, "evals", "reports");
const failuresFile = join(reportsDir, "latest.failures.json");

if (!existsSync(failuresFile)) {
  console.error("[eval:triage] latest.failures.json not found — run eval:report first");
  process.exit(1);
}

const report: ReportOutput = JSON.parse(readFileSync(failuresFile, "utf-8"));

// ── Polarity detection ────────────────────────────────────────────────────────

/**
 * unsafe-pass  — should have been blocked but wasn't.  P0 on safety-gate suites.
 * false-block  — should have been allowed but was blocked.
 * quality-miss — classification or scoring error (neither block nor allow polarity).
 */
export type Polarity = "unsafe-pass" | "false-block" | "quality-miss";

function classifyPolarity(failure: FailureEntry, surface: SurfaceEntry): Polarity {
  const msgs = failure.failureMessages.join(" ");
  const title = failure.fullName.toLowerCase();

  // "must block" custom messages → should have been blocked → unsafe-pass
  if (/must block/i.test(msgs)) return "unsafe-pass";

  // "should not block" custom messages → was blocked when it shouldn't → false-block
  if (/should not block/i.test(msgs)) return "false-block";

  // Polarity clues from assertion text (blocked=false when expected true, etc.)
  if (/expected false to be true/i.test(msgs) && surface.safetyGate) return "unsafe-pass";
  if (/expected true to be false/i.test(msgs)) return "false-block";

  // Classification errors
  if (/should be info/i.test(msgs)) return "quality-miss";
  if (/should be sensitive/i.test(msgs)) return "quality-miss";

  // Fall back: safety-gate suites with unexpected pass → unsafe-pass
  if (surface.safetyGate && /expected false to be true/i.test(msgs)) return "unsafe-pass";

  // Default
  return "quality-miss";
}

// ── Live trace correlation ────────────────────────────────────────────────────

interface TraceSpan {
  conversationId: string;
  name: string;
  type: string;
  durationMs: number;
  attributes: Record<string, unknown>;
}

interface AuditRec {
  action: string;
  policyVerdict: Record<string, unknown> | null;
  outcome: string;
}

function isLiveFailure(failure: FailureEntry): boolean {
  return (
    failure.suiteLetter === "J" ||
    /live.*eval|live:/i.test(failure.fullName)
  );
}

function loadLiveEvidence(startTime: string): Record<string, { spans: TraceSpan[]; audit: AuditRec[] }> {
  const tracesDir = process.env["TRACES_DIR"] ?? join(rootDir, "traces");
  const auditDir = process.env["AUDIT_DIR"] ?? join(rootDir, "audit");
  const cutoffMs = new Date(startTime).getTime();
  const evidence: Record<string, { spans: TraceSpan[]; audit: AuditRec[] }> = {};

  for (const dir of [tracesDir, auditDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      if (!file.startsWith("live-eval-")) continue;
      const filePath = join(dir, file);
      const mtime = statSync(filePath).mtimeMs;
      if (mtime < cutoffMs) continue;

      const convId = file.replace(".jsonl", "");
      if (!evidence[convId]) evidence[convId] = { spans: [], audit: [] };

      const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (dir === tracesDir) {
            evidence[convId].spans.push(parsed as unknown as TraceSpan);
          } else {
            evidence[convId].audit.push(parsed as unknown as AuditRec);
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
  return evidence;
}

// ── Cluster building ──────────────────────────────────────────────────────────

export interface TriageCluster {
  surface: string;
  suiteLetter: string;
  suiteName: string;
  description: string;
  safetyGate: boolean;
  polarity: Polarity;
  primarySurfaces: string[];
  cases: Array<{
    fullName: string;
    title: string;
    failureMessages: string[];
  }>;
  evidence: Array<{
    conversationId: string;
    spans: TraceSpan[];
    auditRecords: AuditRec[];
  }>;
}

export interface TriageReport {
  generatedAt: string;
  runMode: "live" | "mock";
  totalFailures: number;
  clusters: TriageCluster[];
}

const liveEvidence =
  report.runMode === "live" ? loadLiveEvidence(report.startTime) : {};

// Key by (suiteLetter, polarity) for clustering
const clusterMap = new Map<string, TriageCluster>();

for (const failure of report.failures) {
  const surfaceEntry: SurfaceEntry =
    SURFACE_MAP[failure.suiteLetter] ?? {
      suiteId: failure.suiteLetter,
      suiteName: failure.suite,
      description: failure.suite,
      primarySurfaces: ["(unknown — suite not in surfaceMap)"],
      safetyGate: false,
    };

  const polarity = classifyPolarity(failure, surfaceEntry);
  const clusterKey = `${failure.suiteLetter}:${polarity}`;

  if (!clusterMap.has(clusterKey)) {
    clusterMap.set(clusterKey, {
      surface: surfaceEntry.description,
      suiteLetter: failure.suiteLetter,
      suiteName: failure.suite,
      description: surfaceEntry.description,
      safetyGate: SAFETY_GATES.has(failure.suiteLetter),
      polarity,
      primarySurfaces: surfaceEntry.primarySurfaces,
      cases: [],
      evidence: [],
    });
  }

  const cluster = clusterMap.get(clusterKey)!;
  cluster.cases.push({
    fullName: failure.fullName,
    title: failure.title,
    failureMessages: failure.failureMessages,
  });

  // Attach trace evidence for live failures
  if (isLiveFailure(failure)) {
    for (const [convId, ev] of Object.entries(liveEvidence)) {
      const alreadyAttached = cluster.evidence.some((e) => e.conversationId === convId);
      if (!alreadyAttached) {
        cluster.evidence.push({
          conversationId: convId,
          spans: ev.spans,
          auditRecords: ev.audit,
        });
      }
    }
  }
}

// Sort: safety-gate clusters first, then by suite letter
const clusters = [...clusterMap.values()].sort((a, b) => {
  if (a.safetyGate !== b.safetyGate) return a.safetyGate ? -1 : 1;
  return a.suiteLetter.localeCompare(b.suiteLetter);
});

const triageReport: TriageReport = {
  generatedAt: new Date().toISOString(),
  runMode: report.runMode,
  totalFailures: report.failures.length,
  clusters,
};

const triageFile = join(reportsDir, "triage.json");
writeFileSync(triageFile, JSON.stringify(triageReport, null, 2));

console.log("\n── eval:triage summary ──────────────────────────────────");
console.log(`  Failures:  ${report.failures.length}`);
console.log(`  Clusters:  ${clusters.length}`);
if (clusters.length > 0) {
  for (const c of clusters) {
    const tag = c.safetyGate ? " [SAFETY GATE P0]" : "";
    console.log(`    [${c.suiteLetter}] ${c.polarity} — ${c.cases.length} case(s)${tag}`);
  }
}
console.log(`  Output:    ${triageFile}`);
console.log("─────────────────────────────────────────────────────────\n");
