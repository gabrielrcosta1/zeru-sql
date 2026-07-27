import { useMemo, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, Maximize, KeyRound, Link2, Table2 } from "lucide-react";
import type { TableNode } from "@/types";
import { IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/misc";
import { useApp } from "@/store/app";
import { fmtRows } from "@/lib/format";

const NODE_W = 168;
const ROW_H = 20;
const HEAD_H = 30;
const CELL_W = 250;
const CELL_H = 240;

interface Edge {
  from: string;
  to: string;
}

export function RelationshipsDiagram() {
  const { setCenterView, databaseTree } = useApp();

  const tables = useMemo<TableNode[]>(
    () => databaseTree?.schemas.flatMap((s) => s.tables) ?? [],
    [databaseTree]
  );

  const edges = useMemo<Edge[]>(() => {
    const names = new Set(tables.map((t) => t.name));
    const out: Edge[] = [];
    for (const t of tables) {
      for (const c of t.columns) {
        // Only draw edges whose target table is present in the diagram.
        if (c.fk && names.has(c.fk.table)) out.push({ from: t.name, to: c.fk.table });
      }
    }
    return out;
  }, [tables]);

  // Auto-layout: pack nodes into a roughly-square grid so any schema renders.
  const positions = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
    const map = new Map<string, { x: number; y: number }>();
    tables.forEach((t, i) => {
      map.set(t.name, { x: 20 + (i % cols) * CELL_W, y: 20 + Math.floor(i / cols) * CELL_H });
    });
    return map;
  }, [tables]);

  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 20, y: 10 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const nodeHeight = (name: string) => {
    const t = tables.find((x) => x.name === name);
    return HEAD_H + Math.min(t?.columns.length ?? 4, 7) * ROW_H + 8;
  };
  const center = (name: string) => {
    const p = positions.get(name) ?? { x: 0, y: 0 };
    return { x: p.x + NODE_W / 2, y: p.y + nodeHeight(name) / 2 };
  };

  const canvasW = (Math.max(1, Math.ceil(Math.sqrt(tables.length)))) * CELL_W + 200;
  const canvasH = Math.ceil(tables.length / Math.max(1, Math.ceil(Math.sqrt(tables.length)))) * CELL_H + 200;

  if (!databaseTree || tables.length === 0)
    return (
      <div className="relative grid h-full place-items-center bg-base">
        <div className="flex flex-col items-center gap-2 text-center">
          <Table2 size={24} className="text-content-faint/60" />
          <p className="text-2xs text-content-faint">
            Conecte-se a um banco para ver o diagrama de relacionamentos.
          </p>
        </div>
        <IconButton
          size="sm"
          className="absolute right-4 top-4"
          onClick={() => setCenterView({ kind: "editor" })}
        >
          <X size={15} />
        </IconButton>
      </div>
    );

  return (
    <div className="relative h-full overflow-hidden bg-base">
      {/* dotted grid backdrop */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: "radial-gradient(rgb(48 55 66 / 0.5) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Toolbar */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-xl border border-line-strong/60 bg-surface/90 px-3 py-2 backdrop-blur">
        <Table2 size={15} className="text-teal" />
        <span className="text-xs font-semibold text-content">
          Relacionamentos · {databaseTree.name}
        </span>
        <span className="text-2xs text-content-faint">{edges.length} chaves estrangeiras</span>
      </div>

      <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-line-strong/60 bg-surface/90 p-1 backdrop-blur">
        <Tooltip label="Aproximar">
          <IconButton size="sm" onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}>
            <ZoomIn size={15} />
          </IconButton>
        </Tooltip>
        <span className="w-10 text-center font-mono text-2xs text-content-muted">
          {Math.round(zoom * 100)}%
        </span>
        <Tooltip label="Afastar">
          <IconButton size="sm" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>
            <ZoomOut size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Ajustar">
          <IconButton
            size="sm"
            onClick={() => {
              setZoom(0.9);
              setPan({ x: 20, y: 10 });
            }}
          >
            <Maximize size={15} />
          </IconButton>
        </Tooltip>
        <IconButton size="sm" onClick={() => setCenterView({ kind: "editor" })}>
          <X size={15} />
        </IconButton>
      </div>

      {/* Canvas */}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onMouseMove={(e) => {
          if (!drag.current) return;
          setPan({
            x: drag.current.px + (e.clientX - drag.current.x),
            y: drag.current.py + (e.clientY - drag.current.y),
          });
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            setZoom((z) => Math.max(0.4, Math.min(1.6, z - e.deltaY * 0.001)));
          }
        }}
      >
        <div
          className="absolute origin-top-left"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {/* Edges */}
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={canvasW}
            height={canvasH}
          >
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="rgb(96 178 246)" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = center(e.from);
              const b = center(e.to);
              const active = hover === e.from || hover === e.to;
              const midX = (a.x + b.x) / 2;
              return (
                <path
                  key={i}
                  d={`M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`}
                  fill="none"
                  stroke={active ? "rgb(124 137 255)" : "rgb(72 82 99)"}
                  strokeWidth={active ? 2 : 1.25}
                  markerEnd="url(#arrow)"
                  opacity={hover && !active ? 0.25 : 0.9}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {tables.map((t) => {
            const p = positions.get(t.name) ?? { x: 0, y: 0 };
            const dim =
              hover &&
              hover !== t.name &&
              !edges.some(
                (e) =>
                  (e.from === t.name && e.to === hover) || (e.to === t.name && e.from === hover)
              );
            return (
              <div
                key={t.name}
                onMouseEnter={() => setHover(t.name)}
                onMouseLeave={() => setHover(null)}
                onDoubleClick={() => setCenterView({ kind: "table", table: t.name })}
                style={{ left: p.x, top: p.y, width: NODE_W }}
                className={`absolute rounded-lg border bg-surface shadow-pop transition-opacity ${
                  hover === t.name ? "border-iris/70" : "border-line-strong/70"
                } ${dim ? "opacity-40" : "opacity-100"}`}
              >
                <div className="flex items-center gap-1.5 rounded-t-lg border-b border-line bg-elevated px-2.5" style={{ height: HEAD_H }}>
                  <Table2 size={12} className="text-iris" />
                  <span className="flex-1 truncate font-mono text-xs font-semibold text-content">
                    {t.name}
                  </span>
                  <span className="text-3xs text-content-faint">{fmtRows(t.approxRows)}</span>
                </div>
                <div className="py-1">
                  {t.columns.slice(0, 7).map((c) => (
                    <div
                      key={c.name}
                      className="flex items-center gap-1.5 px-2.5 font-mono text-2xs"
                      style={{ height: ROW_H }}
                    >
                      {c.pk ? (
                        <KeyRound size={9} className="text-amber" />
                      ) : c.fk ? (
                        <Link2 size={9} className="text-sky" />
                      ) : (
                        <span className="h-1 w-1 rounded-full bg-line-strong" />
                      )}
                      <span className={c.pk ? "text-content" : "text-content-muted"}>{c.name}</span>
                      <span className="ml-auto text-content-faint/70">{c.type.replace(/\(.*\)/, "")}</span>
                    </div>
                  ))}
                  {t.columns.length > 7 && (
                    <div className="px-2.5 text-3xs text-content-faint" style={{ height: ROW_H }}>
                      +{t.columns.length - 7} colunas
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-20 rounded-lg border border-line/70 bg-surface/80 px-3 py-1.5 text-3xs text-content-faint backdrop-blur">
        Arraste para mover · ⌘+scroll para zoom · duplo-clique abre a tabela
      </div>
    </div>
  );
}
