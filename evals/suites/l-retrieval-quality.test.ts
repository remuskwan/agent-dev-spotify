/**
 * Suite L — Retrieval Quality
 *
 * Gate: quality bar (no hard %). Asserts top-1 article correctness for
 * semantic paraphrases that the keyword scorer misses or ranks poorly.
 *
 * Live-only (EVAL_MODE=live): requires real embeddings via OPENAI_API_KEY.
 * Skipped in CI — the keyword fallback path is exercised by Suite A.
 */

import { describe, it, expect, afterAll } from "vitest";
import { semanticSearch, resetRetriever } from "../../src/retrieval/ragRetriever.js";

const isLive = process.env.EVAL_MODE === "live";

afterAll(() => {
  // Reset singleton so subsequent test workers get a clean slate
  resetRetriever();
});

describe("Suite L — Retrieval Quality", () => {
  it.skipIf(!isLive)("L1: semantic paraphrase 'I was double charged' → kb-003 (Refund Policy)", async () => {
    const results = await semanticSearch("I was double charged", 3);
    expect(results[0]?.id).toBe("kb-003");
  });

  it.skipIf(!isLive)("L2: paraphrase 'stream on two devices at once' → kb-004 (Device Limit)", async () => {
    const results = await semanticSearch("stream on two devices at once", 3);
    expect(results[0]?.id).toBe("kb-004");
  });

  it.skipIf(!isLive)("L3: paraphrase 'app keeps freezing' → kb-005 (Playback Troubleshooting)", async () => {
    const results = await semanticSearch("app keeps freezing", 3);
    expect(results[0]?.id).toBe("kb-005");
  });

  it.skipIf(!isLive)("L4: paraphrase 'someone logged into my account' → kb-006 (Account Security)", async () => {
    const results = await semanticSearch("someone logged into my account", 3);
    expect(results[0]?.id).toBe("kb-006");
  });

  it.skipIf(!isLive)("L5: paraphrase 'how do I stop paying' → kb-002 (Cancellation Policy)", async () => {
    const results = await semanticSearch("how do I stop paying", 3);
    expect(results[0]?.id).toBe("kb-002");
  });

  it.skipIf(!isLive)("L6: paraphrase 'move up to the family tier' → kb-001 or kb-008 (Plans / Plan Upgrade)", async () => {
    const results = await semanticSearch("move up to the family tier", 3);
    expect(["kb-001", "kb-008"]).toContain(results[0]?.id);
  });

  it.skipIf(!isLive)("L7: exact keyword still works — 'refund policy' → kb-003 in hybrid mode", async () => {
    const results = await semanticSearch("refund policy", 3);
    expect(results[0]?.id).toBe("kb-003");
  });

  it.skipIf(!isLive)("L8: hybrid returns 3 results for any query", async () => {
    const results = await semanticSearch("help me", 3);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.id).toMatch(/^kb-\d{3}$/);
    }
  });
});
