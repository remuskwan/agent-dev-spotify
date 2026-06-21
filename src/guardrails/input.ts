import type { InputGuardrailResult, IntentRisk } from "../types.js";

// PCI-DSS: block raw card numbers before they reach the LLM
const CARD_NUMBER_REGEX = /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/;

// Simple injection detection patterns
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /you are now/i,
  /pretend (?:you are|to be (?:a |an |the ))/i,
  /disregard (your|the) (system|instructions|guidelines)/i,
  /\[system\]/i,
  /act as (an? )?(unrestricted|jailbroken|evil|dAN)/i,
  /override (all )?(previous|prior|above)? ?(instructions|guidelines|constraints|rules|policies)/i,
  /forget (your|all|these)? ?(instructions|guidelines|constraints|rules|training)/i,
];

// Strong action keywords → always sensitive regardless of phrasing
const SENSITIVE_ACTION_KEYWORDS = [
  "cancel", "cancellation", "refund", "charge", "charged", "overcharged",
  "upgrade", "downgrade", "plan change", "switch plan",
  "payment", "credit card", "debit card", "account number",
  "password", "security", "hacked", "unauthorized",
];

// Topic keywords → sensitive only when NOT a pure WH-question (avoids over-routing info queries)
const SENSITIVE_TOPIC_KEYWORDS = ["billing", "subscription"];

const WH_QUESTION_REGEX = /^(what|which|how|why|when|where|who)\b/i;

function classifyIntent(text: string): IntentRisk {
  const lower = text.toLowerCase();
  if (SENSITIVE_ACTION_KEYWORDS.some((kw) => lower.includes(kw))) return "sensitive";
  if (SENSITIVE_TOPIC_KEYWORDS.some((kw) => lower.includes(kw))) {
    return WH_QUESTION_REGEX.test(lower.trim()) ? "info" : "sensitive";
  }
  return "info";
}

export function runInputGuardrails(userMessage: string): InputGuardrailResult {
  // 1. PII / card number detection
  if (CARD_NUMBER_REGEX.test(userMessage)) {
    return {
      blocked: true,
      reason:
        "For your security, please do not share credit or debit card numbers in chat. " +
        "To update your payment method, go to Account Settings > Payment.",
      intentRisk: "sensitive",
      hasPii: true,
    };
  }

  // 2. Prompt injection detection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(userMessage)) {
      return {
        blocked: true,
        reason: "I'm unable to process that request. How can I help you with your account today?",
        intentRisk: "sensitive",
        hasPii: false,
      };
    }
  }

  // 3. Intent classification
  const intentRisk = classifyIntent(userMessage);

  return { blocked: false, intentRisk, hasPii: false };
}
