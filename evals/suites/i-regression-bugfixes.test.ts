/**
 * Suite I — Regression: Bugs from conversation d93493f0786dcc9f
 *
 * CI-safe (mocked LLM). Covers all six issues found in the trace.
 * Gate: 100% — any failure means a regression in a previously fixed bug.
 *
 * I1: Confirmation summary shown (not fallback error) when manage_subscription blocked
 * I2: Confirmation summary shown (not fallback error) when issue_refund blocked
 * I3: Audit record has non-null policyVerdict + idempotencyKey after confirmed execution
 * I4: verify_identity(initiate) returns already_verified when session is already verified
 * I5: Defense-in-depth — model calling issue_refund unprompted still requires explicit confirm
 * I6: "cancel it" no longer arms confirmation (dead code removed from AFFIRMATION_REGEX)
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
import { buildRegistry } from "../../src/tools/registry.js";
import { WorkingMemory } from "../../src/memory/workingMemory.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function programLLM(responses: ReturnType<typeof textReply>[]): void {
  const seq = new LlmSequence(responses);
  vi.mocked(complete).mockImplementation(() => Promise.resolve(seq.next()));
}

describe("Suite I — Regression: conversation d93493f0786dcc9f bugs", () => {
  // ── I1: Confirmation summary shown for manage_subscription ──────────────────
  describe("I1: Bug 1 — manage_subscription confirmation_required shows summary, not error fallback", () => {
    it("reply contains the confirmation summary text, not the generic error fallback", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm } = makeHarness("user_test_001");

      // Verify identity first
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Please enter your OTP."),
      ]);
      await chat("I want to downgrade to the free plan");

      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        textReply("Verified. Let me process the change."),
      ]);
      await chat("123456");
      expect(wm.isVerified()).toBe(true);

      // This turn triggers confirmation_required for manage_subscription
      programLLM([
        toolCallReply("manage_subscription", { action: "downgrade", targetPlan: "free" }),
      ]);
      const result = await chat("yes");

      // Bug 1 was: reply was "I'm sorry, I couldn't generate a response. Please try again."
      expect(result.reply).not.toMatch(/couldn't generate a response/i);
      // The confirmation summary contains "free" and instructs the user to confirm
      expect(result.reply).toMatch(/free/i);
      expect(result.reply).toMatch(/yes|confirm/i);
      // Pending action must be set (waiting for user confirmation)
      expect(wm.getPendingAction()).not.toBeNull();
      expect(wm.isConfirmed()).toBe(false);

      stdoutSpy.mockRestore();
    });
  });

  // ── I2: Confirmation summary shown for issue_refund ────────────────────────
  describe("I2: Bug 1 — issue_refund confirmation_required shows summary, not error fallback", () => {
    it("reply contains the refund confirmation summary, not the generic error fallback", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm } = makeHarness("user_test_001");

      // Verify identity
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Please enter your OTP."),
      ]);
      await chat("I need a refund");

      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        textReply("Verified."),
      ]);
      await chat("123456");
      expect(wm.isVerified()).toBe(true);

      // This turn triggers confirmation_required for issue_refund
      programLLM([
        toolCallReply("issue_refund", { reason: "user request" }),
      ]);
      const result = await chat("yes please refund me");

      expect(result.reply).not.toMatch(/couldn't generate a response/i);
      // Summary includes the refund amount ($9.99) and a confirm prompt
      expect(result.reply).toMatch(/\$9\.99|\$9,99/i);
      expect(result.reply).toMatch(/yes|confirm/i);
      expect(wm.getPendingAction()?.type).toBe("issue_refund");

      stdoutSpy.mockRestore();
    });
  });

  // ── I3: Audit record fields non-null after confirmed execution ──────────────
  describe("I3: Bug 4 — audit record has non-null policyVerdict and idempotencyKey", () => {
    it("audit record for manage_subscription has policyVerdict and idempotencyKey populated", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm, auditLog } = makeHarness("user_test_001");

      // Turn 1: verify
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Enter OTP."),
      ]);
      await chat("cancel my subscription");

      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        textReply("Verified."),
      ]);
      await chat("123456");

      // Turn 3: first call — confirmation_required, pending action set
      programLLM([
        toolCallReply("manage_subscription", { action: "cancel" }),
      ]);
      await chat("yes");
      expect(wm.getPendingAction()).not.toBeNull();

      // Turn 4: user confirms — manage_subscription executes
      programLLM([
        toolCallReply("manage_subscription", { action: "cancel" }),
        textReply("Your subscription has been cancelled."),
      ]);
      await chat("yes");

      expect(auditLog.getRecords()).toHaveLength(1);
      const record = auditLog.getRecords()[0];
      expect(record.action).toBe("manage_subscription");

      // Bug 4 was: both were null because consumePendingAction() ran before audit
      expect(record.policyVerdict).not.toBeNull();
      expect(record.policyVerdict?.allowed).toBe(true);
      expect(record.idempotencyKey).not.toBeNull();
      expect(record.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);

      stdoutSpy.mockRestore();
    });
  });

  // ── I4: verify_identity(initiate) is idempotent when already verified ────────
  describe("I4: Bug 2 (code guard) — verify_identity(initiate) skips OTP when already verified", () => {
    it("returns already_verified status instead of sending a new OTP", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const wm = new WorkingMemory("test-conv", "user_test_001");
      wm.issueVerificationToken(); // session already verified

      const registry = buildRegistry();
      const ctx = { workingMemory: wm, grounded: [] };

      const result = await registry.dispatch("verify_identity", { action: "initiate" }, ctx);
      const parsed = JSON.parse(result) as { status: string; message: string };

      // Bug 2 was: a new OTP was sent and stdout was written
      expect(parsed.status).toBe("already_verified");
      expect(parsed.message).toMatch(/already verified/i);
      // No OTP output emitted
      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });
  });

  // ── I5: Proactive refund still gated by explicit confirmation ──────────────
  describe("I5: Bug 3 (defense-in-depth) — unsolicited issue_refund still requires explicit user confirm", () => {
    it("does not execute refund and refundCount stays 0 until user says yes", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm, auditLog } = makeHarness("user_test_001");

      // Verify identity
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Enter OTP."),
      ]);
      await chat("I switched to the free plan");

      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        textReply("Verified."),
      ]);
      await chat("123456");

      // Model emits issue_refund from ambiguous context (simulating Bug 3)
      programLLM([
        toolCallReply("issue_refund", { reason: "switching to free plan" }),
      ]);
      const result = await chat("since I'm switching to the free plan");

      // Refund must NOT have executed — confirmation_required fires first
      expect(wm.getRefundCount()).toBe(0);
      expect(auditLog.getRecords()).toHaveLength(0);
      // The reply should be the confirmation summary, not an error
      expect(result.reply).not.toMatch(/couldn't generate a response/i);
      // Pending action is set (waiting for explicit yes)
      expect(wm.getPendingAction()?.type).toBe("issue_refund");
      expect(wm.isConfirmed()).toBe(false);

      stdoutSpy.mockRestore();
    });
  });

  // ── I6: "cancel it" no longer arms confirmation ────────────────────────────
  describe("I6: Bug 6 (cleanup) — 'cancel it' does not arm confirmation", () => {
    it("treats 'cancel it' as a negation (aborts pending action) not an affirmation", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm } = makeHarness("user_test_001");

      // Get to a state with a pending action
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Enter OTP."),
      ]);
      await chat("I want a refund");

      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        textReply("Verified."),
      ]);
      await chat("123456");

      programLLM([
        toolCallReply("issue_refund", { reason: "user request" }),
      ]);
      await chat("yes");
      expect(wm.getPendingAction()).not.toBeNull();

      // "cancel it" — should negate (cancel contains the word "cancel" which matches NEGATION_REGEX)
      programLLM([textReply("No problem — I've cancelled that action.")]);
      const result = await chat("cancel it");

      // Pending action should be aborted, not armed
      expect(wm.getPendingAction()).toBeNull();
      expect(wm.getRefundCount()).toBe(0);
      expect(result.reply).toMatch(/cancel|abort|no problem/i);

      stdoutSpy.mockRestore();
    });
  });
});
