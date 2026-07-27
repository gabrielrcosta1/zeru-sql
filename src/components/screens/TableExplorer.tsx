import { useEffect, useMemo, useRef, useState } from "react";
import {
  Table2,
  Columns3,
  Rows3,
  Share2,
  ListTree,
  BarChart3,
  KeyRound,
  Link2,
  Play,
  X,
} from "lucide-react";
import type { QueryResult, TableNode } from "@/types";
import { ResultsGrid } from "@/components/results/ResultsGrid";
import { Badge, Spinner } from "@/components/ui/misc";
import { IconButton, Button } from "@/components/ui/Button";
import { DEFAULT_PAGE_SIZE, useApp } from "@/store/app";
import * as api from "@/lib/api";
import { fmtBytes, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type ExpTab = "structure" | "data" | "relations" | "indexes" | "stats";

const TABS: { key: ExpTab; label: string; icon: typeof Table2 }[] = [
  { key: "structure", label: "Estrutura", icon: Columns3 },
  { key: "data", label: "Dados", icon: Rows3 },
  { key: "relations", label: "Relacionamentos", icon: Share2 },
  { key: "indexes", label: "Índices", icon: ListTree },
  { key: "stats", label: "Estatísticas", icon: BarChart3 },
];

interface RelEdge {
  from: string;
  to: string;
}

export function TableExplorer({ tableName }: { tableName: string }) {
  const { newTab, setCenterView, databaseTree, connections, activeConnectionId } = useApp();
  const [tab, setTab] = useState<ExpTab>("structure");

  const conn = connections.find((c) => c.id === activeConnectionId);
  const engine = conn?.engine;

  // Locate the table and the schema that owns it.
  const located = useMemo(() => {
    const candidates = (databaseTree?.schemas ?? []).flatMap((s) =>
      [...s.tables, ...s.views].map((t) => ({ table: t, schema: s.name }))
    );
    return candidates.find((c) => c.table.name === tableName) ?? null;
  }, [databaseTree, tableName]);

  const quoteId = (id: string) =>
    engine === "mysql" || engine === "mariadb" ? `\`${id}\`` : `"${id}"`;
  const qualified = located
    ? located.schema
      ? `${quoteId(located.schema)}.${quoteId(located.table.name)}`
      : quoteId(located.table.name)
    : "";

  // Incoming foreign keys: columns in other tables that reference this one.
  const incoming = useMemo<RelEdge[]>(() => {
    if (!located) return [];
    const all = databaseTree?.schemas.flatMap((s) => [...s.tables, ...s.views]) ?? [];
    return all.flatMap((t) =>
      t.columns
        .filter((c) => c.fk?.table === located.table.name)
        .map((c) => ({ from: `${t.name}.${c.name}`, to: `${located.table.name}.${c.fk!.column}` }))
    );
  }, [databaseTree, located]);

  // Preconditions for the data preview are derived, not stored: keeping them
  // out of state avoids a synchronous setState inside the effect below.
  const previewBlocker = !api.isTauri
    ? "Prévia de dados requer o app nativo (Tauri)."
    : !activeConnectionId
      ? "Nenhuma conexão ativa."
      : null;

  // Lazily fetch a data preview when the "Dados" tab is opened. `key` ties the
  // cached result to the table + connection it came from, so switching either
  // one invalidates it without a separate reset effect.
  const previewKey = `${activeConnectionId}::${qualified}`;
  const [preview, setPreview] = useState<{
    key: string;
    result?: QueryResult;
    error?: string;
  }>({ key: "" });
  // Tracks the request in flight so the effect never has to write state
  // synchronously just to flip a loading flag (that flag is derived below).
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    if (tab !== "data" || !qualified || previewBlocker) return;
    if (preview.key === previewKey || inFlight.current === previewKey) return;

    inFlight.current = previewKey;
    let cancelled = false;
    // No LIMIT in the SQL: the backend pages the statement, so the preview can
    // walk the whole table instead of being capped at a fixed slice.
    api
      .runQuery(activeConnectionId, `SELECT * FROM ${qualified}`, DEFAULT_PAGE_SIZE)
      .then(([result]) => {
        if (cancelled) return;
        setPreview(
          result
            ? { key: previewKey, result }
            : { key: previewKey, error: "O servidor não retornou resultado para a prévia." }
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setPreview({ key: previewKey, error: String(e) });
      })
      .finally(() => {
        if (inFlight.current === previewKey) inFlight.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [tab, qualified, activeConnectionId, previewBlocker, previewKey, preview.key]);

  const [paging, setPaging] = useState(false);
  const fetchPreviewPage = (offset: number, limit: number) => {
    const statement = preview.result?.statement;
    if (!statement || !activeConnectionId) return;
    setPaging(true);
    api
      .fetchPage(activeConnectionId, statement, offset, limit)
      .then((result) => setPreview({ key: previewKey, result }))
      .catch((e: unknown) => setPreview({ key: previewKey, error: String(e) }))
      .finally(() => setPaging(false));
  };

  const data: { loading: boolean; result?: QueryResult; error?: string } = previewBlocker
    ? { loading: false, error: previewBlocker }
    : preview.key === previewKey
      ? { loading: false, result: preview.result, error: preview.error }
      : { loading: tab === "data" };

  if (!located)
    return (
      <div className="grid h-full place-items-center text-content-faint">Tabela não encontrada</div>
    );

  const { table, schema } = located;

  return (
    <div className="flex h-full flex-col bg-base">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-iris/15 text-iris">
          <Table2 size={18} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-sm font-semibold text-content">
              {schema ? `${schema}.` : ""}
              {table.name}
            </h2>
            <Badge tone="iris">{table.kind}</Badge>
          </div>
          <div className="mt-0.5 text-2xs text-content-faint">
            {fmtNumber(table.approxRows)} linhas · {fmtBytes(table.sizeBytes)} ·{" "}
            {table.columns.length} colunas
            {table.comment && <span> · {table.comment}</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => newTab(`SELECT *\nFROM ${qualified}\nLIMIT 200;`, table.name)}
            className="gap-1.5"
          >
            <Play size={12} className="fill-current" /> Consultar
          </Button>
          <IconButton onClick={() => setCenterView({ kind: "editor" })}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-line px-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "relative flex h-9 items-center gap-1.5 px-3 text-xs font-medium transition-colors",
              tab === key ? "text-content" : "text-content-faint hover:text-content-muted"
            )}
          >
            {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-iris" />}
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "structure" && <Structure table={table} />}
        {tab === "data" && (
          <DataPreview data={data} onFetchPage={fetchPreviewPage} paging={paging} />
        )}
        {tab === "relations" && <Relations table={table} incoming={incoming} />}
        {tab === "indexes" && <Indexes table={table} />}
        {tab === "stats" && <Stats table={table} />}
      </div>
    </div>
  );
}

function DataPreview({
  data,
  onFetchPage,
  paging,
}: {
  data: { loading: boolean; result?: QueryResult; error?: string };
  onFetchPage: (offset: number, limit: number) => void;
  paging: boolean;
}) {
  if (data.loading)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-content-muted">
        <Spinner size={16} className="text-iris" />
        Carregando dados…
      </div>
    );
  if (data.error)
    return (
      <div className="grid h-full place-items-center px-6 text-center text-2xs text-rose">
        {data.error}
      </div>
    );
  if (data.result)
    return <ResultsGrid result={data.result} onFetchPage={onFetchPage} loading={paging} />;
  return <div className="h-full" />;
}

