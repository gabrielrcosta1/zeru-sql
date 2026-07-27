import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, Loader2 } from "lucide-react";
import { isTauri } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { fmtBytes } from "@/lib/format";

type Phase =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; done: number; total?: number }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

/**
 * Offers an update when one is published, and never installs on its own.
 *
 * A SQL client can be sitting on an open transaction or an unsaved query, so
 * restarting without asking is not acceptable — the check is silent, the
 * install is a decision.
 */
export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    check()
      .then((update) => {
        if (!cancelled && update) setPhase({ kind: "available", update });
      })
      .catch((e: unknown) => {
        // Being offline, or a release feed that is not published yet, is not
        // something to interrupt the user about. Log and stay quiet.
        console.warn("Verificação de atualização falhou:", e);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || phase.kind === "idle") return null;

  const install = async (update: Update) => {
    setPhase({ kind: "downloading", done: 0 });
    try {
      let done = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        else if (event.event === "Progress") {
          done += event.data.chunkLength;
          setPhase({ kind: "downloading", done, total });
        } else if (event.event === "Finished") setPhase({ kind: "ready" });
      });
      setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: "failed", message: String(e) });
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-iris/30 bg-iris/[0.08] px-3 text-xs text-content">
      <Download size={14} className="shrink-0 text-iris" />

      {phase.kind === "available" && (
        <>
          <span>
            Versão <span className="font-mono text-iris">{phase.update.version}</span> disponível.
          </span>
          <Button size="sm" variant="primary" onClick={() => install(phase.update)}>
            Atualizar
          </Button>
        </>
      )}

      {phase.kind === "downloading" && (
        <span className="flex items-center gap-2 text-content-muted">
          <Loader2 size={13} className="animate-spin text-iris" />
          Baixando… {fmtBytes(phase.done)}
          {phase.total ? ` de ${fmtBytes(phase.total)}` : ""}
        </span>
      )}

      {phase.kind === "ready" && (
        <>
          <span>Atualização instalada. Reinicie para aplicar.</span>
          <Button size="sm" variant="primary" onClick={() => relaunch()}>
            Reiniciar agora
          </Button>
        </>
      )}

      {phase.kind === "failed" && (
        <span className="text-rose">Falha ao atualizar: {phase.message}</span>
      )}

      <button
        onClick={() => setDismissed(true)}
        title="Dispensar"
        className="ml-auto rounded p-1 text-content-faint hover:bg-white/[0.06] hover:text-content"
      >
        <X size={13} />
      </button>
    </div>
  );
}
