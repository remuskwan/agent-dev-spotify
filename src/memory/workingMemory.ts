import crypto from "crypto";
import { VERIFICATION_TOKEN_TTL_MS, MAX_OTP_ATTEMPTS } from "../config.js";
import type { WorkingMemoryState, PendingAction, PolicyVerdict } from "../types.js";

export class WorkingMemory {
  private state: WorkingMemoryState;

  constructor(conversationId: string, userId: string) {
    this.state = {
      conversationId,
      userId,
      identityVerified: false,
      verificationToken: null,
      verificationTokenExpiry: null,
      expectedOtp: null,
      failedOtpAttempts: 0,
      otpLocked: false,
      pendingAction: null,
      confirmationToken: null,
      idempotencyKey: null,
      policyVerdict: null,
      refundsIssuedThisSession: 0,
      planChangesThisSession: 0,
      consecutiveGuardrailBlocks: 0,
      idempotencyStore: {},
      escalated: false,
    };
  }

  // ── Identity ────────────────────────────────────────────────────────────────

  issueVerificationToken(): string {
    const token = crypto.randomBytes(24).toString("hex");
    this.state.verificationToken = token;
    this.state.verificationTokenExpiry = Date.now() + VERIFICATION_TOKEN_TTL_MS;
    this.state.identityVerified = true;
    return token;
  }

  isVerified(): boolean {
    return (
      this.state.identityVerified &&
      this.state.verificationToken !== null &&
      this.state.verificationTokenExpiry !== null &&
      Date.now() < this.state.verificationTokenExpiry
    );
  }

  consumeVerificationToken(): void {
    this.state.verificationToken = null;
    this.state.verificationTokenExpiry = null;
    this.state.identityVerified = false;
  }

  // ── OTP brute-force protection (§9.2) ────────────────────────────────────────

  setExpectedOtp(otp: string): void {
    this.state.expectedOtp = otp;
  }

  getExpectedOtp(): string | null {
    return this.state.expectedOtp;
  }

  /** Record a failed OTP attempt; locks the session once the cap is reached. */
  recordFailedOtp(): number {
    this.state.failedOtpAttempts++;
    if (this.state.failedOtpAttempts >= MAX_OTP_ATTEMPTS) {
      this.state.otpLocked = true;
    }
    return this.state.failedOtpAttempts;
  }

  getFailedOtpAttempts(): number {
    return this.state.failedOtpAttempts;
  }

  isOtpLocked(): boolean {
    return this.state.otpLocked;
  }

  resetOtpAttempts(): void {
    this.state.failedOtpAttempts = 0;
  }

  // ── Pending action / confirmation ───────────────────────────────────────────

  setPendingAction(action: Omit<PendingAction, "confirmed">): string {
    const token = crypto.randomBytes(16).toString("hex");
    this.state.pendingAction = { ...action, confirmed: false };
    this.state.confirmationToken = token;
    return token;
  }

  getPendingAction(): PendingAction | null {
    return this.state.pendingAction;
  }

  armConfirmation(): void {
    if (this.state.pendingAction) {
      this.state.pendingAction = { ...this.state.pendingAction, confirmed: true };
    }
  }

  isConfirmed(): boolean {
    return this.state.pendingAction?.confirmed === true;
  }

  consumePendingAction(): PendingAction | null {
    const action = this.state.pendingAction;
    this.state.pendingAction = null;
    this.state.confirmationToken = null;
    this.state.idempotencyKey = null;
    this.state.policyVerdict = null;
    return action;
  }

  getConfirmationToken(): string | null {
    return this.state.confirmationToken;
  }

  // ── Idempotency ─────────────────────────────────────────────────────────────

  mintIdempotencyKey(actionType: string): string {
    // Deterministic from actionType + pending action args so same action = same key
    const actionArgs = this.state.pendingAction
      ? JSON.stringify(this.state.pendingAction.args)
      : "";
    const raw = `${actionType}::${this.state.conversationId}::${actionArgs}`;
    const key = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
    this.state.idempotencyKey = key;
    return key;
  }

  getIdempotencyKey(): string | null {
    return this.state.idempotencyKey;
  }

  getCachedResult(key: string): string | undefined {
    return this.state.idempotencyStore[key];
  }

  cacheResult(key: string, result: string): void {
    this.state.idempotencyStore[key] = result;
  }

  // ── Policy ──────────────────────────────────────────────────────────────────

  setPolicyVerdict(verdict: PolicyVerdict): void {
    this.state.policyVerdict = verdict;
  }

  getPolicyVerdict(): PolicyVerdict | null {
    return this.state.policyVerdict;
  }

  clearPolicyVerdict(): void {
    this.state.policyVerdict = null;
  }

  // ── Rate caps ───────────────────────────────────────────────────────────────

  incrementRefundCount(): void {
    this.state.refundsIssuedThisSession++;
  }

  getRefundCount(): number {
    return this.state.refundsIssuedThisSession;
  }

  incrementPlanChangeCount(): void {
    this.state.planChangesThisSession++;
  }

  getPlanChangeCount(): number {
    return this.state.planChangesThisSession;
  }

  // ── Guardrail block counter ─────────────────────────────────────────────────

  recordGuardrailBlock(): void {
    this.state.consecutiveGuardrailBlocks++;
  }

  resetGuardrailBlocks(): void {
    this.state.consecutiveGuardrailBlocks = 0;
  }

  getConsecutiveGuardrailBlocks(): number {
    return this.state.consecutiveGuardrailBlocks;
  }

  // ── Escalation ──────────────────────────────────────────────────────────────

  setEscalated(): void {
    this.state.escalated = true;
  }

  isEscalated(): boolean {
    return this.state.escalated;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  getUserId(): string {
    return this.state.userId;
  }

  getConversationId(): string {
    return this.state.conversationId;
  }

  // ── Serialization (for crash-safe resume) ───────────────────────────────────

  serialize(): WorkingMemoryState {
    return { ...this.state, idempotencyStore: { ...this.state.idempotencyStore } };
  }

  static deserialize(state: WorkingMemoryState): WorkingMemory {
    const wm = new WorkingMemory(state.conversationId, state.userId);
    wm.state = { ...state };
    return wm;
  }
}
