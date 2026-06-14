import { REFUND_CAP_USD, MAX_REFUNDS_PER_SESSION, MAX_PLAN_CHANGES_PER_SESSION } from "../config.js";
import { DEMO_ACCOUNT } from "../fixtures/accountFixture.js";
import type { WorkingMemory } from "../memory/workingMemory.js";
import type { ActionGuardrailOutcome, PolicyVerdict } from "../types.js";

const VALID_PLAN_TRANSITIONS: Record<string, string[]> = {
  free: ["individual", "duo", "family"],
  individual: ["free", "duo", "family"],
  duo: ["free", "individual", "family"],
  family: ["free", "individual", "duo"],
};

function runPolicyEngine(
  toolName: string,
  args: Record<string, unknown>,
  wm: WorkingMemory
): PolicyVerdict {
  if (toolName === "issue_refund") {
    if (!DEMO_ACCOUNT.isEligibleForRefund) {
      return { allowed: false, reason: "Account is not eligible for a refund at this time." };
    }
    if (DEMO_ACCOUNT.refundsIssuedLast90Days >= 1) {
      return { allowed: false, reason: "A refund has already been issued within the last 90 days." };
    }
    if (wm.getRefundCount() >= MAX_REFUNDS_PER_SESSION) {
      return { allowed: false, reason: `Refund limit (${MAX_REFUNDS_PER_SESSION}) reached for this session.` };
    }
    const refundAmount = Math.min(DEMO_ACCOUNT.lastChargeAmount, REFUND_CAP_USD);
    return { allowed: true, reason: "Eligible for refund", refundAmountUsd: refundAmount };
  }

  if (toolName === "manage_subscription") {
    const action = String(args.action ?? "");

    if (wm.getPlanChangeCount() >= MAX_PLAN_CHANGES_PER_SESSION) {
      return { allowed: false, reason: `Plan change limit (${MAX_PLAN_CHANGES_PER_SESSION}) reached for this session.` };
    }

    if (action === "cancel") {
      return { allowed: true, reason: "Cancellation is permitted." };
    }

    if (action === "upgrade" || action === "downgrade" || action === "start") {
      const target = String(args.targetPlan ?? "");
      const allowed = VALID_PLAN_TRANSITIONS[DEMO_ACCOUNT.plan]?.includes(target) ?? false;
      return allowed
        ? { allowed: true, reason: `Plan change to ${target} is permitted.` }
        : { allowed: false, reason: `Cannot change from ${DEMO_ACCOUNT.plan} to ${target}.` };
    }

    return { allowed: false, reason: `Unknown subscription action: ${action}` };
  }

  // Unknown sensitive tool — fail closed
  return { allowed: false, reason: `No policy defined for tool: ${toolName}` };
}

function buildConfirmationSummary(toolName: string, args: Record<string, unknown>, verdict: PolicyVerdict): string {
  if (toolName === "issue_refund") {
    return (
      `You are requesting a refund of $${(verdict.refundAmountUsd ?? 0).toFixed(2)} ` +
      `for your most recent charge of $${DEMO_ACCOUNT.lastChargeAmount.toFixed(2)} on ${DEMO_ACCOUNT.lastChargeDate}. ` +
      `The refund will be credited to your card ending in [XXXX] within 5–10 business days. ` +
      `Reply "yes" to confirm, or "no" to cancel.`
    );
  }

  if (toolName === "manage_subscription") {
    const action = String(args.action ?? "");
    if (action === "cancel") {
      return (
        `You are requesting to cancel your ${DEMO_ACCOUNT.plan} plan ($${DEMO_ACCOUNT.planPrice}/mo). ` +
        `Your access will continue until ${DEMO_ACCOUNT.nextBillingDate}, after which your account reverts to Free. ` +
        `Reply "yes" to confirm cancellation, or "no" to keep your subscription.`
      );
    }
    const target = String(args.targetPlan ?? "");
    return (
      `You are requesting to change your plan to ${target}. ` +
      `Reply "yes" to confirm, or "no" to cancel.`
    );
  }

  return `Please confirm you want to proceed with ${toolName}. Reply "yes" or "no".`;
}

