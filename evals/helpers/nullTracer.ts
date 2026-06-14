import type { Span, SpanType } from "../../src/types.js";
import type { SpanHandle } from "../../src/observability/tracer.js";

export class NullTracer {
  readonly spans: Span[] = [];

  span(name: string, type: SpanType, attributes: Record<string, unknown>): SpanHandle {
    const startMs = Date.now();
    return {
      end: (endAttributes: Record<string, unknown> = {}) => {
        this.spans.push({
          name,
          type,
          startMs,
          endMs: Date.now(),
          durationMs: Date.now() - startMs,
          attributes: { ...attributes, ...endAttributes },
        });
      },
    };
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans.length = 0;
  }

  spansOfType(type: SpanType): Span[] {
    return this.spans.filter((s) => s.type === type);
  }

  spansNamed(name: string): Span[] {
    return this.spans.filter((s) => s.name === name);
  }
}
