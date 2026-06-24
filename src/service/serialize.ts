import type { WorkingMemory } from "../memory/workingMemory.js";
import type { ConversationHistory } from "../memory/conversationHistory.js";
import type { WorkingMemoryState } from "../types.js";

export interface SafeWorkingMemory extends Omit<WorkingMemoryState, "verificationToken" | "confirmationToken" | "idempotencyStore" | "expectedOtp"> {
  verificationToken: "set" | null;
  confirmationToken: "set" | null;
  expectedOtp: "set" | null;
  idempotencyStoreSize: number;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}

export function serializeWorkingMemory(wm: WorkingMemory): SafeWorkingMemory {
  const state = wm.serialize();
  const { verificationToken, confirmationToken, idempotencyStore, expectedOtp, ...rest } = state;
  return {
    ...rest,
    verificationToken: verificationToken !== null ? "set" : null,
    confirmationToken: confirmationToken !== null ? "set" : null,
    expectedOtp: expectedOtp !== null ? "set" : null,
    idempotencyStoreSize: Object.keys(idempotencyStore).length,
  };
}

export function serializeTranscript(history: ConversationHistory): TranscriptMessage[] {
  const result: TranscriptMessage[] = [];
  for (const msg of history.getMessages()) {
    if (msg.role === "user") {
      result.push({ role: "user", content: typeof msg.content === "string" ? msg.content : "" });
    } else if (msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : "";
      const toolCalls =
        "tool_calls" in msg && Array.isArray(msg.tool_calls)
          ? msg.tool_calls.map((tc) => ({
              name: tc.function.name,
              args: (() => {
                try {
                  return JSON.parse(tc.function.arguments) as Record<string, unknown>;
                } catch {
                  return {};
                }
              })(),
            }))
          : undefined;
      result.push({ role: "assistant", content, ...(toolCalls?.length ? { toolCalls } : {}) });
    }
    // skip raw "tool" role messages — they're internal plumbing
  }
  return result;
}
