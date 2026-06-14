"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Span, AuditRecord, SafeWorkingMemory } from "@/lib/types";

type TabKey = "timeline" | "memory" | "audit";

// Per-type accent color (CSS var token names).
const TYPE_COLOR: Record<string, string> = {
  turn: "var(--cyan)",
  llm: "var(--llm)",
  tool: "var(--signal)",
  guardrail: "var(--caution)",
};

const TYPE_LABEL: Record<string, string> = {
  turn: "TURN",
  llm: "LLM",
  tool: "TOOL",
  guardrail: "GUARD",
};

function guardrailVerdict(span: Span): { label: string; color: string } | null {
  if (span.type !== "guardrail") {
    if (span.type === "tool" && span.attributes.outcome) {
      return { label: String(span.attributes.outcome), color: "var(--text-dim)" };
    }
    return null;
  }
  const a = span.attributes;
  if (a.blocked === true || a.approved === false) return { label: "blocked", color: "var(--danger)" };
  if (a.outcome === "confirmation_required") return { label: "confirm", color: "var(--caution)" };
  return { label: "passed", color: "var(--signal)" };
}

function spanColor(span: Span): string {
  if (span.type === "guardrail") {
    const v = guardrailVerdict(span);
    if (v) return v.color;
  }
  return TYPE_COLOR[span.type] ?? "var(--text-dim)";
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      {label}
    </span>
  );
}

function SpanRow({ span, maxDur }: { span: Span; maxDur: number }) {
  const color = spanColor(span);
  const verdict = guardrailVerdict(span);
  const widthPct = Math.max(3, Math.min(100, (span.durationMs / maxDur) * 100));

  const keyAttrs = Object.entries(span.attributes)
    .filter(([k]) => !["userMessage", "model", "iteration", "approved", "blocked", "outcome"].includes(k))
    .slice(0, 2)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("  ");

  return (
    <div className="animate-span-in relative pl-3 py-2.5">
      <span
        className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px -1px ${color}` }}
      />
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-[9px] font-semibold tracking-wider w-9 flex-shrink-0"
          style={{ color }}
        >
          {TYPE_LABEL[span.type] ?? span.type}
        </span>
        <span className="font-mono text-[12px] text-text truncate flex-1">{span.name}</span>
        {verdict && <Chip label={verdict.label} color={verdict.color} />}
        <span className="font-mono text-[10px] text-text-faint tabular-nums flex-shrink-0">
          {span.durationMs}ms
        </span>
      </div>

      {/* duration micro-bar */}
      <div className="mt-1.5 ml-11 h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${widthPct}%`, backgroundColor: color, opacity: 0.55 }}
        />
      </div>

      {keyAttrs && (
        <p className="mt-1 ml-11 font-mono text-[10px] text-text-faint truncate">{keyAttrs}</p>
      )}
    </div>
  );
}

function ReadoutRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-hairline/60 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint flex-shrink-0">
        {label}
      </span>
      <span className="font-mono text-[11px] text-right">{children}</span>
    </div>
  );
}

function WorkingMemoryReadout({ wm }: { wm: SafeWorkingMemory | null }) {
  if (!wm) {
    return <p className="text-sm text-text-faint py-8 text-center font-mono">awaiting session…</p>;
  }
  return (
    <div className="px-1">
      <ReadoutRow label="identity">
        {wm.identityVerified ? (
          <Chip label="✓ verified" color="var(--signal)" />
        ) : (
          <span className="text-text-faint">not verified</span>
        )}
      </ReadoutRow>
      <ReadoutRow label="verify token">
        <span className={wm.verificationToken ? "text-signal" : "text-text-faint"}>
          {wm.verificationToken ?? "null"}
        </span>
      </ReadoutRow>
      <ReadoutRow label="pending action">
        {wm.pendingAction ? (
          <span className="text-caution">
            {wm.pendingAction.type} {wm.pendingAction.confirmed ? "✓" : "⋯"}
          </span>
        ) : (
          <span className="text-text-faint">none</span>
        )}
      </ReadoutRow>
      <ReadoutRow label="confirm token">
        <span className={wm.confirmationToken ? "text-caution" : "text-text-faint"}>
          {wm.confirmationToken ?? "null"}
        </span>
      </ReadoutRow>
      <ReadoutRow label="policy verdict">
        {wm.policyVerdict ? (
          <span style={{ color: wm.policyVerdict.allowed ? "var(--signal)" : "var(--danger)" }}>
            {wm.policyVerdict.allowed ? "✓ " : "✗ "}
            {wm.policyVerdict.reason}
          </span>
        ) : (
          <span className="text-text-faint">none</span>
        )}
      </ReadoutRow>
      <ReadoutRow label="refunds issued">
        <span className="tabular-nums">{wm.refundsIssuedThisSession}</span>
      </ReadoutRow>
      <ReadoutRow label="plan changes">
        <span className="tabular-nums">{wm.planChangesThisSession}</span>
      </ReadoutRow>
      <ReadoutRow label="guardrail blocks">
        <span
          className="tabular-nums"
          style={{ color: wm.consecutiveGuardrailBlocks > 0 ? "var(--caution)" : undefined }}
        >
          {wm.consecutiveGuardrailBlocks}
        </span>
      </ReadoutRow>
      <ReadoutRow label="idempotency">
        <span className="tabular-nums text-text-dim">{wm.idempotencyStoreSize} cached</span>
      </ReadoutRow>
      <ReadoutRow label="escalated">
        {wm.escalated ? (
          <Chip label="escalated" color="var(--danger)" />
        ) : (
          <span className="text-text-faint">no</span>
        )}
      </ReadoutRow>
    </div>
  );
}