export async function runActionGuardrails(
  toolName: string,
  args: Record<string, unknown>,
  wm: WorkingMemory
): Promise<ActionGuardrailOutcome> {
  try {
    // ── Step 1: Identity verification ────────────────────────────────────────
    if (!wm.isVerified()) {
      wm.recordGuardrailBlock();
      return {
        approved: false,
        reason: "identity_required",
        message: "Identity verification is required before this action. Please call verify_identity first.",
      };
    }

    // ── Step 2: Authorization scope ───────────────────────────────────────────
    // If args include a userId, it must match the session user
    if (args.userId !== undefined && String(args.userId) !== wm.getUserId()) {
      wm.recordGuardrailBlock();
      return {
        approved: false,
        reason: "policy_denied",
        message: "You can only perform actions on your own account.",
      };
    }
    // Default args to session user
    const enrichedArgs = { ...args, userId: wm.getUserId() };

    // ── Step 3: Policy engine ─────────────────────────────────────────────────
    const verdict = runPolicyEngine(toolName, enrichedArgs, wm);
    if (!verdict.allowed) {
      wm.recordGuardrailBlock();
      wm.clearPolicyVerdict();
      return {
        approved: false,
        reason: "policy_denied",
        message: `Policy denied: ${verdict.reason}`,
      };
    }
    wm.setPolicyVerdict(verdict);

    // ── Step 4: Confirmation ──────────────────────────────────────────────────
    const pending = wm.getPendingAction();

    if (!pending) {
      // First time — set pending action and demand confirmation
      const summary = buildConfirmationSummary(toolName, enrichedArgs, verdict);
      wm.setPendingAction({
        type: toolName as "manage_subscription" | "issue_refund",
        args: enrichedArgs,
        summary,
      });
      wm.recordGuardrailBlock();
      return {
        approved: false,
        reason: "confirmation_required",
        message: summary,
      };
    }

    if (!wm.isConfirmed()) {
      // Pending action exists but user hasn't confirmed — re-show summary
      wm.recordGuardrailBlock();
      return {
        approved: false,
        reason: "confirmation_required",
        message: pending.summary,
      };
    }

    // ── Step 5: Rate caps (defense-in-depth re-assertion) ─────────────────────
    if (toolName === "issue_refund" && wm.getRefundCount() >= MAX_REFUNDS_PER_SESSION) {
      wm.recordGuardrailBlock();
      return {
        approved: false,
        reason: "policy_denied",
        message: `Refund limit (${MAX_REFUNDS_PER_SESSION}) reached for this session.`,
      };
    }
    if (toolName === "manage_subscription" && wm.getPlanChangeCount() >= MAX_PLAN_CHANGES_PER_SESSION) {
      wm.recordGuardrailBlock();
      return {
        approved: false,
        reason: "policy_denied",
        message: `Plan change limit (${MAX_PLAN_CHANGES_PER_SESSION}) reached for this session.`,
      };
    }

    // ── Step 6: Idempotency ───────────────────────────────────────────────────
    const idempotencyKey = wm.mintIdempotencyKey(toolName);
    const cached = wm.getCachedResult(idempotencyKey);
    if (cached) {
      // Already executed — return cached result directly (caller handles this)
      wm.resetGuardrailBlocks();
      return {
        approved: true,
        enrichedArgs: { ...enrichedArgs, _idempotencyKey: idempotencyKey, _cachedResult: cached },
      };
    }

    wm.resetGuardrailBlocks();
    return {
      approved: true,
      enrichedArgs: { ...enrichedArgs, _idempotencyKey: idempotencyKey },
    };
  } catch (err) {
    // Fail closed — any unexpected error in guardrail logic → deny
    wm.recordGuardrailBlock();
    const msg = err instanceof Error ? err.message : String(err);
    return {
      approved: false,
      reason: "policy_denied",
      message: `Guardrail error (fail closed): ${msg}`,
    };
  }
}
