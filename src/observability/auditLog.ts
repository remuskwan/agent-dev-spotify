import fs from "fs";
import path from "path";
import { AUDIT_DIR } from "../config.js";
import type { AuditRecord, PolicyVerdict } from "../types.js";

const PII_KEYS = new Set(["otp", "token", "cardNumber", "ssn", "password"]);

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = PII_KEYS.has(k) ? "[REDACTED]" : v;
  }
  return out;
}

export class AuditLog {
  private conversationId: string;
  private records: AuditRecord[] = [];
  private auditDir: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
    this.auditDir = AUDIT_DIR;
    fs.mkdirSync(this.auditDir, { recursive: true });
  }

  record(params: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    policyVerdict: PolicyVerdict | null;
    confirmationToken: string | null;
    idempotencyKey: string | null;
    outcome: string;
  }): void {
    const entry: AuditRecord = {
      ts: new Date().toISOString(),
      conversationId: this.conversationId,
      userId: params.userId,
      action: params.action,
      argsRedacted: redactArgs(params.args),
      policyVerdict: params.policyVerdict,
      confirmationToken: params.confirmationToken,
      idempotencyKey: params.idempotencyKey,
      outcome: params.outcome,
    };
    this.records.push(entry);
    this.appendToFile(entry);
    process.stderr.write(`  📋 [audit] ${entry.action} → ${entry.outcome} (idempotencyKey=${entry.idempotencyKey})\n`);
  }

  private appendToFile(record: AuditRecord): void {
    const file = path.join(this.auditDir, `${this.conversationId}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  }

  getRecords(): AuditRecord[] {
    return [...this.records];
  }
}
