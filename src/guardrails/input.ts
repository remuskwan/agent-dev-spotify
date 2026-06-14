import type { InputGuardrailResult, IntentRisk } from "../types.js";

// PCI-DSS: block raw card numbers before they reach the LLM
const CARD_NUMBER_REGEX = /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/;

// Simple injection detection patterns
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /you are now/i,
  /pretend (you are|to be)/i,
  /disregard (your|the) (system|instructions|guidelines)/i,
  /\[system\]/i,
  /act as (an? )?(unrestricted|jailbroken|evil|dAN)/i,
];

// Keywords that classify a turn as sensitive (drives model routing)
const SENSITIVE_KEYWORDS = [
  "cancel", "cancellation", "refund", "charge", "charged", "overcharged",
  "upgrade", "downgrade", "billing", "subscription", "plan change", "switch plan",
  "payment", "credit card", "debit card", "account number",
  "password", "security", "hacked", "unauthorized",
];

function classifyIntent(text: string): IntentRisk {
  const lower = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw)) ? "sensitive" : "info";
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
