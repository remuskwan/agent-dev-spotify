"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/Markdown";
import type { ChatMessage, PendingAction } from "@/lib/types";

const QUICK_STARTS = [
  "What plans do you offer?",
  "I want to cancel my subscription",
  "I need a refund",
];

function Equalizer() {
  return (
    <span className="inline-flex items-end gap-[3px] h-4">
      {[0, 0.18, 0.36, 0.12, 0.28].map((delay, i) => (
        <span key={i} className="eq-bar" style={{ animationDelay: `${delay}s` }} />
      ))}
    </span>
  );
}

interface Props {
  messages: ChatMessage[];
  pendingAction: PendingAction | null;
  loading: boolean;
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, pendingAction, loading, onSend }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSend(text);
  }

  return (
    <div className="panel rounded-2xl h-full flex flex-col overflow-hidden">
      {/* header */}
      <div className="flex-shrink-0 px-5 py-4 flex items-center gap-3 border-b border-hairline">
        <div className="relative">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-signal to-[#16a34a] flex items-center justify-center text-[#04240f] text-display font-bold text-sm">
            S
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-signal border-2 border-panel pulse-dot" />
        </div>
        <div className="leading-tight">
          <h2 className="text-display font-semibold text-[15px] tracking-tight">Streamify Assistant</h2>
          <p className="text-[11px] text-text-dim">AI support · Individual plan · $9.99/mo</p>
        </div>
      </div>

      {/* messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 py-5 space-y-4">
          {messages.length === 0 && (
            <div className="pt-10 pb-6 flex flex-col items-center text-center">
              <Equalizer />
              <p className="mt-5 text-display text-xl font-medium tracking-tight text-text">
                How can I help you today?
              </p>
              <p className="mt-1.5 text-sm text-text-dim max-w-xs">
                Ask about plans, manage your subscription, or request a refund.
              </p>
              <div className="mt-6 flex flex-col gap-2.5 w-full max-w-sm">
                {QUICK_STARTS.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => onSend(q)}
                    disabled={loading}
                    style={{ animationDelay: `${260 + i * 70}ms` }}
                    className="group animate-fade-up text-left text-sm px-4 py-2.5 rounded-xl border border-hairline bg-panel-2/60 hover:border-signal/45 hover:bg-signal/5 transition-all disabled:opacity-40"
                  >
                    <span className="text-text-faint font-mono text-xs mr-2 group-hover:text-signal transition-colors">
                      ↳
                    </span>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex animate-rise-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && !msg.pending && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-panel-2 border border-hairline flex items-center justify-center text-[10px] text-display font-bold text-signal mr-2.5 mt-0.5">
                  S
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-signal text-[#04240f] font-medium rounded-br-md whitespace-pre-wrap"
                    : "bg-panel-2 border border-hairline text-text rounded-bl-md"
                }`}
              >
                {msg.pending ? (
                  <span className="flex items-center gap-2.5 text-text-dim">
                    <Equalizer />
                    <span className="text-xs font-mono tracking-wide">processing</span>
                  </span>
                ) : msg.role === "assistant" ? (
                  <Markdown content={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}

          {pendingAction && (
            <div className="animate-rise-in rounded-xl border border-caution/40 bg-caution/[0.06] p-4 space-y-3 shadow-[0_0_30px_-12px_rgba(255,193,99,0.5)]">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-caution pulse-dot" />
                <p className="eyebrow !text-[10px] !text-caution !tracking-[0.2em]">
                  Confirmation required
                </p>
              </div>
              <p className="text-sm text-text leading-relaxed">{pendingAction.summary}</p>
              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => onSend("yes")}
                  className="text-sm font-medium px-4 py-1.5 rounded-lg bg-caution text-[#2a1a00] hover:brightness-110 transition-all"
                >
                  Confirm
                </button>
                <button
                  onClick={() => onSend("no")}
                  className="text-sm px-4 py-1.5 rounded-lg border border-hairline text-text-dim hover:text-text hover:border-text-dim/40 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* composer */}
      <div className="flex-shrink-0 p-4 border-t border-hairline">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-xl border border-hairline bg-panel-2/70 px-2 py-1.5 focus-within:border-signal/50 focus-within:shadow-[0_0_24px_-8px_rgba(56,224,123,0.5)] transition-all"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            disabled={loading}
            autoFocus
            className="flex-1 bg-transparent px-2.5 py-1.5 text-[13.5px] placeholder:text-text-faint focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex-shrink-0 px-4 py-2 rounded-lg bg-signal text-[#04240f] text-sm font-semibold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "···" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
