import type { AuditRecord, PolicyVerdict } from "../../src/types.js";

export class NullAuditLog {
  private records: AuditRecord[] = [];

  record(params: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    policyVerdict: PolicyVerdict | null;
    confirmationToken: string | null;
    idempotencyKey: string | null;
    outcome: string;
  }): void {
    this.records.push({
      ts: new Date().toISOString(),
      conversationId: "test",
      userId: params.userId,
      action: params.action,
      argsRedacted: params.args,
      policyVerdict: params.policyVerdict,
      confirmationToken: params.confirmationToken,
      idempotencyKey: params.idempotencyKey,
      outcome: params.outcome,
    });
  }

  getRecords(): AuditRecord[] {
    return [...this.records];
  }

  recordsFor(action: string): AuditRecord[] {
    return this.records.filter((r) => r.action === action);
  }

  clear(): void {
    this.records.length = 0;
  }
}
