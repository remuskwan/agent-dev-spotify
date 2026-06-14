import type OpenAI from "openai";
import { DEMO_ACCOUNT } from "../fixtures/accountFixture.js";
import type { ToolContext, ToolEntry } from "../types.js";

const spec: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_account_context",
    description:
      "Retrieve the authenticated user's account snapshot: plan, subscription status, billing dates, and device count. " +
      "PII fields (full email, payment last4) are only returned after identity verification.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

async function handler(_args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const verified = ctx.workingMemory.isVerified();

  // Non-PII fields always available.
  // Monetary values are formatted as strings (e.g. "$9.99/mo") so the output
  // guardrail's dollar-amount grounding check can match them in the reply.
  const base = {
    userId: DEMO_ACCOUNT.userId,
    plan: DEMO_ACCOUNT.plan,
    planPrice: `$${DEMO_ACCOUNT.planPrice.toFixed(2)}/mo`,
    nextBillingDate: DEMO_ACCOUNT.nextBillingDate,
    lastChargeAmount: `$${DEMO_ACCOUNT.lastChargeAmount.toFixed(2)}`,
    lastChargeDate: DEMO_ACCOUNT.lastChargeDate,
    devicesRegistered: DEMO_ACCOUNT.devicesRegistered,
    subscriptionStartDate: DEMO_ACCOUNT.subscriptionStartDate,
    refundsIssuedLast90Days: DEMO_ACCOUNT.refundsIssuedLast90Days,
    isEligibleForRefund: DEMO_ACCOUNT.isEligibleForRefund,
  };

  if (verified) {
    return JSON.stringify({
      ...base,
      email: DEMO_ACCOUNT.emailFull,
      paymentMethodLast4: DEMO_ACCOUNT.paymentMethodLast4,
      identityVerified: true,
    });
  }

  return JSON.stringify({
    ...base,
    email: DEMO_ACCOUNT.emailMasked,
    paymentMethodLast4: "[requires identity verification]",
    identityVerified: false,
  });
}

export const getAccountContextTool: ToolEntry = { spec, handler, sensitive: false };
