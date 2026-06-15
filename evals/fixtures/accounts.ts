import type { AccountFixture } from "../../src/fixtures/accountFixture.js";

export const ELIGIBLE_ACCOUNT: AccountFixture = {
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
};

/** Already received a refund in the last 90 days — policy should deny another. */
export const ALREADY_REFUNDED_ACCOUNT: AccountFixture = {
  ...ELIGIBLE_ACCOUNT,
  refundsIssuedLast90Days: 1,
  isEligibleForRefund: false,
};

/** Account explicitly marked ineligible for refunds. */
export const INELIGIBLE_ACCOUNT: AccountFixture = {
  ...ELIGIBLE_ACCOUNT,
  isEligibleForRefund: false,
  refundsIssuedLast90Days: 0,
};

/** On the Family plan, enabling upgrade/downgrade/cancel plan scenarios. */
export const FAMILY_PLAN_ACCOUNT: AccountFixture = {
  ...ELIGIBLE_ACCOUNT,
  plan: "family",
  planPrice: 15.99,
};

/** Charge is $75 — over the $50 cap, so refund should be capped. */
export const HIGH_CHARGE_ACCOUNT: AccountFixture = {
  ...ELIGIBLE_ACCOUNT,
  lastChargeAmount: 75.0,
};

/** Free-plan account with $0 last charge — edge case for refund cap math (Math.min(0, 50) = 0). */
export const FREE_PLAN_ACCOUNT: AccountFixture = {
  ...ELIGIBLE_ACCOUNT,
  plan: "free" as const,
  planPrice: 0,
  lastChargeAmount: 0,
};
