import crypto from "crypto";
import type OpenAI from "openai";
import type { ToolContext, ToolEntry } from "../types.js";

const spec: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "issue_refund",
    description:
      "Issue a refund for a recent charge. " +
      "REQUIRES: identity verification AND explicit user confirmation. " +
      "The refund amount is determined by the policy engine, not this call's arguments. " +
      "IMPORTANT: Do NOT pass an amount — the system determines the approved amount.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief reason for the refund (e.g., 'user did not use service', 'duplicate charge').",
        },
      },
      required: ["reason"],
    },
  },
};

async function handler(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const idempotencyKey = ctx.workingMemory.getIdempotencyKey();

  // Idempotency check
  if (idempotencyKey) {
    const cached = ctx.workingMemory.getCachedResult(idempotencyKey);
    if (cached) return cached;
  }

  // Read the approved refund amount from working memory policy verdict (NEVER from args)
  const verdict = ctx.workingMemory.getPolicyVerdict();
  const approvedAmount = verdict?.refundAmountUsd ?? 0;

  ctx.workingMemory.incrementRefundCount();

  const result = {
    status: "refunded",
    refundId: `REF-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    amountUsd: approvedAmount,
    refundedTo: "card ending 4242",
    estimatedArrival: "5–10 business days",
    reason: String(args.reason ?? ""),
    message: `A refund of $${approvedAmount.toFixed(2)} has been issued to your card ending in 4242.`,
  };

  const resultStr = JSON.stringify(result);

  // Cache for idempotency replay
  if (idempotencyKey) {
    ctx.workingMemory.cacheResult(idempotencyKey, resultStr);
  }

  // Clean up
  ctx.workingMemory.consumePendingAction();

  return resultStr;
}

export const issueRefundTool: ToolEntry = { spec, handler, sensitive: true };
