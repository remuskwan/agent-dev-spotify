import crypto from "crypto";
import { WorkingMemory } from "../memory/workingMemory.js";
import { ConversationHistory } from "../memory/conversationHistory.js";
import { buildRegistry } from "../tools/registry.js";
import { Tracer } from "../observability/tracer.js";
import { AuditLog } from "../observability/auditLog.js";
import { AgentLoop } from "../agentLoop.js";

const DEMO_USER_ID = "user_demo_001";

export interface Session {
  id: string;
  userId: string;
  wm: WorkingMemory;
  history: ConversationHistory;
  tracer: Tracer;
  auditLog: AuditLog;
  loop: AgentLoop;
  createdAt: number;
  /** Serialize turns so concurrent requests on the same session don't interleave. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

export interface SessionStore {
  create(userId?: string): Session;
  get(id: string): Session | undefined;
  delete(id: string): void;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  create(userId: string = DEMO_USER_ID): Session {
    const id = crypto.randomBytes(8).toString("hex");
    const wm = new WorkingMemory(id, userId);
    const history = new ConversationHistory();
    const registry = buildRegistry();
    const tracer = new Tracer(id);
    const auditLog = new AuditLog(id);
    const loop = new AgentLoop(wm, registry, tracer, auditLog);

    // Promise-chain ensures turns on this session execute strictly sequentially.
    let chain: Promise<unknown> = Promise.resolve();
    function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const next = chain.then(() => fn());
      // Swallow rejections on the shared chain so one failure doesn't block all future turns.
      chain = next.catch(() => undefined);
      return next;
    }

    const session: Session = { id, userId, wm, history, tracer, auditLog, loop, createdAt: Date.now(), runExclusive };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
