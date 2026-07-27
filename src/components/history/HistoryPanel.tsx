import { useMemo, useState } from "react";
import { Star, Sparkles, Plug, CheckCircle2, XCircle, Play, Trash2 } from "lucide-react";
import { useApp } from "@/store/app";
import { EngineIcon } from "@/components/ui/engine";
import { IconButton } from "@/components/ui/Button";
import { Segmented, Tooltip } from "@/components/ui/misc";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type Filter = "recent" | "favorites" | "ai" | "connections";

export function HistoryPanel() {
  const { history, connections, toggleFavorite, newTab, clearHistory, runTab } = useApp();

  /**
   * Re-run a past query in a fresh tab. The new tab's id is read straight from
   * the store: `newTab` has already committed it, but this render's props
   * still hold the previous value.
   */
  const rerun = (sql: string) => {
    newTab(sql, "do histórico");
    void runTab(useApp.getState().activeTabId);
  };
  const [filter, setFilter] = useState<Filter>("recent");
  // Clearing wipes favourites too, so it takes a second click to confirm.
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = useMemo(() => {
    if (filter === "favorites") return history.filter((h) => h.favorite);
    if (filter === "ai") return history.filter((h) => h.source === "ai");
    return history;
  }, [history, filter]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "recent", label: "Recentes" },
            { value: "favorites", label: <Star size={11} /> },
            { value: "ai", label: <Sparkles size={11} /> },
            { value: "connections", label: <Plug size={11} /> },
          ]}
        />
        {filter !== "connections" && history.length > 0 && (
          <Tooltip label="Limpar histórico (inclui favoritos)">
            <IconButton
              size="sm"
              className="ml-auto"
              onClick={() => {
                if (confirmClear) {
                  clearHistory();
                  setConfirmClear(false);
                } else {
                  setConfirmClear(true);
                }
              }}
            >
              <Trash2 size={13} className={confirmClear ? "text-rose" : undefined} />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {confirmClear && (
        <div className="mx-3 mb-2 rounded-md border border-rose/40 bg-rose/[0.06] px-2 py-1.5 text-2xs text-content-muted">
          Clique de novo no ícone para apagar tudo, ou{" "}
          <button className="underline" onClick={() => setConfirmClear(false)}>
            cancele
          </button>
          .
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filter === "connections" ? (
          connections.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-white/[0.04]"
            >
              <EngineIcon engine={c.engine} size={18} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-content">{c.name}</div>
                <div className="truncate text-2xs text-content-faint">
                  {c.host ?? c.filePath}
                </div>
              </div>
            </div>
          ))
        ) : (
          entries.map((h) => {
            const conn = connections.find((c) => c.id === h.connectionId);
            return (
              <div
                key={h.id}
                onClick={() => newTab(h.sql, "do histórico")}
                className="group cursor-default rounded-md px-2 py-2 transition-colors hover:bg-white/[0.04]"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  {h.status === "ok" ? (
                    <CheckCircle2 size={11} className="text-teal" />
                  ) : (
                    <XCircle size={11} className="text-rose" />
                  )}
                  {h.source === "ai" && <Sparkles size={10} className="text-iris" />}
                  <span className="text-3xs text-content-faint">{relativeTime(h.at)}</span>
                  {conn && (
                    <span className="text-3xs text-content-faint">· {conn.name}</span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(h.id);
                      }}
                      className="grid h-5 w-5 place-items-center rounded hover:bg-white/10"
                    >
                      <Star
                        size={12}
                        className={cn(h.favorite ? "fill-amber text-amber" : "text-content-faint")}
                      />
                    </button>
                    <button
                      title="Abrir em uma nova aba e executar"
                      onClick={(e) => {
                        e.stopPropagation();
                        rerun(h.sql);
                      }}
                      className="grid h-5 w-5 place-items-center rounded text-content-faint hover:bg-white/10 hover:text-content"
                    >
                      <Play size={11} />
                    </button>
                  </div>
                </div>
                <code className="line-clamp-2 block font-mono text-2xs leading-snug text-content-muted">
                  {h.sql}
                </code>
                {h.status === "ok" && h.rows != null && (
                  <div className="mt-1 text-3xs text-content-faint">
                    {h.rows} linhas · {h.durationMs} ms
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
