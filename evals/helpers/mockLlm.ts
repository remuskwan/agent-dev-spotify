import type OpenAI from "openai";

type CompletionMessage = OpenAI.Chat.ChatCompletionMessage;

/** Queues up a sequence of LLM responses consumed one per complete() call. */
export class LlmSequence {
  private callCount = 0;

  constructor(private readonly responses: CompletionMessage[]) {
    if (responses.length === 0) throw new Error("LlmSequence requires at least one response");
  }

  next(): CompletionMessage {
    const idx = Math.min(this.callCount, this.responses.length - 1);
    this.callCount++;
    return this.responses[idx];
  }

  get calls(): number {
    return this.callCount;
  }
}

/** Builds a plain-text assistant reply (no tool calls). */
export function textReply(content: string): CompletionMessage {
  return { role: "assistant", content, tool_calls: undefined, refusal: null };
}

/** Builds an assistant message containing a single tool call. */
export function toolCallReply(
  toolName: string,
  args: Record<string, unknown>,
  id?: string
): CompletionMessage {
  const callId = id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [
      {
        id: callId,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      },
    ],
  };
}
