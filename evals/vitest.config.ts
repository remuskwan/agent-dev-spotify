import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      OPENAI_API_KEY: "test-key-not-real",
      TRACES_DIR: "/tmp/eval-traces",
      AUDIT_DIR: "/tmp/eval-audit",
    },
    setupFiles: ["./evals/setup.ts"],
    include: ["evals/suites/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
