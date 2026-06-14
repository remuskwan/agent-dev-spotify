/**
 * Suite K — Server Concurrency
 *
 * CI-safe. Verifies that the per-session `runExclusive` mechanism serializes
 * concurrent turns and prevents interleaving that caused the orphaned
 * `input_guardrails` event in conversation d93493f0786dcc9f.
 *
 * K1: Two overlapping runExclusive calls on one session execute sequentially
 * K2: A rejection in one turn does not block subsequent turns on that session
 * K3: Two sessions are independent — concurrent calls on different sessions don't block each other
 */

import { describe, it, expect } from "vitest";
import { InMemorySessionStore } from "../../src/service/sessionStore.js";

describe("Suite K — Server Concurrency: per-session turn serialization", () => {
  describe("K1: Concurrent turns on the same session execute strictly sequentially", () => {
    it("the second call only starts after the first resolves", async () => {
      const store = new InMemorySessionStore();
      const session = store.create("user_test_k1");

      const order: string[] = [];

      // Call A: starts immediately, takes 20ms
      const callA = session.runExclusive(async () => {
        order.push("A:start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("A:end");
        return "a";
      });

      // Call B: queued behind A
      const callB = session.runExclusive(async () => {
        order.push("B:start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("B:end");
        return "b";
      });

      const [a, b] = await Promise.all([callA, callB]);

      expect(a).toBe("a");
      expect(b).toBe("b");
      // B must not start until A has finished
      expect(order).toEqual(["A:start", "A:end", "B:start", "B:end"]);
    });

    it("three queued calls execute in submission order", async () => {
      const store = new InMemorySessionStore();
      const session = store.create("user_test_k1b");

      const order: number[] = [];
      const calls = [1, 2, 3].map((n) =>
        session.runExclusive(async () => {
          order.push(n);
          await new Promise((r) => setTimeout(r, 5));
          return n;
        })
      );

      await Promise.all(calls);
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("K2: A rejection does not permanently block the session", () => {
    it("subsequent turns still execute after one turn throws", async () => {
      const store = new InMemorySessionStore();
      const session = store.create("user_test_k2");

      // First call throws
      const failingCall = session.runExclusive(async () => {
        throw new Error("turn failed");
      });
      await expect(failingCall).rejects.toThrow("turn failed");

      // Second call should still run normally
      const result = await session.runExclusive(async () => "recovered");
      expect(result).toBe("recovered");
    });
  });

  describe("K3: Independent sessions do not block each other", () => {
    it("a long-running turn on session A does not delay a turn on session B", async () => {
      const store = new InMemorySessionStore();
      const sessionA = store.create("user_test_k3a");
      const sessionB = store.create("user_test_k3b");

      const order: string[] = [];

      // Session A takes 30ms
      const callA = sessionA.runExclusive(async () => {
        order.push("A:start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("A:end");
        return "a";
      });

      // Session B fires 5ms later and should complete before A finishes
      await new Promise((r) => setTimeout(r, 5));
      const callB = sessionB.runExclusive(async () => {
        order.push("B:start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("B:end");
        return "b";
      });

      await Promise.all([callA, callB]);

      // B should complete before A since they don't share a queue
      expect(order).toEqual(["A:start", "B:start", "B:end", "A:end"]);
    });
  });
});
