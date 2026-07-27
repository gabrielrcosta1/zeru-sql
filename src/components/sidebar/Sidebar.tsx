import { useMemo, useState } from "react";
import {
  Table2,
  Eye,
  FunctionSquare,
  Cog,
  Zap,
  ListTree,
  Layers,
  Plus,
  MoreHorizontal,
  Circle,
  ChevronsDownUp,
  Boxes,
  Loader2,
  Trash2,
} from "lucide-react";
import { useApp } from "@/store/app";
import type { DatabaseTree, RoutineNode, Schema } from "@/types";
import { EngineIcon } from "@/components/ui/engine";
import { SearchInput } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/misc";
import { TreeRow } from "./TreeRow";
import { TableBranch } from "./TableBranch";
import { cn } from "@/lib/cn";

type GroupKey = "tables" | "views" | "functions" | "procedures" | "triggers" | "indexes";

const GROUPS: { key: GroupKey; label: string; icon: typeof Table2 }[] = [
  { key: "tables", label: "Tables", icon: Table2 },
  { key: "views", label: "Views", icon: Eye },
  { key: "functions", label: "Functions", icon: FunctionSquare },
  { key: "procedures", label: "Procedures", icon: Cog },
  { key: "triggers", label: "Triggers", icon: Zap },
  { key: "indexes", label: "Indexes", icon: ListTree },
];

const EMPTY_SCHEMA: Schema = {
  name: "",
  tables: [],
  views: [],
  functions: [],
  procedures: [],
  triggers: [],
  indexes: [],
};

const EMPTY_TREE: DatabaseTree = { name: "", schemas: [] };

/**
 * Starter SQL for a routine opened from the tree. Triggers carry their full
 * `CREATE TRIGGER` on Postgres, so those go in as-is; the rest get a commented
 * header plus a callable stub, since a bare signature is not valid SQL.
 */
function routineSnippet(r: RoutineNode): string {
  const header = `-- ${r.signature ?? r.name}${r.returns ? ` → ${r.returns}` : ""}`;
  if (r.kind === "trigger") {
    return r.signature?.toUpperCase().includes("CREATE") ? r.signature : header;
  }
  if (r.kind === "procedure") return `${header}\nCALL ${r.name}();`;
  return `${header}\nSELECT ${r.name}();`;
}

