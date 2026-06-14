"use client";

import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { Inspector } from "@/components/Inspector";
import { createSession, sendMessage } from "@/lib/agentApi";
import type { ChatMessage, Span, AuditRecord, SafeWorkingMemory, PendingAction } from "@/lib/types";

let msgId = 0;
function nextId() {
  return String(++msgId);
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [workingMemory, setWorkingMemory] = useState<SafeWorkingMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    createSession()
      .then((s) => {
        setSessionId(s.conversationId);
        setWorkingMemory(s.workingMemory);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to connect to agent service");
      });
  }, []);

  async function handleSend(text: string) {
    if (!sessionId || loading) return;

    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
    const pendingId = nextId();
    setMessages((prev) => [...prev, { id: pendingId, role: "assistant", content: "", pending: true }]);
    setLoading(true);
    setError(null);

    try {
      const result = await sendMessage(sessionId, text);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { id: pendingId, role: "assistant", content: result.reply }
            : m
        )
      );
      setSpans((prev) => [...prev, ...result.spans]);
      setAudit((prev) => [...prev, ...result.audit]);
      setWorkingMemory(result.workingMemory);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const pendingAction: PendingAction | null = workingMemory?.pendingAction ?? null;
  const showPending = pendingAction && !pendingAction.confirmed ? pendingAction : null;

  return (
    <div className="atmosphere h-screen flex flex-col overflow-hidden">
      <header className="relative z-10 flex-shrink-0 px-6 py-4 flex items-center justify-between animate-fade-up">
        <div className="flex items-center gap-3.5">
          <div className="relative w-9 h-9 rounded-xl bg-signal flex items-center justify-center glow-signal">
            <span className="text-display font-extrabold text-[#04240f] text-lg leading-none">S</span>
          </div>
          <div className="leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="text-display font-extrabold tracking-tight text-[15px]">STREAMIFY</span>
              <span className="eyebrow !text-[9px] text-signal/80">/ support</span>
            </div>
            <span className="eyebrow !tracking-[0.28em] !text-[9px]">Signal Console</span>
          </div>
        </div>

        {error && (
          <span className="font-mono text-xs text-danger bg-danger/10 border border-danger/30 px-2.5 py-1 rounded-md">
            ⚠ {error}
          </span>
        )}

        <div className="flex items-center gap-2.5 font-mono text-[11px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${sessionId ? "bg-signal pulse-dot" : "bg-text-faint"}`}
          />
          <span className="text-text-faint uppercase tracking-wider">
            {sessionId ? "live" : "connecting"}
          </span>
          {sessionId && (
            <span className="text-text-dim border-l border-hairline pl-2.5">
              {sessionId.slice(0, 10)}
            </span>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-hidden grid grid-cols-[1fr_min(40%,440px)] gap-4 px-4 pb-4">
        <div className="animate-fade-up [animation-delay:80ms] min-h-0">
          <ChatPanel
            messages={messages}
            pendingAction={showPending}
            loading={loading}
            onSend={handleSend}
          />
        </div>
        <div className="animate-fade-up [animation-delay:160ms] min-h-0">
          <Inspector
            spans={spans}
            audit={audit}
            workingMemory={workingMemory}
            conversationId={sessionId}
          />
        </div>
      </main>
    </div>
  );
}
