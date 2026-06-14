import readline from "readline";
import crypto from "crypto";
import { AgentLoop } from "./agentLoop.js";
import { ConversationHistory } from "./memory/conversationHistory.js";
import { WorkingMemory } from "./memory/workingMemory.js";
import { buildRegistry } from "./tools/registry.js";
import { Tracer } from "./observability/tracer.js";
import { AuditLog } from "./observability/auditLog.js";

const DEMO_USER_ID = "user_demo_001";

function banner(): void {
  console.log("\n─────────────────────────────────────────────────────────");
  console.log("  Streamify Virtual Support Assistant (AI Agent Demo)");
  console.log("─────────────────────────────────────────────────────────");
  console.log("  Demo account: Individual plan ($9.99/mo)");
  console.log("  Try: 'What plans do you offer?'");
  console.log("       'I want to cancel my subscription'");
  console.log("       'I need a refund'");
  console.log("  Type 'exit' or Ctrl+C to quit.");
  console.log("─────────────────────────────────────────────────────────\n");
  console.log("  [Trace/audit output appears on stderr in dim text]");
  console.log("─────────────────────────────────────────────────────────\n");
}

function printAgentReply(reply: string): void {
  console.log(`\nAgent: ${reply}\n`);
}

function printToolLogs(logs: string[]): void {
  if (logs.length === 0) return;
  for (const log of logs) {
    process.stderr.write(`  │ ${log}\n`);
  }
}

async function main(): Promise<void> {
  banner();

  const conversationId = crypto.randomBytes(8).toString("hex");
  const wm = new WorkingMemory(conversationId, DEMO_USER_ID);
  const history = new ConversationHistory();
  const registry = buildRegistry();
  const tracer = new Tracer(conversationId);
  const auditLog = new AuditLog(conversationId);
  const loop = new AgentLoop(wm, registry, tracer, auditLog);

  process.stderr.write(`\n[session] conversationId=${conversationId}\n\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const prompt = (): void => {
    rl.question("You: ", async (input) => {
      const message = input.trim();

      if (!message) {
        prompt();
        return;
      }

      if (message.toLowerCase() === "exit" || message.toLowerCase() === "quit") {
        printSessionSummary(wm, auditLog);
        rl.close();
        return;
      }

      try {
        process.stderr.write(`\n[turn start]\n`);
        const result = await loop.chat(history, message);
        printToolLogs(result.toolLogs);
        printAgentReply(result.reply);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n[error] ${msg}\n`);
      }

      prompt();
    });
  };

  rl.on("close", () => {
    process.exit(0);
  });

  prompt();
}

function printSessionSummary(wm: WorkingMemory, auditLog: AuditLog): void {
  const state = wm.serialize();
  console.log("\n─────────────────────────────────────────────────────────");
  console.log("  Session Summary");
  console.log("─────────────────────────────────────────────────────────");
  console.log(`  Identity verified:   ${state.identityVerified}`);
  console.log(`  Plan changes:        ${state.planChangesThisSession}`);
  console.log(`  Refunds issued:      ${state.refundsIssuedThisSession}`);
  console.log(`  Escalated:           ${state.escalated}`);
  console.log(`  Audit records:       ${auditLog.getRecords().length}`);
  console.log("─────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
