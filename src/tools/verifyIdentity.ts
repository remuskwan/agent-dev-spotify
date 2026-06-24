import type OpenAI from "openai";
import { DEMO_ACCOUNT } from "../fixtures/accountFixture.js";
import { DEMO_OTP, MAX_OTP_ATTEMPTS } from "../config.js";
import type { ToolContext, ToolEntry } from "../types.js";

const spec: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "verify_identity",
    description:
      "Initiate or confirm step-up identity verification before any sensitive account action. " +
      "Call with action='initiate' to send an OTP, then action='confirm' with the user-provided OTP to verify. " +
      "This must be called and confirmed before manage_subscription or issue_refund.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["initiate", "confirm"],
          description: "'initiate' sends an OTP; 'confirm' validates it.",
        },
        otp: {
          type: "string",
          description: "The 6-digit OTP provided by the user (required when action='confirm').",
        },
      },
      required: ["action"],
    },
  },
};

async function handler(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const action = String(args.action ?? "");

  if (action === "initiate") {
    // §9.2: never re-issue codes once verification is locked from brute force.
    if (ctx.workingMemory.isOtpLocked()) {
      return JSON.stringify({
        status: "locked",
        message:
          "Identity verification is locked after multiple incorrect codes. " +
          "For your security, this requires a human support agent.",
      });
    }
    // Guard: if already verified this session, skip re-sending OTP
    if (ctx.workingMemory.isVerified()) {
      return JSON.stringify({
        status: "already_verified",
        message: "Your identity is already verified for this session — you can proceed.",
      });
    }
    // Store the issued code so confirm can validate against it (§9.2).
    ctx.workingMemory.setExpectedOtp(DEMO_OTP);
    process.stdout.write(`\n[DEMO] Your verification code is: ${DEMO_OTP}\n\n`);
    return JSON.stringify({
      status: "otp_sent",
      message: `A 6-digit verification code has been sent to ${DEMO_ACCOUNT.emailMasked}. Please enter it to continue.`,
    });
  }

  if (action === "confirm") {
    // §9.2: reject confirms outright once locked — no further OTP attempts.
    if (ctx.workingMemory.isOtpLocked()) {
      return JSON.stringify({
        status: "locked",
        message:
          "Identity verification is locked after multiple incorrect codes. " +
          "For your security, this requires a human support agent.",
      });
    }

    const otp = String(args.otp ?? "").trim();

    if (!/^\d{6}$/.test(otp)) {
      return JSON.stringify({
        status: "error",
        message: "Invalid OTP format. Please enter the 6-digit code sent to your email.",
      });
    }

    // Validate against the issued code. A mismatch is a failed attempt (§9.2);
    // MAX_OTP_ATTEMPTS failures lock the session and trigger escalation upstream.
    const expected = ctx.workingMemory.getExpectedOtp() ?? DEMO_OTP;
    if (otp !== expected) {
      const attempts = ctx.workingMemory.recordFailedOtp();
      if (ctx.workingMemory.isOtpLocked()) {
        return JSON.stringify({
          status: "locked",
          message:
            "That code was incorrect. Identity verification is now locked after too many " +
            "attempts. For your security, I'll connect you with a human support agent.",
        });
      }
      const remaining = MAX_OTP_ATTEMPTS - attempts;
      return JSON.stringify({
        status: "incorrect_otp",
        message: `That code was incorrect. Please try again. ${remaining} attempt(s) remaining.`,
      });
    }

    // Correct code — verify and clear the failed-attempt counter.
    ctx.workingMemory.resetOtpAttempts();
    const token = ctx.workingMemory.issueVerificationToken();
    return JSON.stringify({
      status: "verified",
      message: "Identity verified successfully. You may now proceed with sensitive account actions.",
      verificationToken: token,
    });
  }

  return JSON.stringify({ status: "error", message: "Invalid action. Use 'initiate' or 'confirm'." });
}

export const verifyIdentityTool: ToolEntry = { spec, handler, sensitive: false };
