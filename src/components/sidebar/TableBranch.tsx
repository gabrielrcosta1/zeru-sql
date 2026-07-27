import { useState } from "react";
import {
  Table2,
  Eye,
  KeyRound,
  Link2,
  Columns3,
  ListTree,
  Hash,
  Play,
  Copy,
  Sparkles,
  Braces,
} from "lucide-react";
import type { TableNode } from "@/types";
import { TreeRow } from "./TreeRow";
import { useContextMenu } from "@/components/ui/Menu";
import { useApp } from "@/store/app";
import { fmtRows } from "@/lib/format";

function colTypeColor(type: string) {
  if (/int|numeric|serial|bigint|decimal|real|double/.test(type)) return "text-sky";
  if (/char|text|varchar|uuid/.test(type)) return "text-teal";
  if (/bool/.test(type)) return "text-amber";
  if (/time|date/.test(type)) return "text-iris";
  if (/json/.test(type)) return "text-rose";
  return "text-content-faint";
}

export function TableBranch({
  node,
  depth,
  schema,
}: {
  node: TableNode;
  depth: number;
  /** Owning schema, needed to build SQL that actually runs. */
  schema?: string;
}) {
  const [open, setOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(true);
  const [idxOpen, setIdxOpen] = useState(false);
  const menu = useContextMenu();
  const { newTab, setCenterView, setRightView, sendAi, connections, activeConnectionId } =
    useApp();

  const engine = connections.find((c) => c.id === activeConnectionId)?.engine;
  // Identifiers must be quoted: plenty of real table names are reserved words
  // (`user` is one in Postgres), and an unquoted, unqualified name produces SQL
  // the server rejects.
  const quote = (id: string) =>
    engine === "mysql" || engine === "mariadb" ? `\`${id}\`` : `"${id}"`;
  const qualified = schema ? `${quote(schema)}.${quote(node.name)}` : quote(node.name);
  const selectAll = `SELECT *\nFROM ${qualified}\nLIMIT 200;`;

  const openData = () => newTab(selectAll, node.name);

  const copy = (value: string) =>
    navigator.clipboard
      ?.writeText(value)
      .catch((e) => console.warn("Falha ao copiar:", e));

  return (
    <>
      <TreeRow
        depth={depth}
        expandable
        expanded={open}
        onToggle={() => setOpen((v) => !v)}
        onClick={() => setCenterView({ kind: "table", table: node.name })}
        onContextMenu={menu.open}
        icon={
          node.kind === "view" ? (
            <Eye size={13} className="text-content-faint" />
          ) : (
            <Table2 size={13} className="text-iris/80" />
          )
        }
        label={node.name}
        meta={fmtRows(node.approxRows)}
      />
      {menu.render([
        { key: "data", label: "Ver dados", icon: <Play size={13} />, onSelect: openData },
        {
          key: "struct",
          label: "Abrir estrutura",
          icon: <Columns3 size={13} />,
          onSelect: () => setCenterView({ kind: "table", table: node.name }),
        },
        {
          key: "ai",
          label: "Perguntar à IA sobre esta tabela",
          icon: <Sparkles size={13} />,
          onSelect: () => {
            setRightView("ai");
            sendAi(`Me explique a tabela ${qualified} e o que dá para consultar nela.`);
          },
        },
        {
          key: "copy",
          label: "Copiar nome",
          icon: <Copy size={13} />,
          separatorBefore: true,
          onSelect: () => copy(schema ? `${schema}.${node.name}` : node.name),
        },
        {
          key: "select",
          label: "Copiar SELECT *",
          icon: <Braces size={13} />,
          onSelect: () => copy(selectAll),
        },
      ])}

      {open && (
        <>
          {/* Columns folder */}
          <TreeRow
            depth={depth + 1}
            expandable
            expanded={colsOpen}
            onToggle={() => setColsOpen((v) => !v)}
            icon={<Columns3 size={12} className="text-content-faint" />}
            label="Colunas"
            meta={String(node.columns.length)}
          />
          {colsOpen &&
            node.columns.map((c) => (
              <TreeRow
                key={c.name}
                depth={depth + 2}
                icon={
                  c.pk ? (
                    <KeyRound size={12} className="text-amber" />
                  ) : c.fk ? (
                    <Link2 size={12} className="text-sky" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
                  )
                }
                label={
                  <span className="flex items-center gap-1.5">
                    <span className={c.pk ? "font-medium text-content" : ""}>{c.name}</span>
                    {!c.nullable && !c.pk && (
                      <span className="text-2xs text-content-faint">·</span>
                    )}
                  </span>
                }
                meta={<span className={colTypeColor(c.type)}>{c.type}</span>}
              />
            ))}

          {/* Indexes folder */}
          <TreeRow
            depth={depth + 1}
            expandable
            expanded={idxOpen}
            onToggle={() => setIdxOpen((v) => !v)}
            icon={<ListTree size={12} className="text-content-faint" />}
            label="Índices"
            meta={String(node.indexes.length)}
          />
          {idxOpen &&
            node.indexes.map((ix) => (
              <TreeRow
                key={ix.name}
                depth={depth + 2}
                icon={<Hash size={12} className="text-content-faint" />}
                label={ix.name}
                meta={ix.unique ? "unique" : ix.method}
              />
            ))}
        </>
      )}
    </>
  );
}