export function Sidebar() {
  const {
    connections,
    databaseTree,
    activeConnectionId,
    connecting,
    setActiveConnection,
    connectSaved,
    removeConnection,
    openConnectionModal,
    newTab,
  } = useApp();
  const [query, setQuery] = useState("");
  const [schemaIdx, setSchemaIdx] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({ tables: true });
  const [connOpen, setConnOpen] = useState(true);

  // Live tree from the backend once a connection is open; empty otherwise.
  const db = databaseTree ?? EMPTY_TREE;
  const schema = db.schemas[schemaIdx] ?? db.schemas[0] ?? EMPTY_SCHEMA;
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const match = (n: string) => n.toLowerCase().includes(q);
    return {
      tables: schema.tables.filter((t) => !q || match(t.name)),
      views: schema.views.filter((t) => !q || match(t.name)),
      functions: schema.functions.filter((t) => !q || match(t.name)),
      procedures: schema.procedures.filter((t) => !q || match(t.name)),
      triggers: schema.triggers.filter((t) => !q || match(t.name)),
      indexes: schema.indexes.filter((t) => !q || match(t.name)),
    };
  }, [schema, q]);

  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="flex h-full flex-col bg-surface animate-slide-l">
      {/* Connections section */}
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <button
          onClick={() => setConnOpen((v) => !v)}
          className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-content-faint hover:text-content-muted"
        >
          <ChevronsDownUp size={12} />
          Conexões
        </button>
        <Tooltip label="Nova conexão">
          <IconButton size="sm" onClick={() => openConnectionModal(true)}>
            <Plus size={14} />
          </IconButton>
        </Tooltip>
      </div>

      {connOpen && (
        <div className="px-2">
          {connections.length === 0 && (
            <button
              onClick={() => openConnectionModal(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-2xs text-content-faint hover:bg-white/[0.04] hover:text-content-muted"
            >
              <Plus size={12} />
              Nenhuma conexão — criar uma
            </button>
          )}
          {connections.map((c) => {
            const isActive = c.id === activeConnectionId;
            const onRowClick = () => {
              if (c.status === "connected") {
                setActiveConnection(c.id);
              } else if (!connecting) {
                connectSaved(c.id);
              }
            };
            return (
              <div
                key={c.id}
                onClick={onRowClick}
                title={c.status === "connected" ? c.name : `${c.name} — clique para conectar`}
                className={cn(
                  "group flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-xs transition-colors",
                  isActive
                    ? "bg-white/[0.06] text-content"
                    : "text-content-muted hover:bg-white/[0.04]"
                )}
              >
                <EngineIcon engine={c.engine} size={16} />
                <span className="flex-1 truncate">{c.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeConnection(c.id);
                  }}
                  title="Remover conexão"
                  className="hidden shrink-0 rounded p-0.5 text-content-faint hover:text-rose group-hover:block"
                >
                  <Trash2 size={12} />
                </button>
                {connecting && isActive && c.status !== "connected" ? (
                  <Loader2 size={11} className="animate-spin text-content-faint" />
                ) : c.status === "connected" ? (
                  <Circle size={7} className="fill-teal text-teal" />
                ) : c.status === "error" ? (
                  <Circle size={7} className="fill-rose text-rose" />
                ) : (
                  <Circle size={7} className="text-line-strong" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mx-3 my-2 h-px bg-line" />

      {!databaseTree ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Boxes size={22} className="text-content-faint/60" />
          <p className="text-2xs text-content-faint">
            Conecte-se a um banco para explorar schemas e tabelas.
          </p>
        </div>
      ) : (
        <>
          {/* Database + schema */}
          <div className="flex items-center gap-2 px-3 pb-2">
            <Boxes size={14} className="text-iris" />
            <span className="text-xs font-semibold text-content">{db.name}</span>
            <div className="ml-auto flex items-center gap-1">
              {db.schemas.map((s, i) => (
                <button
                  key={s.name}
                  onClick={() => setSchemaIdx(i)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-2xs font-medium transition-colors",
                    i === schemaIdx
                      ? "bg-iris/15 text-iris"
                      : "text-content-faint hover:text-content-muted"
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="px-2.5 pb-2">
            <SearchInput
              placeholder="Filtrar objetos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Object tree */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-3">
            {GROUPS.map(({ key, label, icon: Icon }) => {
          const items = filtered[key];
          const isOpen = open[key] || (!!q && items.length > 0);
          return (
            <div key={key}>
              <TreeRow
                icon={<Icon size={13} className="text-content-faint" />}
                label={<span className="font-medium">{label}</span>}
                meta={String(items.length)}
                expandable
                expanded={isOpen}
                onToggle={() => toggle(key)}
                onClick={() => toggle(key)}
              />
              {isOpen &&
                key === "tables" &&
                filtered.tables.map((t) => (
                  <TableBranch key={t.name} node={t} depth={1} schema={schema.name} />
                ))}
              {isOpen &&
                key === "views" &&
                filtered.views.map((t) => (
                  <TableBranch key={t.name} node={t} depth={1} schema={schema.name} />
                ))}
              {isOpen &&
                (key === "functions" || key === "procedures" || key === "triggers") &&
                filtered[key].map((r) => (
                  <TreeRow
                    key={r.name}
                    depth={1}
                    icon={<Icon size={12} className="text-content-faint" />}
                    label={r.name}
                    meta={r.returns ?? r.language ?? undefined}
                    onClick={() => newTab(routineSnippet(r), r.name)}
                    trailing={<MoreHorizontal size={13} className="text-content-faint" />}
                  />
                ))}
              {isOpen &&
                key === "indexes" &&
                filtered.indexes.map((ix) => (
                  <TreeRow
                    key={ix.name}
                    depth={1}
                    icon={<ListTree size={12} className="text-content-faint" />}
                    label={ix.name}
                    meta={ix.unique ? "unique" : ix.method}
                  />
                ))}
            </div>
          );
        })}

            {/* Relationships shortcut */}
            <div className="mx-1 my-2 h-px bg-line" />
            <RelationshipsShortcut />
          </div>
        </>
      )}
    </div>
  );
}

function RelationshipsShortcut() {
  const { setCenterView, centerView } = useApp();
  return (
    <TreeRow
      icon={<Layers size={13} className="text-teal" />}
      label={<span className="font-medium">Diagrama de relacionamentos</span>}
      active={centerView.kind === "relationships"}
      onClick={() => setCenterView({ kind: "relationships" })}
    />
  );
}
