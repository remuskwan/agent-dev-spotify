/**
 * Suite C — Sensitive Happy Path
 *
 * End-to-end integration tests using a mocked LLM sequence.
 * Real tool dispatch is used, so guardrails run authentically.
 *
 * Gate: All state-machine assertions pass (refund count, plan change count, audit records).
 *
 * Design note on the 3-turn refund flow:
 *   Turn 1: verify_identity(initiate) + text reply asking for OTP
 *   Turn 2: verify_identity(confirm) + issue_refund → confirmation_required breaks loop →
 *            reply is the generic fallback (pending action is now armed in wm)
 *   Turn 3: user says "yes" → armConfirmation (step 3) → issue_refund executes → success reply
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/llm.js", () => ({
  complete: vi.fn(),
  routeModel: vi.fn(() => "gpt-4o-mini"),
}));

// Replace DEMO_ACCOUNT so the eligible account fixture is used
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
import { durableActionStore } from "../../src/memory/durableActionStore.js";

beforeEach(() => {
  vi.clearAllMocks();
  // §9.4 durable store is a process-level singleton — isolate each test.
  durableActionStore.reset();
});

function programLLM(responses: ReturnType<typeof textReply>[]): void {
  const seq = new LlmSequence(responses);
  vi.mocked(complete).mockImplementation(() => Promise.resolve(seq.next()));
}

describe("Suite C — Sensitive Happy Path", () => {
  describe("C1: Refund happy path (3-turn flow)", () => {
    it("completes the full verify → confirmation → execute → audit sequence", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm, auditLog } = makeHarness("user_test_001");

      // ── Turn 1: user requests refund ─────────────────────────────────────────
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply(
          "I need to verify your identity before processing a refund. " +
            "I've sent a 6-digit code to your email. Please enter it."
        ),
      ]);

      const turn1 = await chat("I need a refund for my last charge");
      expect(turn1.reply).toMatch(/verif|code/i);
      expect(wm.isVerified()).toBe(false); // not verified yet

      // ── Turn 2: user enters OTP → triggers confirmation_required ─────────────
      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        toolCallReply("issue_refund", { reason: "user request" }),
      ]);

      const turn2 = await chat("123456");
      // After verify_identity(confirm), wm is now verified
      expect(wm.isVerified()).toBe(true);
      // issue_refund triggered confirmation_required → pending action set
      expect(wm.getPendingAction()).not.toBeNull();
      expect(wm.getPendingAction()!.type).toBe("issue_refund");
      expect(wm.isConfirmed()).toBe(false);
      // Refund not yet issued
      expect(wm.getRefundCount()).toBe(0);
      expect(auditLog.getRecords()).toHaveLength(0);

      // ── Turn 3: user confirms → executes refund ───────────────────────────────
      programLLM([
        toolCallReply("issue_refund", { reason: "user request" }),
        textReply(
          "Your refund of $9.99 has been processed and will appear on your statement within 5–10 business days. " +
            "Is there anything else I can help you with?"
        ),
      ]);

      const turn3 = await chat("yes");
      // step 3 armed confirmation from "yes"
      expect(turn3.reply).toMatch(/refund|processed/i);
      expect(wm.getRefundCount()).toBe(1);
      expect(auditLog.getRecords()).toHaveLength(1);
      expect(auditLog.getRecords()[0].action).toBe("issue_refund");
      // Pending action consumed after execution
      expect(wm.getPendingAction()).toBeNull();

      stdoutSpy.mockRestore();
    });
  });

  describe("C2: Subscription cancellation happy path", () => {
    it("completes the verify → confirmation → cancel sequence", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm, auditLog } = makeHarness("user_test_001");

      // Turn 1: initiate verification
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("I've sent a verification code to your email. Please enter it."),
      ]);
      await chat("I want to cancel my subscription");

      // Turn 2: confirm OTP → triggers confirmation_required for manage_subscription(cancel)
      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        toolCallReply("manage_subscription", { action: "cancel" }),
      ]);
      await chat("123456");
      expect(wm.isVerified()).toBe(true);
      expect(wm.getPendingAction()?.type).toBe("manage_subscription");
      expect(wm.getPlanChangeCount()).toBe(0);

      // Turn 3: user confirms cancellation
      programLLM([
        toolCallReply("manage_subscription", { action: "cancel" }),
        textReply(
          "Your subscription has been cancelled. You'll retain access until 2026-07-15."
        ),
      ]);
      const turn3 = await chat("yes, go ahead");
      expect(turn3.reply).toMatch(/cancel|access|subscri/i);
      expect(wm.getPlanChangeCount()).toBe(1);
      expect(auditLog.recordsFor("manage_subscription")).toHaveLength(1);

      stdoutSpy.mockRestore();
    });
  });

  describe("C3: Plan upgrade happy path (individual → family)", () => {
    it("completes the verify → confirmation → upgrade sequence", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm, auditLog } = makeHarness("user_test_001");

      // Turn 1: initiate verification
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Please enter the verification code sent to your email."),
      ]);
      await chat("I want to upgrade to the Family plan");

      // Turn 2: confirm OTP → triggers confirmation_required for manage_subscription(upgrade)
      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        toolCallReply("manage_subscription", { action: "upgrade", targetPlan: "family" }),
      ]);
      await chat("123456");
      expect(wm.isVerified()).toBe(true);
      expect(wm.getPendingAction()?.type).toBe("manage_subscription");

      // Turn 3: user confirms upgrade
      programLLM([
        toolCallReply("manage_subscription", { action: "upgrade", targetPlan: "family" }),
        // Avoid $15.99 in the reply — tool result JSON has "15.99" not "$15.99",
        // so the output guardrail would block an ungrounded dollar amount.
        textReply("Your plan has been upgraded to the Family plan. Enjoy your new features!"),
      ]);
      const turn3 = await chat("yes please");
      expect(turn3.reply).toMatch(/upgrad|family|plan/i);
      expect(wm.getPlanChangeCount()).toBe(1);
      expect(auditLog.recordsFor("manage_subscription")).toHaveLength(1);

      stdoutSpy.mockRestore();
    });
  });

  describe("C4: Negation aborts pending action", () => {
    it("aborts the pending action when user says 'no'", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const { chat, wm } = makeHarness("user_test_001");

      // Get to confirmation_required state
      programLLM([
        toolCallReply("verify_identity", { action: "initiate" }),
        textReply("Please enter your verification code."),
      ]);
      await chat("I need a refund");

      programLLM([
        toolCallReply("verify_identity", { action: "confirm", otp: "123456" }),
        toolCallReply("issue_refund", { reason: "test" }),
      ]);
      await chat("123456");
      expect(wm.getPendingAction()).not.toBeNull();

      // User says "no" — pending action should be aborted
      programLLM([textReply("No problem — I've cancelled that action. Anything else I can help with?")]);
      const abortResult = await chat("no, never mind");
      expect(abortResult.reply).toMatch(/cancel|abort|never mind/i);
      expect(wm.getPendingAction()).toBeNull();
      expect(wm.getRefundCount()).toBe(0);

      stdoutSpy.mockRestore();
    });
  });
});
