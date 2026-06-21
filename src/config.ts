import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");

export const TRIAGE_MODEL = "gpt-4o-mini";
export const CAPABLE_MODEL = "gpt-4o-mini";

export const MAX_TOOL_ITERS = 8;
export const MAX_INPUT_TOKENS = 16_000;
export const MAX_OUTPUT_TOKENS = 1_024;
export const VERBATIM_TURNS_TO_KEEP = 10;

export const REFUND_CAP_USD = 50;
export const MAX_REFUNDS_PER_SESSION = 1;
export const MAX_PLAN_CHANGES_PER_SESSION = 1;

export const VERIFICATION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const MAX_CONSECUTIVE_GUARDRAIL_BLOCKS = 3;

export const TRACES_DIR = "./traces";
export const AUDIT_DIR = "./audit";

export const PORT = parseInt(process.env["PORT"] ?? "8787", 10);
export const CORS_ORIGIN = process.env["CORS_ORIGIN"] ?? "*";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_ENABLED = process.env["EMBEDDING_ENABLED"] !== "false";
export const HYBRID_ALPHA = Number(process.env["HYBRID_ALPHA"] ?? 0.5);
