/**
 * Durable (cross-session) action history — §9.4 hardening.
 *
 * Per-session rate caps (`MAX_REFUNDS_PER_SESSION`, `MAX_PLAN_CHANGES_PER_SESSION`)
 * live in WorkingMemory and reset when a session ends. An attacker could therefore
 * evade them by simply starting a new session. This store records executed
 * money-moving actions keyed by `userId` and survives session deletion, so the
 * policy engine can enforce caps across sessions within the process lifetime.
 *
 * In production this would be the account backend / Redis (a write-through durable
 * store). Here it is an in-process singleton — the same role, demo-scoped. It is
 * deliberately separate from WorkingMemory so its lifetime is process-level, not
 * session-level.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

class DurableActionStore {
  private refunds = new Map<string, number[]>();
  private planChanges = new Map<string, number[]>();

  recordRefund(userId: string, at: number = Date.now()): void {
    this.append(this.refunds, userId, at);
  }

  recordPlanChange(userId: string, at: number = Date.now()): void {
    this.append(this.planChanges, userId, at);
  }

  refundsWithinDays(userId: string, days: number): number {
    return this.countWithin(this.refunds, userId, days);
  }

  planChangesWithinDays(userId: string, days: number): number {
    return this.countWithin(this.planChanges, userId, days);
  }

  /** Test hook — clears all durable history. */
  reset(): void {
    this.refunds.clear();
    this.planChanges.clear();
  }

  private append(map: Map<string, number[]>, userId: string, at: number): void {
    const list = map.get(userId) ?? [];
    list.push(at);
    map.set(userId, list);
  }

  private countWithin(map: Map<string, number[]>, userId: string, days: number): number {
    const cutoff = Date.now() - days * DAY_MS;
    return (map.get(userId) ?? []).filter((ts) => ts >= cutoff).length;
  }
}

export const durableActionStore = new DurableActionStore();
