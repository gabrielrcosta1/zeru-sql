import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Table2, Plug, Layers, Play, CornerDownLeft, Sparkles } from "lucide-react";
import { useApp } from "@/store/app";
import { cn } from "@/lib/cn";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: string;
  run: () => void;
}

export function CommandPalette() {
  const {
    commandPaletteOpen,
    openCommandPalette,
    setCenterView,
    openConnectionModal,
    newTab,
    setRightView,
    databaseTree,
  } = useApp();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  // The palette stays mounted (it owns the global ⌘K listener), so its query
  // is reset during render when the open flag flips — React's documented
  // "adjust state on prop change" pattern, which avoids a cascading effect.
  const [wasOpen, setWasOpen] = useState(commandPaletteOpen);
  if (commandPaletteOpen !== wasOpen) {
    setWasOpen(commandPaletteOpen);
    if (commandPaletteOpen) {
      setQ("");
      setActive(0);
    }
  }

  const commands = useMemo<Cmd[]>(() => {
    const tables = databaseTree?.schemas.flatMap((s) => s.tables) ?? [];
    const tableCmds: Cmd[] = tables.map((t) => ({
      id: `t-${t.name}`,
      label: t.name,
      hint: "abrir tabela",
      icon: <Table2 size={14} className="text-iris" />,
      group: "Tabelas",
      run: () => setCenterView({ kind: "table", table: t.name }),
    }));
    const actions: Cmd[] = [
      {
        id: "a-conn",
        label: "Nova conexão",
        icon: <Plug size={14} className="text-teal" />,
        group: "Ações",
        run: () => openConnectionModal(true),
      },
      {
        id: "a-rel",
        label: "Abrir diagrama de relacionamentos",
        icon: <Layers size={14} className="text-teal" />,
        group: "Ações",
        run: () => setCenterView({ kind: "relationships" }),
      },
      {
        id: "a-query",
        label: "Nova consulta",
        icon: <Play size={14} className="text-teal" />,
        group: "Ações",
        run: () => newTab(),
      },
      {
        id: "a-ai",
        label: "Abrir assistente de IA",
        icon: <Sparkles size={14} className="text-iris" />,
        group: "Ações",
        run: () => setRightView("ai"),
      },
    ];
    return [...actions, ...tableCmds];
  }, [databaseTree, setCenterView, openConnectionModal, newTab, setRightView]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? commands.filter((c) => c.label.toLowerCase().includes(s)) : commands;
  }, [commands, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmd) {
        e.preventDefault();
        openCommandPalette(!commandPaletteOpen);
      }
      if (!commandPaletteOpen) return;
      if (e.key === "Escape") openCommandPalette(false);
      if (e.key === "ArrowDown") setActive((a) => Math.min(filtered.length - 1, a + 1));
      if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
      if (e.key === "Enter") {
        filtered[active]?.run();
        openCommandPalette(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandPaletteOpen, filtered, active, openCommandPalette]);

  if (!commandPaletteOpen) return null;

  let lastGroup = "";

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[14vh]">
      <div
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={() => openCommandPalette(false)}
      />
      <div className="relative z-10 w-full max-w-xl animate-slide-in overflow-hidden rounded-2xl border border-line-strong/70 bg-overlay/95 shadow-pop backdrop-blur-md">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-content-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Buscar tabelas, comandos, ações…"
            className="h-12 w-full bg-transparent text-sm text-content placeholder:text-content-faint focus:outline-none"
          />
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-content-faint">
              Nenhum resultado para “{q}”
            </div>
          )}
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {showGroup && (
                  <div className="px-2.5 pb-1 pt-2 text-3xs font-semibold uppercase tracking-wider text-content-faint">
                    {c.group}
                  </div>
                )}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    c.run();
                    openCommandPalette(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                    i === active ? "bg-iris/15 text-content" : "text-content-muted"
                  )}
                >
                  {c.icon}
                  <span className="flex-1">{c.label}</span>
                  {c.hint && <span className="text-3xs text-content-faint">{c.hint}</span>}
                  {i === active && <CornerDownLeft size={12} className="text-content-faint" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
