import { AgentLoop } from "../../src/agentLoop.js";
import type { ChatResult } from "../../src/agentLoop.js";
import { ConversationHistory } from "../../src/memory/conversationHistory.js";
import { WorkingMemory } from "../../src/memory/workingMemory.js";
import { buildRegistry } from "../../src/tools/registry.js";
import type { Tracer } from "../../src/observability/tracer.js";
import type { AuditLog } from "../../src/observability/auditLog.js";
import { NullTracer } from "./nullTracer.js";
import { NullAuditLog } from "./nullAuditLog.js";

export interface Harness {
  loop: AgentLoop;
  history: ConversationHistory;
  wm: WorkingMemory;
  tracer: NullTracer;
  auditLog: NullAuditLog;
  chat(message: string): Promise<ChatResult>;
  chatSequence(messages: string[]): Promise<ChatResult[]>;
}

export function makeHarness(userId = "user_test_001"): Harness {
  const conversationId = `test-${Math.random().toString(36).slice(2, 10)}`;
  const wm = new WorkingMemory(conversationId, userId);
  const history = new ConversationHistory();
  const registry = buildRegistry();
  const tracer = new NullTracer();
  const auditLog = new NullAuditLog();

  // NullTracer/NullAuditLog are structurally compatible but TypeScript's nominal
  // class checking requires a cast since the real classes have private fields.
  const loop = new AgentLoop(
    wm,
    registry,
    tracer as unknown as Tracer,
    auditLog as unknown as AuditLog
  );

  return {
    loop,
    history,
    wm,
    tracer,
    auditLog,
    chat: (msg) => loop.chat(history, msg),
    async chatSequence(messages) {
      const results: ChatResult[] = [];
      for (const msg of messages) {
        results.push(await loop.chat(history, msg));
      }
      return results;
    },
  };
}
