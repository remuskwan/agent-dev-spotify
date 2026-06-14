import type OpenAI from "openai";
import type { ToolEntry, ToolContext } from "../types.js";
import { searchKnowledgeTool } from "./searchKnowledge.js";
import { getAccountContextTool } from "./getAccountContext.js";
import { verifyIdentityTool } from "./verifyIdentity.js";
import { manageSubscriptionTool } from "./manageSubscription.js";
import { issueRefundTool } from "./issueRefund.js";
import { escalateToHumanTool } from "./escalateToHuman.js";

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>();

  register(entry: ToolEntry): void {
    const name = entry.spec.function.name;
    this.tools.set(name, entry);
  }

  getSpecs(): OpenAI.Chat.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((e) => e.spec);
  }

  isSensitive(toolName: string): boolean {
    return this.tools.get(toolName)?.sensitive === true;
  }

  async dispatch(toolName: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const entry = this.tools.get(toolName);
    if (!entry) {
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    try {
      return await entry.handler(args, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `Tool ${toolName} failed: ${msg}` });
    }
  }
}

export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(searchKnowledgeTool);
  registry.register(getAccountContextTool);
  registry.register(verifyIdentityTool);
  registry.register(manageSubscriptionTool);
  registry.register(issueRefundTool);
  registry.register(escalateToHumanTool);
  return registry;
}
