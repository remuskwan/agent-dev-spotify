/**
 * Suite J — Conversation Behavior (Live evals)
 *
 * LIVE ONLY — skipped in CI (npm test). Run with: npm run eval:live
 *
 * Exercises real model behavior for bugs that are only meaningful with a real LLM:
 *   J1: Agent does NOT re-initiate identity verification when already verified
 *   J2: Agent does NOT propose a refund from an ambiguous context statement
 *
 * These complement the deterministic code-guard tests in Suite I by confirming
 * the prompt hardening actually influences real model decisions.
 */

import { describe, it, expect } from "vitest";
import { AgentLoop } from "../../src/agentLoop.js";
import { ConversationHistory } from "../../src/memory/conversationHistory.js";
import { WorkingMemory } from "../../src/memory/workingMemory.js";
import { buildRegistry } from "../../src/tools/registry.js";
import { Tracer } from "../../src/observability/tracer.js";
import { AuditLog } from "../../src/observability/auditLog.js";

const isLive = process.env.EVAL_MODE === "live";

function makeLiveHarness(suffix: string) {
  const conversationId = `live-eval-j-${suffix}-${Date.now()}`;
  const wm = new WorkingMemory(conversationId, "user_live_001");
  const history = new ConversationHistory();
  const registry = buildRegistry();
  const tracer = new Tracer(conversationId);
  const auditLog = new AuditLog(conversationId);
  const loop = new AgentLoop(wm, registry, tracer, auditLog);
  return { loop, history, wm, auditLog };
}

describe("Suite J — Live Conversation Behavior", () => {
  // ── J1: No re-verification when already verified ────────────────────────────
  describe("J1: Bug 2 (live) — agent skips identity verification when session already verified", () => {
    it.skipIf(!isLive)(
      "live: after a completed sensitive action, a second request proceeds to confirmation without re-verifying",
      async () => {
        const { loop, history, wm } = makeLiveHarness("j1");

        // Turn 1: request plan change — agent should initiate OTP
        const t1 = await loop.chat(history, "I want to downgrade to the free plan");
        expect(t1.reply).toMatch(/code|otp|verif/i);
        expect(wm.isVerified()).toBe(false);

        // Turn 2: provide OTP — identity verified
        const t2 = await loop.chat(history, "123456");
        expect(wm.isVerified()).toBe(true);
        // Either confirmation prompt or asking to confirm plan name
        expect(t2.reply).not.toMatch(/couldn't generate a response/i);

        // Turn 3: confirm the plan change
        const t3 = await loop.chat(history, "yes");
        expect(t3.reply).not.toMatch(/couldn't generate a response/i);

        // Turn 4: request a different action — identity is ALREADY verified
        const t4 = await loop.chat(history, "I'd also like to check my account details");

        // Bug 2 was: agent called verify_identity(initiate) again here
        // Assert: toolLogs must NOT contain a second verify_identity initiate call
        const reVerifyLogs = t4.toolLogs.filter(
          (l) => l.includes("[tool:verify_identity]") && l.includes("otp_sent")
        );
        expect(reVerifyLogs).toHaveLength(0);
        expect(wm.isVerified()).toBe(true);
      }
    );
  });

  // ── J2: No proactive refund from ambiguous statement ────────────────────────
  describe("J2: Bug 3 (live) — agent does not propose a refund from a context-only statement", () => {
    it.skipIf(!isLive)(
      "live: 'since I'm switching to the free plan' does not trigger an issue_refund call",
      async () => {
        const { loop, history, wm, auditLog } = makeLiveHarness("j2");

        // Complete a plan downgrade first
        await loop.chat(history, "I want to downgrade to the free plan");
        await loop.chat(history, "123456"); // OTP
        await loop.chat(history, "yes"); // confirm plan change
        await loop.chat(history, "yes"); // second yes if double-confirm needed

        const preRefundCount = wm.getRefundCount();
        const preAuditCount = auditLog.getRecords().length;

        // The ambiguous statement that triggered Bug 3 in the real conversation
        const result = await loop.chat(history, "since I'm switching to the free plan");

        // Agent must NOT have called issue_refund
        const refundLogs = result.toolLogs.filter((l) => l.includes("[tool:issue_refund]"));
        expect(refundLogs).toHaveLength(0);

        // Refund count and audit records must be unchanged
        expect(wm.getRefundCount()).toBe(preRefundCount);
        expect(auditLog.getRecords()).toHaveLength(preAuditCount);

        // Agent should either ask what the user wants or clarify — not propose a refund
        expect(result.reply).not.toMatch(/refund.*confirm|confirm.*refund/i);
        expect(result.reply).not.toMatch(/couldn't generate a response/i);
      }
    );
  });
});
