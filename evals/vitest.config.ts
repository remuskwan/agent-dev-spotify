import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config(); // load .env before resolving env overrides

export default defineConfig({
  test: {
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test-key-not-real",
      TRACES_DIR: "/tmp/eval-traces",
      AUDIT_DIR: "/tmp/eval-audit",
    },
    setupFiles: ["./evals/setup.ts"],
    include: ["evals/suites/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
