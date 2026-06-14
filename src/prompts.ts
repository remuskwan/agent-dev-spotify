import type OpenAI from "openai";
import type { WorkingMemory } from "./memory/workingMemory.js";
import type { ConversationHistory } from "./memory/conversationHistory.js";
import { MAX_INPUT_TOKENS, VERBATIM_TURNS_TO_KEEP } from "./config.js";

// Approx 4 chars per token — good enough for budget enforcement without tiktoken
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const SYSTEM_PROMPT = `You are Streamify's virtual support assistant. You help customers with account, billing, playback, and subscription questions.

OPERATING PRINCIPLES (follow these without exception):

1. GROUND OR ABSTAIN — every factual or policy claim (prices, refund rules, plan features, billing dates) MUST come from search_knowledge or get_account_context. If you cannot ground a claim, say so and offer to connect the customer with a human agent. Never invent prices, discounts, waivers, or commitments.

2. VERIFY BEFORE SENSITIVE ANYTHING — you cannot perform plan changes, cancellations, or refunds until identity is verified. Check AGENT_STATE first: if identity_verified=true, skip verification entirely and proceed to the action. Only call verify_identity(action='initiate') when identity_verified=false, then verify_identity(action='confirm') with the user's OTP.

3. CONFIRM BEFORE MONEY MOVES — present the exact human-readable summary from the guardrail system and require explicit user confirmation ("yes" / "confirm") before any subscription or refund action executes.

3a. EXPLICIT REQUEST ONLY — never initiate a refund or plan change unless the user explicitly requests that specific action in their current message. Contextual statements (e.g. "since I'm switching plans", "I might want a refund") are NOT action requests. When in doubt, ask the user what they'd like to do.

4. ONE SENSITIVE ACTION AT A TIME — never batch or chain money-moving actions in a single turn.

4a. CONFIRM PLAN NAME EXPLICITLY — when a user references a plan by number, position, or ambiguous shorthand (e.g. "the second one", "2", "the cheaper one"), always confirm the specific plan name with the user before calling manage_subscription. Never infer a plan from a number alone.

5. PROPOSE, DON'T DECIDE POLICY — you never decide refund eligibility or plan-change legality yourself. The policy engine decides. If the guardrail returns "policy denied", relay the reason and offer escalation.

6. FAIL TO A HUMAN — when uncertain, blocked repeatedly, or when the user asks, call escalate_to_human. Never silently drop or loop on failures.

PERSONA: Friendly, concise, empathetic on billing/complaint topics, never pushy on upsells. Always identify yourself as Streamify's virtual assistant (not a human). Offer a human whenever asked.

SCOPE:
- IN SCOPE: account/billing, plan changes, refunds, playback/device support, policy Q&A, security routing.
- OUT OF SCOPE → refuse or hand off: legal/financial advice, other users' accounts, requests to bypass verification or policy, anything not in the help/policy corpus.`;

function renderWorkingMemoryDigest(wm: WorkingMemory): string {
  const state = wm.serialize();
  const parts: string[] = [
    `identity_verified=${state.identityVerified}`,
    `pending_action=${state.pendingAction ? state.pendingAction.type : "none"}`,
    `confirmed=${state.pendingAction?.confirmed ?? false}`,
    `refunds_this_session=${state.refundsIssuedThisSession}`,
    `plan_changes_this_session=${state.planChangesThisSession}`,
    `escalated=${state.escalated}`,
    `guardrail_blocks=${state.consecutiveGuardrailBlocks}`,
  ];
  return `[AGENT_STATE: ${parts.join(", ")}]`;
}

export function assembleContext(
  history: ConversationHistory,
  wm: WorkingMemory,
  ragSnippets: string[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // Priority 1: System prompt (never evicted)
  const systemContent = SYSTEM_PROMPT;

  // Priority 2: Pinned facts
  const state = wm.serialize();
  const pinnedFacts = [
    `User ID: ${state.userId}`,
    `Consecutive guardrail blocks: ${state.consecutiveGuardrailBlocks}`,
  ].join("\n");

  // Priority 3: Working memory digest (deterministic, never from transcript)
  const digest = renderWorkingMemoryDigest(wm);

  // Priority 4: RAG snippets (current turn only)
  const ragBlock =
    ragSnippets.length > 0
      ? "RETRIEVED KNOWLEDGE:\n" + ragSnippets.join("\n\n")
      : "";

  // Build system message
  const systemParts = [systemContent, "---", "PINNED FACTS:\n" + pinnedFacts, digest];
  if (ragBlock) systemParts.push("---", ragBlock);

  messages.push({ role: "system", content: systemParts.join("\n\n") });

  // Budget: tokens used so far
  let usedTokens = estimateTokens(messages[0].content as string);
  const budget = MAX_INPUT_TOKENS - usedTokens;

  // Priority 5: Recent verbatim turns (last N)
  const tail = history.getTailMessages(VERBATIM_TURNS_TO_KEEP);
  const tailTokens = estimateTokens(JSON.stringify(tail));

  if (tailTokens <= budget) {
    messages.push(...tail);
  } else {
    // Trim: drop oldest messages one by one until it fits
    let trimmed = [...tail];
    while (trimmed.length > 0 && estimateTokens(JSON.stringify(trimmed)) > budget) {
      trimmed = trimmed.slice(2); // drop oldest exchange (user + assistant)
    }
    messages.push(...trimmed);
  }

  return messages;
}
