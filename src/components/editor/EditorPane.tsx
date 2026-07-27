import { lazy, Suspense } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { AlertCircle, Database, TerminalSquare } from "lucide-react";
import type { QueryResult } from "@/types";
import { useApp } from "@/store/app";
import { ResultsGrid } from "@/components/results/ResultsGrid";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

// Load the Monaco-backed editor on demand so the app shell paints instantly.
const SqlEditor = lazy(() => import("./SqlEditor"));

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 bg-base text-xs text-content-muted">
      <Spinner size={16} className="text-iris" />
      Carregando editor…
    </div>
  );
}

export function EditorPane() {
  const { tabs, activeTabId, setActiveResult, loadResultPage } = useApp();
  const tab = tabs.find((t) => t.id === activeTabId);

  if (!tab)
    return (
      <div className="grid h-full place-items-center bg-base text-sm text-content-faint">
        Nenhuma aba aberta
      </div>
    );

  const result = tab.results[tab.activeResultIndex];

  return (
    <PanelGroup direction="vertical" autoSaveId="zeru-editor-split">
      <Panel defaultSize={52} minSize={20}>
        <Suspense fallback={<EditorLoading />}>
          <SqlEditor tab={tab} />
        </Suspense>
      </Panel>
      <ResizeHandle direction="horizontal" />
      <Panel defaultSize={48} minSize={15}>
        {tab.running ? (
          <div className="flex h-full items-center justify-center gap-2 bg-base text-xs text-content-muted">
            <Spinner size={16} className="text-iris" />
            Executando consulta…
          </div>
        ) : result ? (
          <div className="flex h-full flex-col">
            {/* One strip entry per statement in the script. */}
            {tab.results.length > 1 && (
              <StatementTabs
                results={tab.results}
                active={tab.activeResultIndex}
                onSelect={(i) => setActiveResult(tab.id, i)}
              />
            )}
            <div className="min-h-0 flex-1">
              <ResultsGrid
                result={result}
                loading={tab.pagingIndex === tab.activeResultIndex}
                onFetchPage={(offset, limit) =>
                  loadResultPage(tab.id, tab.activeResultIndex, offset, limit)
                }
              />
            </div>
          </div>
        ) : (
          <EmptyResults />
        )}
      </Panel>
    </PanelGroup>
  );
}

/** Compact label for a statement's result: the leading keyword plus outcome. */
function statementLabel(result: QueryResult, index: number): string {
  const keyword = result.statement.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  const head = keyword.slice(0, 12) || `#${index + 1}`;
  if (result.kind === "error") return head;
  if (result.kind === "affected") return `${head} (${result.affectedRows ?? 0})`;
  return `${head} (${result.rows.length}${result.hasMore ? "+" : ""})`;
}

function StatementTabs({
  results,
  active,
  onSelect,
}: {
  results: QueryResult[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2">
      {results.map((r, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          title={r.statement}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded px-2 py-0.5 font-mono text-2xs transition-colors",
            i === active
              ? "bg-iris/15 text-iris"
              : "text-content-faint hover:bg-white/[0.04] hover:text-content",
            r.kind === "error" && i !== active && "text-rose"
          )}
        >
          {r.kind === "error" && <AlertCircle size={10} />}
          <span className="text-content-faint/60">{i + 1}</span>
          {statementLabel(r, i)}
        </button>
      ))}
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-base text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.03] text-content-faint">
        <TerminalSquare size={22} />
      </div>
      <div className="text-xs text-content-muted">
        Execute uma consulta para ver os resultados aqui.
      </div>
      <div className="flex items-center gap-1.5 text-2xs text-content-faint">
        <Database size={12} />
        Os dados aparecem em uma grade filtrável e exportável.
      </div>
    </div>
  );
}
