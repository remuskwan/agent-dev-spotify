# Agent Service — HTTP Contract

Base URL: `http://localhost:8787` (configurable via `PORT` env var)

All requests and responses use `application/json`. CORS is open by default (`CORS_ORIGIN=*`).

---

## Endpoints

### `GET /healthz`
Liveness check.

**Response 200**
```json
{ "ok": true }
```

---

### `POST /sessions`
Create a new conversation session. Returns the session ID needed for subsequent calls.

**Request body** (optional)
```json
{ "userId": "user_demo_001" }
```

**Response 201**
```json
{
  "conversationId": "a1b2c3d4e5f6g7h8",
  "userId": "user_demo_001",
  "workingMemory": { /* SafeWorkingMemory — see types below */ }
}
```

---

### `POST /sessions/:id/messages`
Send a user message and receive the agent reply plus observability data for the turn.

**Request body**
```json
{ "message": "I need a refund" }
```

**Response 200**
```json
{
  "reply": "I can help with that. First, I'll need to verify your identity...",
  "toolLogs": [
    "[tool:verify_identity] → {\"status\":\"otp_sent\",...}",
    "[guardrail:confirmation_required] manage_subscription blocked — ..."
  ],
  "spans": [ /* Span[] — only spans added this turn */ ],
  "audit": [ /* AuditRecord[] — only records added this turn */ ],
  "workingMemory": { /* SafeWorkingMemory */ }
}
```

`spans` and `audit` are **deltas** — only events generated during this turn.

---

### `GET /sessions/:id`
Full session snapshot for reconnect/inspector load.

**Response 200**
```json
{
  "conversationId": "a1b2c3d4e5f6g7h8",
  "userId": "user_demo_001",
  "workingMemory": { /* SafeWorkingMemory */ },
  "transcript": [ /* TranscriptMessage[] — user+assistant only, no raw tool messages */ ],
  "spans": [ /* all Span[] for this session */ ],
  "audit": [ /* all AuditRecord[] for this session */ ]
}
```

---

### `DELETE /sessions/:id`
End a session and free its in-memory state.

**Response 200**
```json
{ "ok": true }
```

---

## Types

### `SafeWorkingMemory`
Secrets (`verificationToken`, `confirmationToken`) are masked to `"set" | null`.
`idempotencyStore` is replaced by `idempotencyStoreSize: number`.

```ts
interface SafeWorkingMemory {
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
```

### `Span`
```ts
interface Span {
  name: string;
  type: "turn" | "llm" | "tool" | "guardrail";
  startMs: number;
  endMs: number;
  durationMs: number;
  attributes: Record<string, unknown>;
}
```

### `AuditRecord`
```ts
interface AuditRecord {
  ts: string;              // ISO timestamp
  conversationId: string;
  userId: string;
  action: string;          // tool name
  argsRedacted: Record<string, unknown>;  // PII fields replaced with "[REDACTED]"
  policyVerdict: PolicyVerdict | null;
  confirmationToken: string | null;
  idempotencyKey: string | null;
  outcome: string;
}
```

### `TranscriptMessage`
```ts
interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}
```

### `PendingAction`
```ts
interface PendingAction {
  type: "manage_subscription" | "issue_refund";
  args: Record<string, unknown>;
  summary: string;
  confirmed: boolean;
}
```

### `PolicyVerdict`
```ts
interface PolicyVerdict {
  allowed: boolean;
  reason: string;
  refundAmountUsd?: number;
}
```