function Structure({ table }: { table: TableNode }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-surface">
        <tr className="text-left text-2xs uppercase tracking-wide text-content-faint">
          <th className="px-4 py-2 font-medium">Coluna</th>
          <th className="px-4 py-2 font-medium">Tipo</th>
          <th className="px-4 py-2 font-medium">Nullable</th>
          <th className="px-4 py-2 font-medium">Chave</th>
          <th className="px-4 py-2 font-medium">Default</th>
        </tr>
      </thead>
      <tbody>
        {table.columns.map((c) => (
          <tr key={c.name} className="border-t border-line hover:bg-white/[0.02]">
            <td className="px-4 py-2 font-mono text-content">{c.name}</td>
            <td className="px-4 py-2 font-mono text-sky">{c.type}</td>
            <td className="px-4 py-2 text-content-muted">
              {c.nullable ? "NULL" : <span className="text-content-faint">NOT NULL</span>}
            </td>
            <td className="px-4 py-2">
              {c.pk && (
                <Badge tone="amber">
                  <KeyRound size={10} /> PK
                </Badge>
              )}
              {c.fk && (
                <Badge tone="sky">
                  <Link2 size={10} /> {c.fk.table}.{c.fk.column}
                </Badge>
              )}
              {c.unique && !c.pk && <Badge tone="teal">unique</Badge>}
            </td>
            <td className="px-4 py-2 font-mono text-content-faint">{c.default ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Relations({ table, incoming }: { table: TableNode; incoming: RelEdge[] }) {
  const out = table.columns.filter((c) => c.fk);
  return (
    <div className="space-y-4 p-4">
      <Section title="Referencia (saída)">
        {out.length ? (
          out.map((c) => (
            <RelRow key={c.name} left={`${table.name}.${c.name}`} right={`${c.fk!.table}.${c.fk!.column}`} />
          ))
        ) : (
          <Empty>Nenhuma chave estrangeira de saída.</Empty>
        )}
      </Section>
      <Section title="Referenciada por (entrada)">
        {incoming.length ? (
          incoming.map((e, i) => <RelRow key={i} left={e.from} right={e.to} incoming />)
        ) : (
          <Empty>Nenhuma tabela referencia esta.</Empty>
        )}
      </Section>
    </div>
  );
}

function RelRow({ left, right }: { left: string; right: string; incoming?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface/60 px-3 py-2 font-mono text-xs">
      <span className="text-content">{left}</span>
      <div className="flex-1 border-t border-dashed border-line-strong" />
      <Link2 size={13} className="text-sky" />
      <div className="flex-1 border-t border-dashed border-line-strong" />
      <span className="text-content-muted">{right}</span>
    </div>
  );
}

function Indexes({ table }: { table: TableNode }) {
  if (!table.indexes.length)
    return <div className="p-4 text-2xs text-content-faint">Nenhum índice.</div>;
  return (
    <div className="space-y-2 p-4">
      {table.indexes.map((ix) => (
        <div key={ix.name} className="flex items-center gap-3 rounded-lg border border-line bg-surface/60 px-3 py-2.5">
          <ListTree size={15} className="text-content-faint" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs text-content">{ix.name}</div>
            <div className="text-2xs text-content-faint">
              ({ix.columns.join(", ")}) · {ix.method ?? "btree"}
            </div>
          </div>
          {ix.unique && <Badge tone="teal">unique</Badge>}
        </div>
      ))}
    </div>
  );
}

function Stats({ table }: { table: TableNode }) {
  const cards = [
    { label: "Linhas (aprox.)", value: fmtNumber(table.approxRows) },
    { label: "Tamanho em disco", value: fmtBytes(table.sizeBytes) },
    { label: "Colunas", value: String(table.columns.length) },
    { label: "Índices", value: String(table.indexes.length) },
    { label: "Chave primária", value: table.columns.filter((c) => c.pk).map((c) => c.name).join(", ") || "—" },
    { label: "Chaves estrangeiras", value: String(table.columns.filter((c) => c.fk).length) },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 p-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-line bg-surface/60 p-4">
          <div className="text-2xs uppercase tracking-wide text-content-faint">{c.label}</div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-content">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-content-faint">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-2xs text-content-faint">{children}</div>;
}
