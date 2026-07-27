import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Database, FileCode2, Settings2, Eraser, Square } from "lucide-react";
import type { AiMessage } from "@/types";
import { useApp } from "@/store/app";
import { SqlCard } from "./SqlCard";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "Mostre onde está armazenado o CPF",
  "Quais tabelas se relacionam com pagamentos?",
  "Otimize esse SELECT",
  "Qual índice está faltando?",
];

export function AiPanel() {
  const {
    aiMessages,
    aiThinking,
    aiSettings,
    sendAi,
    cancelAi,
    clearAi,
    openAiSettings,
    loadAiSettings,
    connections,
    activeConnectionId,
    tabs,
    activeTabId,
  } = useApp();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const conn = connections.find((c) => c.id === activeConnectionId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Settings drive the "not configured" banner, so they are needed on mount.
  useEffect(() => {
    loadAiSettings();
  }, [loadAiSettings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [aiMessages, aiThinking]);

  const configured = aiSettings?.hasApiKey ?? false;

  const submit = () => {
    if (!text.trim() || aiThinking) return;
    sendAi(text.trim());
    setText("");
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Context bar */}
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-2xs text-content-faint">
        <span className="flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5">
          <Database size={10} /> {conn?.name ?? "sem conexão"}
        </span>
        {activeTab && (
          <span className="flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5">
            <FileCode2 size={10} /> {activeTab.title}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {aiSettings && (
            <span className="font-mono text-content-faint/70">{aiSettings.model}</span>
          )}
          {aiMessages.length > 0 && (
            <button
              onClick={clearAi}
              title="Limpar conversa"
              className="rounded p-0.5 hover:bg-white/[0.06] hover:text-content"
            >
              <Eraser size={11} />
            </button>
          )}
          <button
            onClick={() => openAiSettings(true)}
            title="Configurar provedor de IA"
            className="rounded p-0.5 hover:bg-white/[0.06] hover:text-content"
          >
            <Settings2 size={11} />
          </button>
        </span>
      </div>

      {!configured && (
        <button
          onClick={() => openAiSettings(true)}
          className="mx-3 mt-3 rounded-lg border border-amber/40 bg-amber/[0.07] px-3 py-2 text-left text-2xs text-content-muted transition-colors hover:border-amber/60"
        >
          <span className="font-medium text-amber">Nenhuma chave de API configurada.</span>{" "}
          Clique para escolher um provedor e informar a chave.
        </button>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {aiMessages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {/* Only before the first token — after that the reply renders itself. */}
        {aiThinking && !aiMessages.some((m) => m.pending && m.text) && <ThinkingBubble />}
      </div>

      {/* Suggestions */}
      {aiMessages.length <= 3 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendAi(s)}
              className="rounded-full border border-line-strong/60 bg-base/60 px-2.5 py-1 text-2xs text-content-muted transition-colors hover:border-iris/50 hover:text-content"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-line p-2.5">
        <div className="flex items-end gap-2 rounded-xl border border-line-strong/60 bg-base/70 p-2 focus-within:border-iris/60 focus-within:ring-2 focus-within:ring-iris/20">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Pergunte em linguagem natural…"
            className="max-h-32 flex-1 resize-none bg-transparent py-1 text-xs text-content placeholder:text-content-faint focus:outline-none"
          />
          {aiThinking ? (
            <button
              onClick={cancelAi}
              title="Parar"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[0.08] text-content transition-colors hover:bg-white/[0.14]"
            >
              <Square size={11} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-iris text-white transition-colors hover:bg-iris-hi disabled:bg-white/[0.06] disabled:text-content-faint"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-3xs text-content-faint">
          A IA mostra o SQL antes de executar. Comandos destrutivos exigem confirmação.
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  if (message.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] animate-fade-in rounded-2xl rounded-br-md bg-iris/15 px-3 py-2 text-xs text-content">
          {message.text}
        </div>
      </div>
    );

  return (
    <div className="flex animate-fade-in gap-2.5">
      <div
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: "linear-gradient(150deg, rgb(124 137 255), rgb(92 102 214))" }}
      >
        <Sparkles size={12} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {message.text && <Markdownish text={message.text} />}
        {message.sql && <SqlCard block={message.sql} />}
        {message.contextChips && (
          <div className="flex flex-wrap gap-1">
            {message.contextChips.map((c) => (
              <span
                key={c}
                className="rounded bg-white/[0.04] px-1.5 py-0.5 text-3xs text-content-faint"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders **bold** and `code` spans without a full markdown dep. */
function Markdownish({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <p className="text-xs leading-relaxed text-content-muted">
      {parts.map((p, i) => {
        if (p.startsWith("**"))
          return (
            <strong key={i} className="font-semibold text-content">
              {p.slice(2, -2)}
            </strong>
          );
        if (p.startsWith("`"))
          return (
            <code key={i} className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-iris-hi">
              {p.slice(1, -1)}
            </code>
          );
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex animate-fade-in gap-2.5">
      <div
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: "linear-gradient(150deg, rgb(124 137 255), rgb(92 102 214))" }}
      >
        <Sparkles size={12} className="animate-pulse" />
      </div>
      <div className="flex items-center gap-1 pt-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("h-1.5 w-1.5 rounded-full bg-content-faint animate-blink")}
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}
