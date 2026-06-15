#!/usr/bin/env tsx
/**
 * runReport.ts — Stage 1 of the eval-driven improvement loop.
 *
 * Runs the Vitest eval suite and produces two artefacts:
 *   evals/reports/<ISO-timestamp>.json  — raw Vitest JSON reporter output
 *   evals/reports/latest.failures.json — normalized failure list + run metadata
 *
 * Usage:
 *   tsx evals/tools/runReport.ts           # mock LLM (CI-safe)
 *   tsx evals/tools/runReport.ts --live    # EVAL_MODE=live (needs OPENAI_API_KEY)
 *
 * Invoked via npm scripts:
 *   npm run eval:report
 *   npm run eval:report:live
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { suiteLetterFromFile } from "./surfaceMap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "../..");
const reportsDir = join(rootDir, "evals", "reports");

const isLive = process.argv.includes("--live");
const runMode: "live" | "mock" = isLive ? "live" : "mock";
const startTime = new Date().toISOString();
const timestamp = startTime.replace(/[:.]/g, "-");
const rawFile = join(reportsDir, `${timestamp}.json`);
const failuresFile = join(reportsDir, "latest.failures.json");

mkdirSync(reportsDir, { recursive: true });

const vitestBin = join(rootDir, "node_modules", ".bin", "vitest");

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

const result = spawnSync(vitestBin, args, {
  cwd: rootDir,
  env,
  stdio: "inherit",
  encoding: "utf-8",
});

if (!existsSync(rawFile)) {
  console.error(`\n[eval:report] vitest did not produce output at ${rawFile}`);
  process.exit(1);
}

// ── Parse and normalize ───────────────────────────────────────────────────────

interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  title: string;
  duration?: number;
  failureMessages: string[];
}

interface VitestTestFile {
  name: string;
  assertionResults: VitestAssertionResult[];
  status: string;
}

interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: VitestTestFile[];
}

const raw: VitestJson = JSON.parse(readFileSync(rawFile, "utf-8"));

export interface FailureEntry {
  suite: string;
  suiteLetter: string;
  testFilePath: string;
  fullName: string;
  title: string;
  ancestorTitles: string[];
  failureMessages: string[];
}

export interface ReportOutput {
  startTime: string;
  runMode: "live" | "mock";
  totalTests: number;
  passedTests: number;
  failedTests: number;
  failures: FailureEntry[];
}

const failures: FailureEntry[] = [];

for (const testFile of raw.testResults ?? []) {
  const filePath: string = testFile.name;
  const fileBasename = basename(filePath);
  const suiteLetter = suiteLetterFromFile(fileBasename);
  const suiteName = fileBasename.replace(/\.test\.ts$/, "");

  for (const assertion of testFile.assertionResults ?? []) {
    if (assertion.status === "failed") {
      failures.push({
        suite: suiteName,
        suiteLetter,
        testFilePath: filePath,
        fullName: assertion.fullName,
        title: assertion.title,
        ancestorTitles: assertion.ancestorTitles,
        failureMessages: assertion.failureMessages,
      });
    }
  }
}

const output: ReportOutput = {
  startTime,
  runMode,
  totalTests: raw.numTotalTests,
  passedTests: raw.numPassedTests,
  failedTests: failures.length,
  failures,
};

writeFileSync(failuresFile, JSON.stringify(output, null, 2));

console.log("\n── eval:report summary ──────────────────────────────────");
console.log(`  Raw JSON:  ${rawFile}`);
console.log(`  Failures:  ${failuresFile}`);
console.log(`  Mode:      ${runMode}`);
console.log(`  Results:   ${raw.numPassedTests} passed / ${failures.length} failed / ${raw.numPendingTests} skipped`);
if (failures.length > 0) {
  console.log(`\n  Failed tests:`);
  for (const f of failures) {
    console.log(`    [${f.suiteLetter}] ${f.fullName}`);
  }
}
console.log("─────────────────────────────────────────────────────────\n");

// Exit 0 always — failures are data for the loop, not a CI error.
// Use eval:verify for CI gating.
process.exit(result.status === 0 ? 0 : 0);
