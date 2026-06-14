/**
 * Suite E — Policy Adherence
 *
 * Gate: 0 policy violations — no invented waivers, no cap breaches.
 *
 * Tests:
 *   E1 — Refund cap ($50) enforced by policy engine
 *   E2 — 90-day cooldown enforced
 *   E3 — Session rate caps enforced
 *   E4 — Output guardrail blocks no-promise violations
 *   E5 — Ungrounded dollar amounts blocked by output guardrail
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() so `mockAccount` is available inside the vi.mock() factory,
// which is hoisted before any variable declarations in this file.
const { mockAccount } = vi.hoisted(() => {
  const mockAccount = {
    userId: "user_test_001",
    emailMasked: "t***@example.com",
    emailFull: "test.user@example.com",
    plan: "individual" as const,
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
  };
  return { mockAccount };
});

vi.mock("../../src/fixtures/accountFixture.js", () => ({
  DEMO_ACCOUNT: mockAccount,
}));

import { runOutputGuardrails } from "../../src/guardrails/output.js";
import { runActionGuardrails } from "../../src/guardrails/action.js";
import { WorkingMemory } from "../../src/memory/workingMemory.js";

function eligibleWm(): WorkingMemory {
  const wm = new WorkingMemory("policy-test", "user_test_001");
  wm.issueVerificationToken();
  return wm;
}

// Reset mock account to eligible state after each test
afterEach(() => {
  mockAccount.isEligibleForRefund = true;
  mockAccount.refundsIssuedLast90Days = 0;
  mockAccount.lastChargeAmount = 9.99;
});

describe("Suite E — Policy Adherence", () => {
  describe("E1: Refund $50 cap enforced", () => {
    it("caps refund at $50 when last charge exceeds the cap", async () => {
      mockAccount.lastChargeAmount = 75.0;

      const wm = eligibleWm();
      // First call: sets pending action + evaluates policy verdict
      const result = await runActionGuardrails("issue_refund", { reason: "overcharge test" }, wm);
      expect(result.approved).toBe(false);
      if (!result.approved) {
        expect(result.reason).toBe("confirmation_required");
        // Policy verdict was set — check the capped amount
        const verdict = wm.getPolicyVerdict();
        expect(verdict).not.toBeNull();
        expect(verdict!.refundAmountUsd).toBe(50); // Math.min(75, 50) = 50
        expect(verdict!.refundAmountUsd).toBeLessThanOrEqual(50);
      }
    });
  });

  describe("E2: 90-day cooldown enforced", () => {
    it("denies refund when refundsIssuedLast90Days >= 1", async () => {
      mockAccount.refundsIssuedLast90Days = 1;
      mockAccount.isEligibleForRefund = false;

      const wm = eligibleWm();
      const result = await runActionGuardrails("issue_refund", { reason: "cooldown test" }, wm);
      expect(result.approved).toBe(false);
      if (!result.approved) {
        expect(result.reason).toBe("policy_denied");
        expect(result.message).toMatch(/90 days|not eligible/i);
      }
    });
  });

  describe("E3: Session rate caps", () => {
    it("blocks second refund in same session (session rate cap)", async () => {
      // Account is eligible (mockAccount reset to eligible in afterEach)
      const wm = eligibleWm();
      // Simulate one refund already issued this session
      wm.incrementRefundCount();
      expect(wm.getRefundCount()).toBe(1);

      const result = await runActionGuardrails("issue_refund", { reason: "second refund" }, wm);
      expect(result.approved).toBe(false);
      if (!result.approved) {
        expect(result.reason).toBe("policy_denied");
        expect(result.message).toMatch(/Refund limit/i);
      }
    });

    it("blocks second plan change in same session", async () => {
      const wm = eligibleWm();
      wm.incrementPlanChangeCount();

      const result = await runActionGuardrails("manage_subscription", { action: "cancel" }, wm);
      expect(result.approved).toBe(false);
      if (!result.approved) {
        expect(result.reason).toBe("policy_denied");
        expect(result.message).toMatch(/Plan change limit/i);
      }
    });
  });

  describe("E4: Output guardrail blocks no-promise violations", () => {
    const groundingSources = [
      "Refunds are processed within 5-10 business days.",
      "Plans: Individual $9.99/mo, Duo $12.99/mo, Family $15.99/mo.",
    ];

    const noPromiseCases = [
      { phrase: "I'll waive the fee for you", desc: "waive fee" },
      { phrase: "I can offer you a special discount today", desc: "special discount" },
      { phrase: "I'll make an exception in your case", desc: "make exception" },
      { phrase: "As a one-time courtesy, I'll refund you", desc: "one-time courtesy" },
      { phrase: "I'll personally ensure your refund arrives tomorrow", desc: "personally ensure" },
    ];

    for (const { phrase, desc } of noPromiseCases) {
      it(`blocks reply containing "${desc}" pattern`, () => {
        const result = runOutputGuardrails(phrase, groundingSources);
        expect(result.blocked, `must block "${desc}": "${phrase}"`).toBe(true);
        expect(result.reason).toBeTruthy();
      });
    }
  });

  describe("E5: Ungrounded dollar amounts blocked by output guardrail", () => {
    it("blocks reply with dollar amount not in grounding sources", () => {
      const result = runOutputGuardrails(
        "Great news — I've approved your refund of $500.00!",
        ["Plans start at $9.99/mo"]
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/Ungrounded dollar amount/i);
    });

    it("allows reply with dollar amounts present in grounding sources", () => {
      const result = runOutputGuardrails(
        "Your refund of $9.99 will be credited within 5-10 business days.",
        ["$9.99 was charged on 2026-06-15", "5-10 business days processing time"]
      );
      expect(result.blocked).toBe(false);
    });

    it("blocks reply with ungrounded policy claim phrase", () => {
      const result = runOutputGuardrails(
        "You are eligible for a refund within 7 days.",
        [] // no grounding
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/Ungrounded policy claim/i);
    });

    it("allows clean grounded response", () => {
      const result = runOutputGuardrails(
        "How can I help you with your account today?",
        []
      );
      expect(result.blocked).toBe(false);
    });
  });
});
