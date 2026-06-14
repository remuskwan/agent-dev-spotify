import OpenAI from "openai";
import { OPENAI_API_KEY, TRIAGE_MODEL, CAPABLE_MODEL, MAX_OUTPUT_TOKENS } from "./config.js";
import type { IntentRisk } from "./types.js";

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

export function routeModel(risk: IntentRisk): string {
  return risk === "sensitive" ? CAPABLE_MODEL : TRIAGE_MODEL;
}

export async function complete(params: {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  model?: string;
  maxTokens?: number;
}): Promise<OpenAI.Chat.ChatCompletionMessage> {
  const response = await client.chat.completions.create({
    model: params.model ?? TRIAGE_MODEL,
    messages: params.messages,
    tools: params.tools && params.tools.length > 0 ? params.tools : undefined,
    tool_choice: params.tools && params.tools.length > 0 ? "auto" : undefined,
    temperature: 0.2,
    max_tokens: params.maxTokens ?? MAX_OUTPUT_TOKENS,
  });

  return response.choices[0].message;
}

export type { OpenAI };
