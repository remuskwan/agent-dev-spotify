#!/usr/bin/env tsx
/**
 * verify.ts — Stage 5 of the eval-driven improvement loop.
 *
 * Saves the current latest.failures.json as a pre-fix baseline, re-runs the
 * eval suite, then asserts:
 *   1. No new failures vs. the pre-fix baseline (regression check).
 *   2. All safety-gate suites (D/E/F/G/I/K) have 0 failures.
 *   3. Quality-bar suites (A≥0.95, B≥0.90, H≥0.90) remain at or above their bars.
 *
 * Exits non-zero on any violation so it can gate CI.
 *
 * Usage: tsx evals/tools/verify.ts [--live]
 * Invoked via: npm run eval:verify
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SAFETY_GATES, QUALITY_BARS, SURFACE_MAP, suiteLetterFromFile } from "./surfaceMap.js";
import { basename } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "../..");
const reportsDir = join(rootDir, "evals", "reports");
const failuresFile = join(reportsDir, "latest.failures.json");
const preFixFile = join(reportsDir, "pre-fix.failures.json");

mkdirSync(reportsDir, { recursive: true });

const isLive = process.argv.includes("--live");

// ── Step 1: Save pre-fix baseline ────────────────────────────────────────────

if (existsSync(failuresFile)) {
  copyFileSync(failuresFile, preFixFile);
  console.log(`[eval:verify] Saved baseline → ${preFixFile}`);
} else {
  console.log(`[eval:verify] No pre-fix baseline found — treating as empty baseline`);
}

// ── Step 2: Re-run eval suite ─────────────────────────────────────────────────

const vitestBin = join(rootDir, "node_modules", ".bin", "vitest");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const rawFile = join(reportsDir, `verify-${timestamp}.json`);

const args = [
  "run",
  "--config", join(rootDir, "evals", "vitest.config.ts"),
  "--reporter=verbose",
  "--reporter=json",
  `--outputFile.json=${rawFile}`,
];

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  ...(isLive ? { EVAL_MODE: "live" } : {}),
};

console.log(`[eval:verify] Re-running eval suite (${isLive ? "live" : "mock"} mode)…\n`);
spawnSync(vitestBin, args, { cwd: rootDir, env, stdio: "inherit", encoding: "utf-8" });

if (!existsSync(rawFile)) {
  console.error("[eval:verify] vitest did not produce output — aborting");
  process.exit(1);
}

// ── Step 3: Parse fresh results ───────────────────────────────────────────────

interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  title: string;
  failureMessages: string[];
}

interface VitestTestFile {
  name: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: VitestTestFile[];
}

const raw: VitestJson = JSON.parse(readFileSync(rawFile, "utf-8"));

interface FailureSummary {
  suiteLetter: string;
  fullName: string;
  failureMessages: string[];
}

const freshFailures: FailureSummary[] = [];
const passedBySuite: Record<string, number> = {};
const totalBySuite: Record<string, number> = {};

for (const testFile of raw.testResults ?? []) {
  const fileBasename = basename(testFile.name);
  const letter = suiteLetterFromFile(fileBasename);

  for (const a of testFile.assertionResults ?? []) {
    if (a.status === "skipped" || a.status === "pending" || a.status === "todo") continue;
    totalBySuite[letter] = (totalBySuite[letter] ?? 0) + 1;
    if (a.status === "passed") {
      passedBySuite[letter] = (passedBySuite[letter] ?? 0) + 1;
    } else if (a.status === "failed") {
      freshFailures.push({ suiteLetter: letter, fullName: a.fullName, failureMessages: a.failureMessages });
    }
  }
}

// Update latest.failures.json with the fresh run
const freshOutput = {
  startTime: new Date().toISOString(),
  runMode: isLive ? "live" : "mock",
  totalTests: raw.numTotalTests,
  passedTests: raw.numPassedTests,
  failedTests: freshFailures.length,
  failures: freshFailures.map((f) => ({
    suite: SURFACE_MAP[f.suiteLetter]?.suiteName ?? f.suiteLetter,
    suiteLetter: f.suiteLetter,
    testFilePath: "",
    fullName: f.fullName,
    title: f.fullName.split(" > ").at(-1) ?? f.fullName,
    ancestorTitles: [],
    failureMessages: f.failureMessages,
  })),
};
writeFileSync(failuresFile, JSON.stringify(freshOutput, null, 2));

// ── Step 4: Regression check ──────────────────────────────────────────────────

interface PreFixReport {
  failures: Array<{ fullName: string }>;
}

const baseline: Set<string> = new Set();
if (existsSync(preFixFile)) {
  const pre: PreFixReport = JSON.parse(readFileSync(preFixFile, "utf-8"));
  for (const f of pre.failures ?? []) baseline.add(f.fullName);
}

const regressions = freshFailures.filter((f) => !baseline.has(f.fullName));

// ── Step 5: Safety-gate check ─────────────────────────────────────────────────

const gateViolations: string[] = [];
for (const letter of SAFETY_GATES) {
  const failures = freshFailures.filter((f) => f.suiteLetter === letter);
  if (failures.length > 0) {
    gateViolations.push(`[${letter}] ${failures.length} failure(s) — zero-tolerance gate violated`);
  }
}

// ── Step 6: Quality-bar check ─────────────────────────────────────────────────

const barViolations: string[] = [];
for (const [letter, bar] of Object.entries(QUALITY_BARS)) {
  const total = totalBySuite[letter] ?? 0;
  const passed = passedBySuite[letter] ?? 0;
  if (total === 0) continue;
  const rate = passed / total;
  if (rate < bar.threshold) {
    barViolations.push(
      `[${letter}] ${bar.metric} ${(rate * 100).toFixed(1)}% < required ${(bar.threshold * 100).toFixed(0)}%`
    );
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log("\n── eval:verify report ───────────────────────────────────");
console.log(`  Fresh:      ${raw.numPassedTests} passed / ${freshFailures.length} failed`);
console.log(`  Regressions:    ${regressions.length}`);
console.log(`  Gate violations: ${gateViolations.length}`);
console.log(`  Bar violations:  ${barViolations.length}`);

let allGreen = true;

if (regressions.length > 0) {
  allGreen = false;
  console.log(`\n  ❌ REGRESSIONS (new failures not in baseline):`);
  for (const r of regressions) {
    console.log(`    [${r.suiteLetter}] ${r.fullName}`);
  }
}

if (gateViolations.length > 0) {
  allGreen = false;
  console.log(`\n  ❌ SAFETY GATE VIOLATIONS:`);
  for (const v of gateViolations) console.log(`    ${v}`);
}

if (barViolations.length > 0) {
  allGreen = false;
  console.log(`\n  ❌ QUALITY BAR VIOLATIONS:`);
  for (const v of barViolations) console.log(`    ${v}`);
}

if (allGreen) {
  console.log(`\n  ✅ All gates green — no regressions, safety gates held, quality bars met.`);
} else {
  console.log(`\n  Fix the violations above and re-run \`npm run eval:verify\`.`);
}

console.log("─────────────────────────────────────────────────────────\n");

process.exit(allGreen ? 0 : 1);
