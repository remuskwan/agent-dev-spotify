import { complete, routeModel } from "./llm.js";
import { assembleContext } from "./prompts.js";
import { runInputGuardrails } from "./guardrails/input.js";
import { runActionGuardrails } from "./guardrails/action.js";
import { runOutputGuardrails } from "./guardrails/output.js";
import type { WorkingMemory } from "./memory/workingMemory.js";
import type { ConversationHistory } from "./memory/conversationHistory.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { Tracer } from "./observability/tracer.js";
import type { AuditLog } from "./observability/auditLog.js";
import { MAX_TOOL_ITERS, MAX_CONSECUTIVE_GUARDRAIL_BLOCKS } from "./config.js";
import type { ToolContext } from "./types.js";

// Affirmation/negation detection for deterministic confirmation arming
const AFFIRMATION_REGEX = /\b(yes|yeah|yep|confirm|go ahead|do it|proceed|sure|ok|okay|approve)\b/i;
const NEGATION_REGEX = /\b(no|nope|cancel|stop|abort|don't|don't do it|hold on|wait|never mind|nevermind)\b/i;

function detectConfirmation(message: string): "affirm" | "negate" | "neutral" {
  const lower = message.toLowerCase().trim();
  // Negation takes precedence if both match
  if (NEGATION_REGEX.test(lower)) return "negate";
  if (AFFIRMATION_REGEX.test(lower)) return "affirm";
  return "neutral";
}

export interface ChatResult {
  reply: string;
  toolLogs: string[];
}

export class AgentLoop {
  constructor(
    private wm: WorkingMemory,
    private registry: ToolRegistry,
    private tracer: Tracer,
    private auditLog: AuditLog
  ) {}

  async chat(history: ConversationHistory, userMessage: string): Promise<ChatResult> {
    const toolLogs: string[] = [];
    const turnSpan = this.tracer.span("turn", "turn", { userMessage: userMessage.slice(0, 100) });

    // ── Step 1: Input guardrails ─────────────────────────────────────────────
    const guardSpan = this.tracer.span("input_guardrails", "guardrail", {});
    const inputResult = runInputGuardrails(userMessage);
    guardSpan.end({ blocked: inputResult.blocked, intentRisk: inputResult.intentRisk, hasPii: inputResult.hasPii });

    if (inputResult.blocked) {
      turnSpan.end({ outcome: "input_blocked" });
      return { reply: inputResult.reason!, toolLogs };
    }

    // ── Step 2: Add user message to history ──────────────────────────────────
    history.addUser(userMessage);

    // ── Step 3: Deterministic confirmation arming ────────────────────────────
    // The LLM NEVER self-confirms — only the raw user message gates this.
    const pending = this.wm.getPendingAction();
    if (pending && !this.wm.isConfirmed()) {
      const intent = detectConfirmation(userMessage);
      if (intent === "affirm") {
        this.wm.armConfirmation();
        toolLogs.push("[confirmation armed from user message]");
      } else if (intent === "negate") {
        this.wm.consumePendingAction();
        toolLogs.push("[pending action aborted by user]");
        history.addAssistant({
          role: "assistant",
          content: "No problem — I've cancelled that action. Is there anything else I can help you with?",
        } as Parameters<typeof history.addAssistant>[0]);
        turnSpan.end({ outcome: "action_aborted" });
        return {
          reply: "No problem — I've cancelled that action. Is there anything else I can help you with?",
          toolLogs,
        };
      }
      // "neutral" — let the model interpret and re-show the confirmation summary
    }

    // ── Step 4: Model routing ────────────────────────────────────────────────
    const model = routeModel(inputResult.intentRisk);

    // Track RAG snippets and all grounding sources for this turn
    let ragSnippets: string[] = [];
    let groundingSources: string[] = [];

    // ── Step 5: Tool iteration loop ──────────────────────────────────────────
    let iterCount = 0;
    // Holds the guardrail-generated confirmation summary when a sensitive tool is
    // blocked for the first time. Used as the final reply instead of the fallback.
    let pendingConfirmationReply: string | null = null;

    while (iterCount < MAX_TOOL_ITERS) {
      iterCount++;

      const messages = assembleContext(history, this.wm, ragSnippets);

      const llmSpan = this.tracer.span("llm_call", "llm", { model, iteration: iterCount });
      const assistantMsg = await complete({ messages, tools: this.registry.getSpecs(), model });
      llmSpan.end({
        hasToolCalls: (assistantMsg.tool_calls?.length ?? 0) > 0,
      });

      history.addAssistant(assistantMsg);

      // No tool calls → the model has produced its final reply
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        break;
      }

      // Process each tool call
      let breakAfterToolCalls = false;

      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown> = {};

        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          toolArgs = {};
        }

