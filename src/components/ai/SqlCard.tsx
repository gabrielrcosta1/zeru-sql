import { useState } from "react";
import { Play, FileInput, Copy, Check, ShieldAlert, Info } from "lucide-react";
import type { AiSqlBlock } from "@/types";
import { SqlHighlight } from "./SqlHighlight";
import { Button } from "@/components/ui/Button";
import { useApp } from "@/store/app";
import { cn } from "@/lib/cn";

export function SqlCard({ block }: { block: AiSqlBlock }) {
  const { insertAiSqlIntoEditor, newTab, runTab, activeTabId } = useApp();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(block.sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const run = () => {
    insertAiSqlIntoEditor(block.sql);
    runTab(activeTabId);
    setConfirming(false);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-base/70",
        block.destructive ? "border-rose/40" : "border-line-strong/60"
      )}
    >
      {block.destructive && (
        <div className="flex items-center gap-2 border-b border-rose/30 bg-rose/[0.08] px-3 py-1.5 text-2xs font-medium text-rose">
          <ShieldAlert size={13} />
          Comando destrutivo — não será executado automaticamente
        </div>
      )}
      <div className="max-h-64 overflow-auto px-3 py-2.5 text-content">
        <SqlHighlight sql={block.sql} />
      </div>
      {block.explanation && (
        <div className="flex items-start gap-1.5 border-t border-line px-3 py-2 text-2xs text-content-faint">
          <Info size={12} className="mt-px shrink-0" />
          <span>{block.explanation}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 border-t border-line bg-surface/60 px-2.5 py-2">
        {block.destructive ? (
          confirming ? (
            <>
              <Button size="sm" variant="danger" onClick={run}>
                Confirmar execução
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="default" onClick={() => setConfirming(true)}>
              <Play size={12} /> Revisar &amp; executar
            </Button>
          )
        ) : (
          <Button size="sm" variant="primary" onClick={run} className="gap-1.5">
            <Play size={12} className="fill-current" /> Executar
          </Button>
        )}
        <Button
          size="sm"
          variant="subtle"
          onClick={() => insertAiSqlIntoEditor(block.sql)}
          className="gap-1.5"
        >
          <FileInput size={12} /> Inserir no editor
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => newTab(block.sql, "consulta da IA")}
          className="gap-1.5"
        >
          Nova aba
        </Button>
        <button
          onClick={copy}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-content-faint hover:bg-white/[0.06] hover:text-content"
        >
          {copied ? <Check size={13} className="text-teal" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}
