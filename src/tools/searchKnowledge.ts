import type OpenAI from "openai";
import { semanticSearch } from "../retrieval/ragRetriever.js";
import type { ToolContext, ToolEntry } from "../types.js";

const spec: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_knowledge",
    description:
      "Search the help center and policy knowledge base for information about plans, pricing, cancellation, refunds, " +
      "device limits, playback troubleshooting, and account security. Always call this before making factual/policy claims.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query, e.g. 'cancellation policy' or 'refund eligibility'",
        },
      },
      required: ["query"],
    },
  },
};

async function handler(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
  const query = String(args.query ?? "");
  const results = await semanticSearch(query);

  if (results.length === 0) {
    return JSON.stringify({ found: false, message: "No relevant knowledge base articles found for this query." });
  }

  const snippets = results.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
  }));

  return JSON.stringify({ found: true, snippets });
}

export const searchKnowledgeTool: ToolEntry = { spec, handler, sensitive: false };
