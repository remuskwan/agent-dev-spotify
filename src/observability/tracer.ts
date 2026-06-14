import fs from "fs";
import path from "path";
import { TRACES_DIR } from "../config.js";
import type { Span, SpanType } from "../types.js";

export class Tracer {
  private conversationId: string;
  private spans: Span[] = [];
  private tracesDir: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
    this.tracesDir = TRACES_DIR;
    fs.mkdirSync(this.tracesDir, { recursive: true });
  }

  span(name: string, type: SpanType, attributes: Record<string, unknown>): SpanHandle {
    const startMs = Date.now();
    return {
      end: (endAttributes: Record<string, unknown> = {}) => {
        const endMs = Date.now();
        const span: Span = {
          name,
          type,
          startMs,
          endMs,
          durationMs: endMs - startMs,
          attributes: { ...attributes, ...endAttributes },
        };
        this.spans.push(span);
        this.emit(span);
        this.appendToFile(span);
      },
    };
  }

  private emit(span: Span): void {
    const dur = `${span.durationMs}ms`;
    const icon = { turn: "↻", llm: "🤖", tool: "🔧", guardrail: "🛡" }[span.type] ?? "•";
    const attrs = Object.entries(span.attributes)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    process.stderr.write(`  ${icon} [${span.type}] ${span.name} (${dur}) ${attrs}\n`);
  }

  private appendToFile(span: Span): void {
    const file = path.join(this.tracesDir, `${this.conversationId}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ conversationId: this.conversationId, ...span }) + "\n");
  }

  getSpans(): Span[] {
    return [...this.spans];
  }
}

export interface SpanHandle {
  end(attributes?: Record<string, unknown>): void;
}