        const toolSpan = this.tracer.span(toolName, "tool", {
          toolName,
          sensitive: this.registry.isSensitive(toolName),
        });

        let toolResult: string;

        if (this.registry.isSensitive(toolName)) {
          // ── Action guardrails ────────────────────────────────────────────
          const guardrailSpan = this.tracer.span(`action_guardrail:${toolName}`, "guardrail", { toolName });
          const outcome = await runActionGuardrails(toolName, toolArgs, this.wm);
          guardrailSpan.end({ approved: outcome.approved, reason: !outcome.approved ? outcome.reason : "approved" });

          if (!outcome.approved) {
            const { reason, message } = outcome;
            toolLogs.push(`[guardrail:${reason}] ${toolName} blocked — ${message}`);

            if (reason === "confirmation_required") {
              // Inject the summary as a tool result (stays in history/grounding),
              // and capture it as the reply so the user sees the prompt directly
              // without an extra LLM round-trip.
              toolResult = JSON.stringify({ status: "confirmation_required", summary: message });
              history.addToolResult(toolCall.id, toolResult);
              toolSpan.end({ outcome: "confirmation_required" });
              pendingConfirmationReply = message;
              breakAfterToolCalls = true;
              break;
            } else {
              // identity_required or policy_denied — inject error and continue
              toolResult = JSON.stringify({ error: message });
              history.addToolResult(toolCall.id, toolResult);
              toolSpan.end({ outcome: reason });
              continue;
            }
          }

          // Approved — check for cached idempotency result
          if (outcome.enrichedArgs._cachedResult) {
            toolResult = String(outcome.enrichedArgs._cachedResult);
            toolLogs.push(`[idempotency] ${toolName} → returned cached result`);
            history.addToolResult(toolCall.id, toolResult);
            toolSpan.end({ outcome: "idempotency_replay" });
            // Snapshot audit fields before any side-effects clear them
            const replayVerdict = this.wm.getPolicyVerdict();
            const replayConfToken = this.wm.getConfirmationToken();
            const replayIdemKey = this.wm.getIdempotencyKey();
            // Audit the replay
            this.auditLog.record({
              userId: this.wm.getUserId(),
              action: toolName,
              args: toolArgs,
              policyVerdict: replayVerdict,
              confirmationToken: replayConfToken,
              idempotencyKey: replayIdemKey,
              outcome: `idempotency_replay: ${toolResult.slice(0, 100)}`,
            });
            groundingSources.push(toolResult);
            continue;
          }

          // Snapshot audit fields before dispatch — tool handlers call consumePendingAction()
          // which clears policyVerdict, confirmationToken, and idempotencyKey.
          const auditVerdict = this.wm.getPolicyVerdict();
          const auditConfToken = this.wm.getConfirmationToken();
          const auditIdemKey = this.wm.getIdempotencyKey();

          // Execute the tool
          const ctx: ToolContext = {
            workingMemory: this.wm,
            grounded: groundingSources,
          };
          toolResult = await this.registry.dispatch(toolName, outcome.enrichedArgs, ctx);
          toolLogs.push(`[tool:${toolName}] → ${toolResult.slice(0, 120)}`);

          // Audit the sensitive action using pre-dispatch snapshots
          this.auditLog.record({
            userId: this.wm.getUserId(),
            action: toolName,
            args: toolArgs,
            policyVerdict: auditVerdict,
            confirmationToken: auditConfToken,
            idempotencyKey: auditIdemKey,
            outcome: toolResult.slice(0, 200),
          });

          toolSpan.end({ outcome: "executed" });
        } else {
          // Non-sensitive tool — dispatch directly
          const ctx: ToolContext = {
            workingMemory: this.wm,
            grounded: groundingSources,
          };
          toolResult = await this.registry.dispatch(toolName, toolArgs, ctx);
          toolLogs.push(`[tool:${toolName}] → ${toolResult.slice(0, 120)}`);
          toolSpan.end({ outcome: "executed" });
        }

