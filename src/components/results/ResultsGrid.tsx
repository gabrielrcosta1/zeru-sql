import { useMemo, useState } from "react";
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Table2,
  Braces,
  FileSpreadsheet,
  FileJson,
  Copy,
  Filter,
  CheckCircle2,
} from "lucide-react";
import type { Cell, QueryResult, ResultColumn } from "@/types";
import { SearchInput } from "@/components/ui/Input";
import { IconButton, Button } from "@/components/ui/Button";
import { Badge, Spinner, Tooltip, VDivider } from "@/components/ui/misc";
import { Dropdown, useContextMenu } from "@/components/ui/Menu";
import { exportCsv, exportExcel, exportJson, rowToText } from "@/lib/export";
import { fmtNumber } from "@/lib/format";
import { DEFAULT_PAGE_SIZE } from "@/store/app";
import { cn } from "@/lib/cn";

const PAGE_SIZES = [50, 100, 200, 500, 1000];

/** Render a decoded cell. JSON columns arrive as parsed structures. */
function cellText(value: Cell): string {
  if (value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function Cellview({ value, type }: { value: Cell; type: ResultColumn["type"] }) {
  if (value === null)
    return <span className="italic text-content-faint/70">NULL</span>;
  if (type === "boolean")
    return (
      <Badge tone={value ? "teal" : "neutral"}>{value ? "true" : "false"}</Badge>
    );
  if (typeof value === "object")
    return <span className="font-mono text-iris">{JSON.stringify(value)}</span>;
  if (type === "number")
    return <span className="font-mono text-sky">{String(value)}</span>;
  if (type === "date")
    return <span className="font-mono text-content-muted">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

export interface ResultsGridProps {
  result: QueryResult;
  /**
   * Load another page of this statement from the server. Omit for static
   * results (a fixed preview), which hides the page controls entirely rather
   * than offering navigation that cannot work.
   */
  onFetchPage?: (offset: number, limit: number) => void;
  /** A page request for this result is in flight. */
  loading?: boolean;
}

export function ResultsGrid({ result, onFetchPage, loading }: ResultsGridProps) {
  if (result.kind === "affected") return <AffectedFeedback result={result} />;
  if (result.kind === "error") return <ErrorFeedback result={result} />;
  return <RowsGrid result={result} onFetchPage={onFetchPage} loading={loading} />;
}

function RowsGrid({ result, onFetchPage, loading }: ResultsGridProps) {
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  // Per-column filters, keyed by column index. Like the search box, they act on
  // the loaded page — the server holds the rest.
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const menu = useContextMenu();

  const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== "");

  // Search and sort act on the loaded page only — the server holds the rest.
  // The toolbar says so explicitly so the numbers are never misread as totals.
  const processed = useMemo(() => {
    let rows = result.rows;
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.some((c) => cellText(c).toLowerCase().includes(q)));
    for (const [index, value] of activeFilters) {
      const needle = value.trim().toLowerCase();
      const col = Number(index);
      rows = rows.filter((r) => cellText(r[col]).toLowerCase().includes(needle));
    }
    if (sort) {
      const { col, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : cellText(av).localeCompare(cellText(bv));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
    // `activeFilters` is derived from `filters`, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.rows, query, sort, filters]);

  const paged = Boolean(onFetchPage);
  const firstRow = result.offset + 1;
  const lastRow = result.offset + result.rows.length;
  const canPrev = paged && result.offset > 0;
  const canNext = paged && result.hasMore;

  const changePageSize = (size: number) => {
    setPageSize(size);
    // Keep the current page's first row visible after resizing.
    onFetchPage?.(result.offset, size);
  };

  const toggleSort = (col: number) =>
    setSort((s) =>
      s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null
    );

  return (
    <div className="flex h-full flex-col bg-base">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <SearchInput
          placeholder="Buscar nos resultados…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          containerClassName="w-56"
        />
        <Tooltip label="Filtros por coluna">
          <IconButton
            size="sm"
            onClick={() => {
              // Hiding the row also clears it, so filters can never stay
              // applied while their inputs are out of sight.
              if (showFilters) setFilters({});
              setShowFilters((v) => !v);
            }}
            className={cn(
              showFilters && "bg-iris/15 text-iris",
              activeFilters.length > 0 && "text-iris"
            )}
          >
            <Filter size={14} />
          </IconButton>
        </Tooltip>

        <VDivider className="mx-1 h-4" />
        <span className="text-2xs text-content-faint">
          <span className="font-mono text-content-muted">{fmtNumber(processed.length)}</span> linhas
          {(query.trim() || activeFilters.length > 0) && (
            <span className="ml-1">nesta página</span>
          )}
          {result.totalRows !== undefined && (
            <span className="ml-1">de {fmtNumber(result.totalRows)}</span>
          )}
          <span className="mx-1.5">·</span>
          <span className="font-mono text-teal">{result.durationMs} ms</span>
        </span>
        {loading && <Spinner size={12} className="text-iris" />}

        <div className="flex-1" />

        <Dropdown
          align="right"
          items={[
            // Exports cover what is loaded — the current page, after any search
            // filter. Labelled as such so the file is never mistaken for the
            // whole result set.
            { key: "csv", label: `Exportar CSV (${processed.length} linhas)`, icon: <FileSpreadsheet size={13} />, onSelect: () => exportCsv(result.columns, processed) },
            { key: "xls", label: `Exportar Excel (${processed.length} linhas)`, icon: <FileSpreadsheet size={13} />, onSelect: () => exportExcel(result.columns, processed) },
            { key: "json", label: `Exportar JSON (${processed.length} linhas)`, icon: <FileJson size={13} />, onSelect: () => exportJson(result.columns, processed) },
          ]}
          trigger={({ onClick }) => (
            <Button size="sm" variant="subtle" onClick={onClick} className="gap-1.5">
              <Download size={13} />
              Exportar
            </Button>
          )}
        />
      </div>

      {/* Grid */}
      <div className="relative flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 w-12 border-b border-r border-line bg-surface px-2 py-1.5 text-right font-mono text-2xs font-normal text-content-faint">
                #
              </th>
              {result.columns.map((c, ci) => (
                <th
                  key={c.name}
                  onClick={() => toggleSort(ci)}
                  className="group cursor-pointer border-b border-r border-line bg-surface px-3 py-1.5 text-left font-medium text-content-muted transition-colors hover:bg-elevated hover:text-content"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{c.name}</span>
                    <span className="text-3xs font-normal text-content-faint/70">{c.type}</span>
                    <span className="ml-auto">
                      {sort?.col === ci ? (
                        sort.dir === "asc" ? (
                          <ArrowUp size={12} className="text-iris" />
                        ) : (
                          <ArrowDown size={12} className="text-iris" />
                        )
                      ) : (
                        <ArrowUp size={12} className="text-transparent group-hover:text-content-faint" />
                      )}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
            {showFilters && (
              <tr>
                <th className="sticky left-0 z-20 border-b border-r border-line bg-surface" />
                {result.columns.map((c, ci) => (
                  <th
                    key={c.name}
                    className="border-b border-r border-line bg-surface px-1.5 py-1"
                  >
                    <input
                      value={filters[ci] ?? ""}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, [ci]: e.target.value }))
                      }
                      placeholder="filtrar…"
                      className="w-full rounded border border-line/80 bg-base/60 px-1.5 py-0.5 text-2xs font-normal text-content placeholder:text-content-faint focus:border-iris/70 focus:outline-none"
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {processed.map((row, ri) => {
              // `ri` indexes the visible rows (what the context menu reads);
              // the label shows the row's position in the full result set.
              const label = result.offset + ri + 1;
              return (
                <tr key={ri} className="group/row">
                  <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-2 py-1.5 text-right font-mono text-2xs text-content-faint group-hover/row:bg-elevated">
                    {label}
                  </td>
                  {row.map((cell, ci) => {
                    const selected = sel?.r === ri && sel?.c === ci;
                    return (
                      <td
                        key={ci}
                        onClick={() => setSel({ r: ri, c: ci })}
                        onContextMenu={(e) => {
                          setSel({ r: ri, c: ci });
                          menu.open(e);
                        }}
                        className={cn(
                          "max-w-[320px] truncate border-b border-r border-line px-3 py-1.5 transition-colors",
                          "group-hover/row:bg-white/[0.02]",
                          selected && "bg-iris/15 ring-1 ring-inset ring-iris/50"
                        )}
                      >
                        <Cellview value={cell} type={result.columns[ci].type} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {menu.render([
          {
            key: "copy-cell",
            label: "Copiar célula",
            icon: <Copy size={13} />,
            onSelect: () =>
              sel && navigator.clipboard?.writeText(cellText(processed[sel.r]?.[sel.c] ?? null)),
          },
          {
            key: "copy-row",
            label: "Copiar linha",
            icon: <Table2 size={13} />,
            onSelect: () =>
              sel && navigator.clipboard?.writeText(rowToText(result.columns, processed[sel.r])),
          },
          {
            key: "copy-json",
            label: "Copiar linha como JSON",
            icon: <Braces size={13} />,
            separatorBefore: true,
            onSelect: () =>
              sel &&
              navigator.clipboard?.writeText(
                JSON.stringify(
                  Object.fromEntries(result.columns.map((c, i) => [c.name, processed[sel.r][i]])),
                  null,
                  2
                )
              ),
          },
        ])}
      </div>

      {/* Pagination — each page is one server round trip. */}
      {paged && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line px-2.5 text-2xs text-content-muted">
          <span className="flex items-center gap-1">
            Linhas por página:
            {PAGE_SIZES.map((s) => (
              <button
                key={s}
                onClick={() => changePageSize(s)}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono",
                  s === pageSize ? "bg-iris/15 text-iris" : "hover:text-content"
                )}
              >
                {s}
              </button>
            ))}
          </span>
          <div className="flex-1" />
          <span className="font-mono">
            {fmtNumber(firstRow)}–{fmtNumber(lastRow)}
            {result.totalRows !== undefined && ` de ${fmtNumber(result.totalRows)}`}
          </span>
          <IconButton
            size="sm"
            disabled={!canPrev || loading}
            onClick={() => onFetchPage?.(Math.max(0, result.offset - pageSize), pageSize)}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <IconButton
            size="sm"
            disabled={!canNext || loading}
            onClick={() => onFetchPage?.(result.offset + result.rows.length, pageSize)}
          >
            <ChevronRight size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function AffectedFeedback({ result }: { result: QueryResult }) {
  return (
    <div className="flex h-full items-center justify-center bg-base p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-amber/15 text-amber">
          <CheckCircle2 size={26} />
        </div>
        <div>
          <div className="text-lg font-semibold text-content">
            {fmtNumber(result.affectedRows ?? 0)} linhas afetadas
          </div>
          <p className="mt-1 text-xs text-content-muted">
            Comando <span className="font-mono text-amber">{result.command}</span> executado com
            sucesso em <span className="font-mono">{result.durationMs} ms</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorFeedback({ result }: { result: QueryResult }) {
  return (
    <div className="flex h-full items-center justify-center bg-base p-8">
      <div className="max-w-lg rounded-xl border border-rose/40 bg-rose/[0.06] p-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-rose">
          <Search size={15} /> Erro de sintaxe
        </div>
        <p className="font-mono text-xs text-content-muted">{result.error?.message}</p>
      </div>
    </div>
  );
}
