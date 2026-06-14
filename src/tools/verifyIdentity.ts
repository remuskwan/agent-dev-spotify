import type OpenAI from "openai";
import { DEMO_ACCOUNT } from "../fixtures/accountFixture.js";
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
    // Guard: if already verified this session, skip re-sending OTP
    if (ctx.workingMemory.isVerified()) {
      return JSON.stringify({
        status: "already_verified",
        message: "Your identity is already verified for this session — you can proceed.",
      });
    }
    const demoOtp = "123456";
    process.stdout.write(`\n[DEMO] Your verification code is: ${demoOtp}\n\n`);
    return JSON.stringify({
      status: "otp_sent",
      message: `A 6-digit verification code has been sent to ${DEMO_ACCOUNT.emailMasked}. Please enter it to continue.`,
    });
  }

  if (action === "confirm") {
    const otp = String(args.otp ?? "").trim();

    if (!/^\d{6}$/.test(otp)) {
      return JSON.stringify({
        status: "error",
        message: "Invalid OTP format. Please enter the 6-digit code sent to your email.",
      });
    }

    // Demo: any 6-digit code is accepted
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
