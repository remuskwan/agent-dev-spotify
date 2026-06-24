import type OpenAI from "openai";
import type { ToolContext, ToolEntry } from "../types.js";

const spec: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "escalate_to_human",
    description:
      "Transfer the conversation to a human support agent. Use when: confidence is low, policy blocks the request, " +
      "the user asks for a human, repeated failures occur, fraud is suspected, or the issue is out of scope. " +
      "Always provide a reason and any relevant context.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why escalation is needed (e.g., 'user request', 'policy limit exceeded', 'suspected fraud').",
        },
        intent: {
          type: "string",
          description: "What the user was trying to accomplish (e.g., 'cancel subscription', 'get refund').",
        },
        context: {
          type: "string",
          description: "Any additional context for the human agent.",
        },
      },
      required: ["reason"],
    },
  },
};

async function handler(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  ctx.workingMemory.setEscalated();

  const reason = String(args.reason ?? "unspecified");
  const intent = String(args.intent ?? "unknown");
  const context = String(args.context ?? "");

  // STUB: escalation currently only flags the session and returns a handoff
  // summary. No ticket is filed in a real support system and the conversation
  // transcript is NOT delivered to a human — `ticketId`/`estimatedWait` are
  // placeholders. See DESIGN.md §4.4 for the planned transcript-attachment work.
  return JSON.stringify({
    status: "escalated",
    message: "I'm connecting you with a human support agent. Please hold on.",
    handoffDetails: {
      reason,
      intent,
      context,
      estimatedWait: "2–5 minutes", // placeholder — not from a real queue
      ticketId: `TKT-${Date.now()}`, // placeholder — no real ticket is created
    },
  });
}

export const escalateToHumanTool: ToolEntry = { spec, handler, sensitive: false };
