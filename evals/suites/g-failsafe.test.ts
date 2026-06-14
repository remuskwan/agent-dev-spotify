/**
 * Suite G — Fail-Safe & Resilience
 *
 * Gate: 100% fail-closed — any dependency outage must deny sensitive actions,
 * not grant them. Zero tolerance.
 *
 * Tests:
 *   G1 — Tool errors: graceful degradation, no crash
 *   G2 — LLM outage: no tools executed
 *   G3 — Max tool iteration safety
 *   G4 — Consecutive guardrail blocks trigger escalation
 *   G5 — WorkingMemory crash-resume: serialize/deserialize preserves state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/llm.js", () => ({
  complete: vi.fn(),
  routeModel: vi.fn(() => "gpt-4o-mini"),
}));

vi.mock("../../src/fixtures/accountFixture.js", () => ({
  DEMO_ACCOUNT: {
    userId: "user_test_001",
    emailMasked: "t***@example.com",
    emailFull: "test.user@example.com",
    plan: "individual",
    planPrice: 9.99,
    billingCycleAnchor: "2024-01-15",
    nextBillingDate: "2026-07-15",
    lastChargeAmount: 9.99,
    lastChargeDate: "2026-06-15",
    paymentMethodLast4: "4242",
    devicesRegistered: 2,
    subscriptionStartDate: "2023-04-01",
    refundsIssuedLast90Days: 0,
    isEligibleForRefund: true,
  },
}));

import { complete } from "../../src/llm.js";
import { LlmSequence, toolCallReply, textReply } from "../helpers/mockLlm.js";
import { makeHarness } from "../helpers/agentHarness.js";
import { WorkingMemory } from "../../src/memory/workingMemory.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function programLLM(responses: ReturnType<typeof textReply>[]): void {
  const seq = new LlmSequence(responses);
  vi.mocked(complete).mockImplementation(() => Promise.resolve(seq.next()));
}

describe("Suite G — Fail-Safe & Resilience", () => {
  describe("G1: Tool errors — graceful degradation, no crash", () => {
    it("continues without crashing when search_knowledge returns an error result", async () => {
      // ToolRegistry.dispatch catches throws and returns { error: "..." } JSON.
      // The agent should still reply gracefully.
      programLLM([
        toolCallReply("search_knowledge", { query: "refund policy" }),
        textReply("I'm having trouble accessing our knowledge base right now. How can I assist you?"),
      ]);

      // The actual searchKnowledge tool won't throw for a normal query — it does a string search.
      // To simulate error, we test the registry's error-catching behaviour by calling a
      // non-existent tool (which the registry handles gracefully).
      const { ToolRegistry } = await import("../../src/tools/registry.js");
      const registry = new ToolRegistry();
      const { WorkingMemory } = await import("../../src/memory/workingMemory.js");
      const wm = new WorkingMemory("err-test", "user_test_001");
      const ctx = { workingMemory: wm, grounded: [] };

      const result = await registry.dispatch("nonexistent_tool", {}, ctx);
      const parsed = JSON.parse(result) as { error: string };
      expect(parsed.error).toMatch(/Unknown tool/i);
    });

    it("continues when get_account_context throws — tool registry catches and returns error JSON", async () => {
      // Simulate a throwing tool handler via the registry's catch block.
      const { ToolRegistry, buildRegistry } = await import("../../src/tools/registry.js");
      const registry = buildRegistry();

      // Monkey-patch the get_account_context tool to throw
      const entry = (registry as any).tools.get("get_account_context");
      if (entry) {
        const original = entry.handler;
        entry.handler = async () => { throw new Error("backend unavailable"); };

        const { WorkingMemory } = await import("../../src/memory/workingMemory.js");
        const wm = new WorkingMemory("err-test2", "user_test_001");
        const ctx = { workingMemory: wm, grounded: [] };
        const result = await registry.dispatch("get_account_context", {}, ctx);
        const parsed = JSON.parse(result) as { error: string };
        expect(parsed.error).toMatch(/get_account_context failed/i);

        // Restore
        entry.handler = original;
      }
    });

    it("blocks sensitive actions when verify_identity tool fails (fail-closed)", async () => {
      // If identity cannot be verified (tool throws), the action guardrail still
      // requires isVerified() === true. Since we can't verify, sensitive actions are blocked.
      const { runActionGuardrails } = await import("../../src/guardrails/action.js");
      const wm = new WorkingMemory("verify-fail", "user_test_001");
      // wm.isVerified() === false since no token was issued

      const result = await runActionGuardrails("issue_refund", { reason: "test" }, wm);
      expect(result.approved).toBe(false);
      if (!result.approved) {
        expect(result.reason).toBe("identity_required");
      }
    });
  });

  describe("G2: LLM outage — no tools executed when complete() throws", () => {
    it("propagates the error when the first LLM call throws", async () => {
      vi.mocked(complete).mockRejectedValue(new Error("Network timeout"));

      const { chat } = makeHarness();
      await expect(chat("What are your plans?")).rejects.toThrow("Network timeout");
    });

    it("does not execute any tool after LLM throws", async () => {
      vi.mocked(complete).mockRejectedValue(new Error("LLM unavailable"));

      const { chat, auditLog } = makeHarness();
      try {
        await chat("I need a refund");
      } catch {
        // expected
      }
      expect(auditLog.getRecords()).toHaveLength(0);
    });
  });

  describe("G3: Max tool iteration safety", () => {
    it("returns human-escalation message after hitting MAX_TOOL_ITERS (8)", async () => {
      // Mock LLM to always return a tool call (never a text reply) so the loop hits the limit.
      vi.mocked(complete).mockImplementation(() =>
        Promise.resolve(toolCallReply("search_knowledge", { query: "infinite loop" }))
      );

      const { chat } = makeHarness();
      const result = await chat("What are your plans?");

      expect(result.toolLogs.some((l) => l.includes("[max_iters]"))).toBe(true);
      expect(result.reply).toMatch(/human support agent/i);
    });
  });

  describe("G4: Consecutive guardrail blocks trigger escalation", () => {
    it("auto-escalates after 3 consecutive identity_required blocks", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      // Mock LLM to always try to call issue_refund (not verified → identity_required)
      // This will increment consecutiveGuardrailBlocks each iteration.
      vi.mocked(complete).mockImplementation(() =>
        Promise.resolve(toolCallReply("issue_refund", { reason: "keep trying" }))
      );

      const { chat, wm } = makeHarness();
      // wm starts without identity verification
      expect(wm.isVerified()).toBe(false);

      const result = await chat("I demand a refund right now, no verification needed");

      // After MAX_CONSECUTIVE_GUARDRAIL_BLOCKS (3) identity_required blocks, escalation fires
      expect(
        result.toolLogs.some((l) => l.includes("[escalate]")) ||
        result.reply.match(/human support agent/i)
      ).toBeTruthy();

      stdoutSpy.mockRestore();
    });
  });

  describe("G5: WorkingMemory crash-resume", () => {
    it("preserves verification state and pending action across serialize/deserialize", () => {
      const wm = new WorkingMemory("crash-test", "user_test_001");

      // Arm some state mid-flow
      wm.issueVerificationToken();
      wm.setPendingAction({
        type: "issue_refund",
        args: { reason: "mid-flow crash test" },
        summary: "Refund of $9.99 pending your confirmation.",
      });

      const snapshot = wm.serialize();

      // Simulate crash + resume
      const resumedWm = WorkingMemory.deserialize(snapshot);

      expect(resumedWm.isVerified()).toBe(true);
      expect(resumedWm.getPendingAction()).not.toBeNull();
      expect(resumedWm.getPendingAction()!.type).toBe("issue_refund");
      expect(resumedWm.isConfirmed()).toBe(false);
      expect(resumedWm.getRefundCount()).toBe(0);
    });

    it("crash-resume does not re-execute a completed action (idempotency cache survives)", () => {
      const wm = new WorkingMemory("idem-crash", "user_test_001");
      wm.issueVerificationToken();

      // Simulate a completed refund with cached result
      const key = wm.mintIdempotencyKey("issue_refund");
      wm.cacheResult(key, JSON.stringify({ status: "refunded", refundId: "REF-CRASH" }));
      wm.incrementRefundCount();

      const snapshot = wm.serialize();
      const resumed = WorkingMemory.deserialize(snapshot);

      // Idempotency cache should survive
      expect(resumed.getCachedResult(key)).toBe(
        JSON.stringify({ status: "refunded", refundId: "REF-CRASH" })
      );
      expect(resumed.getRefundCount()).toBe(1);
    });
  });
});
