export interface AccountFixture {
  userId: string;
  emailMasked: string;        // j***@example.com — safe for unverified context
  emailFull: string;          // PII — only shown after identity verification
  plan: "free" | "individual" | "duo" | "family";
  planPrice: number;
  billingCycleAnchor: string;
  nextBillingDate: string;
  lastChargeAmount: number;
  lastChargeDate: string;
  paymentMethodLast4: string; // PII — only shown after identity verification
  devicesRegistered: number;
  subscriptionStartDate: string;
  refundsIssuedLast90Days: number;
  isEligibleForRefund: boolean;
}

export const DEMO_ACCOUNT: AccountFixture = {
  userId: "user_demo_001",
  emailMasked: "j***@example.com",
  emailFull: "jane.doe@example.com",
  plan: "individual",
  planPrice: 9.99,
  billingCycleAnchor: "2024-01-15",
  nextBillingDate: "2026-07-15",
  lastChargeAmount: 9.99,
  lastChargeDate: "2026-06-15",
  paymentMethodLast4: "4242",
  devicesRegistered: 3,
  subscriptionStartDate: "2023-04-01",
  refundsIssuedLast90Days: 0,
  isEligibleForRefund: true,
};