function AuditList({ records }: { records: AuditRecord[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-text-faint py-8 text-center font-mono">no records yet</p>;
  }
  return (
    <div className="space-y-2.5">
      {[...records].reverse().map((r, i) => (
        <div
          key={i}
          className="animate-span-in relative rounded-xl border border-hairline bg-panel-2/50 p-3 pl-4 overflow-hidden"
        >
          <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-signal" />
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px] font-semibold text-signal">{r.action}</span>
            <span className="font-mono text-[9px] text-text-faint tabular-nums">
              {new Date(r.ts).toLocaleTimeString()}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-text-dim leading-relaxed break-all">
            {r.outcome.slice(0, 110)}
          </p>
          {r.policyVerdict && (
            <p
              className="mt-1 font-mono text-[10px]"
              style={{ color: r.policyVerdict.allowed ? "var(--signal)" : "var(--danger)" }}
            >
              policy: {r.policyVerdict.reason}
              {r.policyVerdict.refundAmountUsd !== undefined && ` · $${r.policyVerdict.refundAmountUsd}`}
            </p>
          )}
          {r.idempotencyKey && (
            <p className="mt-1 font-mono text-[9px] text-text-faint break-all">
              idem: {r.idempotencyKey.slice(0, 24)}…
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  spans: Span[];
  audit: AuditRecord[];
  workingMemory: SafeWorkingMemory | null;
  conversationId: string | null;
}

export function Inspector({ spans, audit, workingMemory, conversationId }: Props) {
  const [tab, setTab] = useState<TabKey>("timeline");
  const maxDur = Math.max(1, ...spans.map((s) => s.durationMs));

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "timeline", label: "Timeline", count: spans.length || undefined },
    { key: "memory", label: "Memory" },
    { key: "audit", label: "Audit", count: audit.length || undefined },
  ];

  return (
    <div className="panel grid-texture rounded-2xl h-full flex flex-col overflow-hidden">
      {/* header */}
      <div className="flex-shrink-0 px-5 py-4 flex items-center justify-between border-b border-hairline">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${spans.length ? "bg-signal pulse-dot" : "bg-text-faint"}`}
          />
          <h2 className="eyebrow !text-[11px] !tracking-[0.25em] text-text">Inspector</h2>
        </div>
        {conversationId && (
          <span className="font-mono text-[10px] text-text-faint">{conversationId.slice(0, 12)}</span>
        )}
      </div>

      {/* channel tabs */}
      <div className="flex-shrink-0 flex border-b border-hairline px-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              tab === t.key ? "text-signal" : "text-text-faint hover:text-text-dim"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-[9px] text-text-faint">{t.count}</span>
            )}
            {tab === t.key && (
              <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-signal rounded-full shadow-[0_0_8px_rgba(56,224,123,0.7)]" />
            )}
          </button>
        ))}
      </div>

      {/* body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3">
          {tab === "timeline" &&
            (spans.length === 0 ? (
              <p className="text-sm text-text-faint py-8 text-center font-mono">no spans yet</p>
            ) : (
              <div className="divide-y divide-hairline/50">
                {spans.map((span, i) => (
                  <SpanRow key={i} span={span} maxDur={maxDur} />
                ))}
              </div>
            ))}
          {tab === "memory" && <WorkingMemoryReadout wm={workingMemory} />}
          {tab === "audit" && <AuditList records={audit} />}
        </div>
      </ScrollArea>
    </div>
  );
}
