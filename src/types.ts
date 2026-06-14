import type OpenAI from "openai";

// ─── Intent / risk ───────────────────────────────────────────────────────────

export type IntentRisk = "info" | "sensitive";

// ─── Working memory ───────────────────────────────────────────────────────────

export interface PendingAction {
  type: "manage_subscription" | "issue_refund";
  args: Record<string, unknown>;
  summary: string;   // human-readable, shown to user before confirmation
  confirmed: boolean; // armed DETERMINISTICALLY by the agent loop, never by the LLM
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string;
  refundAmountUsd?: number;
}

export interface WorkingMemoryState {
  conversationId: string;
  userId: string;
  identityVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpiry: number | null;
  pendingAction: PendingAction | null;
  confirmationToken: string | null;
  idempotencyKey: string | null;
  policyVerdict: PolicyVerdict | null;
  refundsIssuedThisSession: number;
  planChangesThisSession: number;
  consecutiveGuardrailBlocks: number;
  idempotencyStore: Record<string, string>;
  escalated: boolean;
}

// ─── Guardrails ───────────────────────────────────────────────────────────────

export interface InputGuardrailResult {
  blocked: boolean;
  reason?: string;
  intentRisk: IntentRisk;
  hasPii: boolean;
}

export type ActionGuardrailOutcome =
  | { approved: true; enrichedArgs: Record<string, unknown> }
  | { approved: false; reason: "identity_required" | "policy_denied" | "confirmation_required"; message: string };

export interface OutputGuardrailResult {
  blocked: boolean;
  reason?: string;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export interface ToolContext {
  workingMemory: import("./memory/workingMemory.js").WorkingMemory;
  grounded: string[]; // RAG + tool-result strings available this turn for output grounding
}

export interface ToolEntry {
  spec: OpenAI.Chat.ChatCompletionTool;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  sensitive: boolean;
}

// ─── Observability ────────────────────────────────────────────────────────────

export type SpanType = "turn" | "llm" | "tool" | "guardrail";

export interface Span {
  name: string;
  type: SpanType;
  startMs: number;
  endMs: number;
  durationMs: number;
  attributes: Record<string, unknown>;
}

export interface AuditRecord {
  ts: string;
  conversationId: string;
  userId: string;
  action: string;
  argsRedacted: Record<string, unknown>;
  policyVerdict: PolicyVerdict | null;
  confirmationToken: string | null;
  idempotencyKey: string | null;
  outcome: string;
}
