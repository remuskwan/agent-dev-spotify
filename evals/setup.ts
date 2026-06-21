// Runs in each worker before any test — ensure env vars satisfy config.ts before it loads
process.env.OPENAI_API_KEY ??= "test-key-not-real";
process.env.TRACES_DIR ??= "/tmp/eval-traces";
process.env.AUDIT_DIR ??= "/tmp/eval-audit";

// Disable embedding init in CI — keyword fallback keeps tests fast and offline.
// In live mode (EVAL_MODE=live) the real embeddings path is used.
if (process.env.EVAL_MODE !== "live") {
  process.env.EMBEDDING_ENABLED ??= "false";
}