        history.addToolResult(toolCall.id, toolResult);
        groundingSources.push(toolResult);

        // Accumulate RAG snippets for context assembly
        if (toolName === "search_knowledge") {
          try {
            const parsed = JSON.parse(toolResult) as { snippets?: Array<{ content: string }> };
            ragSnippets = (parsed.snippets ?? []).map((s) => s.content);
            groundingSources = groundingSources.concat(ragSnippets);
          } catch {
            // ignore parse errors
          }
        }
      }

      if (breakAfterToolCalls) break;

      // Escalate on too many consecutive guardrail blocks
      if (this.wm.getConsecutiveGuardrailBlocks() >= MAX_CONSECUTIVE_GUARDRAIL_BLOCKS) {
        toolLogs.push(`[escalate] ${MAX_CONSECUTIVE_GUARDRAIL_BLOCKS} consecutive guardrail blocks — escalating to human`);
        const ctx: ToolContext = { workingMemory: this.wm, grounded: groundingSources };
        await this.registry.dispatch(
          "escalate_to_human",
          { reason: "Repeated guardrail blocks", intent: "unknown", context: "Max consecutive blocks reached" },
          ctx
        );
        turnSpan.end({ outcome: "escalated" });
        return {
          reply:
            "I've encountered repeated issues processing your request. Let me connect you with a human support agent who can help. Please hold on.",
          toolLogs,
        };
      }
    }

    // ── Step 6: MAX_TOOL_ITERS exceeded ─────────────────────────────────────
    if (iterCount >= MAX_TOOL_ITERS) {
      toolLogs.push(`[max_iters] Tool iteration limit (${MAX_TOOL_ITERS}) reached`);
      turnSpan.end({ outcome: "max_iters" });
      return {
        reply:
          "I'm having trouble completing your request right now. Let me connect you with a human support agent. Please hold on.",
        toolLogs,
      };
    }

    // ── Extract final reply from history ─────────────────────────────────────
    const allMessages = history.getMessages();
    const lastMsg = allMessages[allMessages.length - 1];
    let reply =
      pendingConfirmationReply ??
      (lastMsg?.role === "assistant" && typeof lastMsg.content === "string"
        ? lastMsg.content
        : "I'm sorry, I couldn't generate a response. Please try again.");

    // ── Step 7: Output guardrails ────────────────────────────────────────────
    const allGrounding = [...ragSnippets, ...history.getToolResultContents()];
    const outSpan = this.tracer.span("output_guardrails", "guardrail", {});
    const outResult = runOutputGuardrails(reply, allGrounding);
    outSpan.end({ blocked: outResult.blocked, reason: outResult.reason ?? "none" });

    if (outResult.blocked) {
      toolLogs.push(`[output_guardrail_blocked] ${outResult.reason}`);
      reply =
        "I'm unable to provide that information without verified grounding. " +
        "Would you like me to connect you with a human support agent?";
    }

    turnSpan.end({ outcome: "ok", replyLength: reply.length });
    return { reply, toolLogs };
  }
}
