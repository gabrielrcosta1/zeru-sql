import { Check, Clock, Database, GitBranch, Table2, Zap } from "lucide-react";
import { activeResult } from "@/types";
import { useApp } from "@/store/app";
import { ENGINE_META } from "@/components/ui/engine";

export function StatusBar() {
  const { connections, databaseTree, activeConnectionId, tabs, activeTabId } = useApp();
  const conn = connections.find((c) => c.id === activeConnectionId) ?? connections[0];
  const tab = tabs.find((t) => t.id === activeTabId);
  const res = activeResult(tab);

  const primarySchema = databaseTree?.schemas[0];

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-surface/80 px-3 text-2xs text-content-faint">
      {conn ? (
        <>
          <span className="flex items-center gap-1.5 text-teal">
            <Check size={11} />
            Conectado
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={11} />
            {ENGINE_META[conn.engine].label} · {conn.database ?? conn.filePath ?? "—"}
          </span>
        </>
      ) : (
        <span className="flex items-center gap-1.5">
          <Database size={11} />
          Desconectado
        </span>
      )}
      {databaseTree && (
        <>
          <span className="flex items-center gap-1.5">
            <Table2 size={11} />
            {primarySchema?.tables.length ?? 0} tabelas
          </span>
          <span className="flex items-center gap-1.5">
            <GitBranch size={11} />
            schema: {primarySchema?.name || "public"}
          </span>
        </>
      )}

      <div className="flex-1" />

      {res?.kind === "rows" && (
        <>
          <span className="flex items-center gap-1.5">
            <Zap size={11} className="text-iris" />
            {res.totalRows ?? `${res.rows.length}+`} linhas
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={11} />
            {res.durationMs} ms
          </span>
        </>
      )}
      {res?.kind === "affected" && (
        <span className="flex items-center gap-1.5 text-amber">
          <Zap size={11} />
          {res.affectedRows} linhas afetadas · {res.command}
        </span>
      )}
      <span>UTF-8</span>
      <span>Ln 1, Col 1</span>
    </footer>
  );
}
