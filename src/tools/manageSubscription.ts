import crypto from "crypto";
import type OpenAI from "openai";
import type { ToolContext, ToolEntry } from "../types.js";

const PLAN_PRICES: Record<string, number> = {
  free: 0,
  individual: 9.99,
  duo: 12.99,
  family: 15.99,
};

const spec: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "manage_subscription",
    description:
      "Execute a subscription action: start, upgrade, downgrade, or cancel the user's plan. " +
      "REQUIRES: identity verification (call verify_identity first) AND explicit user confirmation. " +
      "The guardrail pipeline enforces both before this executes.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "upgrade", "downgrade", "cancel"],
          description: "The subscription action to perform.",
        },
        targetPlan: {
          type: "string",
          enum: ["free", "individual", "duo", "family"],
          description: "The target plan for start/upgrade/downgrade actions (omit for cancel).",
        },
      },
      required: ["action"],
    },
  },
};

async function handler(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const action = String(args.action ?? "");
  const idempotencyKey = ctx.workingMemory.getIdempotencyKey();

  // Idempotency check — guardrails/action.ts handles the primary dedupe,
  // but we also cache here for defense-in-depth
  if (idempotencyKey) {
    const cached = ctx.workingMemory.getCachedResult(idempotencyKey);
    if (cached) return cached;
  }

  let result: Record<string, unknown>;

  if (action === "cancel") {
    ctx.workingMemory.incrementPlanChangeCount();
    result = {
      status: "cancelled",
      message: "Your subscription has been successfully cancelled.",
      effectiveDate: "2026-07-15",
      confirmationId: `CANCEL-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
      note: "You will retain access to Premium features until 2026-07-15.",
    };
  } else if (action === "upgrade" || action === "downgrade" || action === "start") {
    const targetPlan = String(args.targetPlan ?? "individual");
    const price = PLAN_PRICES[targetPlan] ?? 9.99;
    ctx.workingMemory.incrementPlanChangeCount();
    result = {
      status: "updated",
      message: `Your subscription has been changed to the ${targetPlan} plan.`,
      newPlan: targetPlan,
      newPrice: price,
      effectiveDate: action === "downgrade" ? "2026-07-15" : new Date().toISOString().split("T")[0],
      confirmationId: `PLAN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    };
  } else {
    result = { status: "error", message: `Unknown action: ${action}` };
  }

  const resultStr = JSON.stringify(result);

  // Cache for idempotency replay
  if (idempotencyKey) {
    ctx.workingMemory.cacheResult(idempotencyKey, resultStr);
  }

  // Clean up the consumed pending action (confirmation was used)
  ctx.workingMemory.consumePendingAction();

  return resultStr;
}

export const manageSubscriptionTool: ToolEntry = { spec, handler, sensitive: true };
