import type OpenAI from "openai";
import { VERBATIM_TURNS_TO_KEEP } from "../config.js";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

export class ConversationHistory {
  private messages: Message[] = [];

  addUser(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  addAssistant(message: OpenAI.Chat.ChatCompletionMessage): void {
    // Store the full message object (preserves tool_calls array)
    this.messages.push(message as Message);
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({ role: "tool", tool_call_id: toolCallId, content });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getTailMessages(n: number = VERBATIM_TURNS_TO_KEEP): Message[] {
    // Each user turn + assistant response = 1 exchange.
    // We keep the last n complete exchanges (2n messages) as verbatim history.
    return this.messages.slice(-n * 2);
  }

  // Returns all tool result content strings for use in output groundedness checks
  getToolResultContents(): string[] {
    return this.messages
      .filter((m): m is Extract<Message, { role: "tool" }> => m.role === "tool")
      .map((m) => (typeof m.content === "string" ? m.content : ""));
  }

  length(): number {
    return this.messages.length;
  }
}
