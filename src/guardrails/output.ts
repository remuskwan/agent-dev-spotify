import type { OutputGuardrailResult } from "../types.js";

// Phrases the agent should never commit to (no-promise rule, DESIGN §0.4)
const NO_PROMISE_PATTERNS = [
  /i'?ll waive/i,
  /i can (give|offer) you (a )?special/i,
  /special discount/i,
  /make an exception/i,
  /i'?ll make (it|this) right/i,
  /as a (one-time )?courtesy/i,
  /we (can|will) refund (you )?any/i,
  /i'?ll (personally )?ensure/i,
];

// Claim detectors — if the response contains these, we check for grounding
const DOLLAR_AMOUNT_REGEX = /\$[\d,.]+/g;
const PLAN_NAMES_REGEX = /\b(Individual|Duo|Family|Free)\s+plan\b/gi;
const POLICY_CLAIM_PHRASES = [
  "within 7 days",
  "30-day",
  "eligible for a refund",
  "billing cycle",
  "per month",
  "/mo",
  "device limit",
  "refund policy",
];

function hasGrounding(claim: string, groundingSources: string[]): boolean {
  const claimLower = claim.toLowerCase();
  return groundingSources.some((src) => src.toLowerCase().includes(claimLower));
}

export function runOutputGuardrails(
  responseText: string,
  groundingSources: string[] // RAG snippets + tool result strings from this turn
): OutputGuardrailResult {
  // 1. No-promise check
  for (const pattern of NO_PROMISE_PATTERNS) {
    if (pattern.test(responseText)) {
      return {
        blocked: true,
        reason: `Response contains a disallowed commitment. Pattern matched: ${pattern.source}`,
      };
    }
  }

  // 2. Groundedness check for policy claim phrases
  for (const phrase of POLICY_CLAIM_PHRASES) {
    if (responseText.toLowerCase().includes(phrase.toLowerCase())) {
      if (!hasGrounding(phrase, groundingSources)) {
        return {
          blocked: true,
          reason: `Ungrounded policy claim detected: "${phrase}" not found in retrieved sources or tool results.`,
        };
      }
    }
  }

  // 3. Dollar amount grounding — check each dollar figure appears in a grounding source
  const dollarMatches = responseText.match(DOLLAR_AMOUNT_REGEX) ?? [];
  for (const amount of dollarMatches) {
    if (!hasGrounding(amount, groundingSources)) {
      return {
        blocked: true,
        reason: `Ungrounded dollar amount: ${amount} not found in retrieved sources or tool results.`,
      };
    }
  }

  return { blocked: false };
}
