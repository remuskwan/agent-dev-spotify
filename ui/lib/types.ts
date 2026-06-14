// Local type mirror of the agent service contract (src/service/API.md).
// The UI never imports agent source — these are maintained independently.

export type SpanType = "turn" | "llm" | "tool" | "guardrail";

export interface Span {
  name: string;
  type: SpanType;
  startMs: number;
  endMs: number;
  durationMs: number;
  attributes: Record<string, unknown>;
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string;
  refundAmountUsd?: number;
}

export interface PendingAction {
  type: "manage_subscription" | "issue_refund";
  args: Record<string, unknown>;
  summary: string;
  confirmed: boolean;
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

export interface SafeWorkingMemory {
  conversationId: string;
  userId: string;
  identityVerified: boolean;
  verificationToken: "set" | null;
  verificationTokenExpiry: number | null;
  pendingAction: PendingAction | null;
  confirmationToken: "set" | null;
  idempotencyKey: string | null;
  policyVerdict: PolicyVerdict | null;
  refundsIssuedThisSession: number;
  planChangesThisSession: number;
  consecutiveGuardrailBlocks: number;
  idempotencyStoreSize: number;
  escalated: boolean;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}

export interface CreateSessionResponse {
  conversationId: string;
  userId: string;
  workingMemory: SafeWorkingMemory;
}

export interface TurnResponse {
  reply: string;
  toolLogs: string[];
  spans: Span[];
  audit: AuditRecord[];
  workingMemory: SafeWorkingMemory;
}

export interface SnapshotResponse {
  conversationId: string;
  userId: string;
  workingMemory: SafeWorkingMemory;
  transcript: TranscriptMessage[];
  spans: Span[];
  audit: AuditRecord[];
}

// UI display message (differs from wire TranscriptMessage — tracks loading state)
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}
