import {
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Search,
  Sparkles,
  ChevronDown,
  Circle,
} from "lucide-react";
import { useApp } from "@/store/app";
import { EngineIcon } from "@/components/ui/engine";
import { IconButton, Button } from "@/components/ui/Button";
import { Tooltip, Kbd, VDivider } from "@/components/ui/misc";
import { Dropdown } from "@/components/ui/Menu";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/cn";

function ZeruMark() {
  return (
    <div data-tauri-drag-region className="flex items-center gap-2 pl-1">
      {/* The real app icon, so the title bar and the Dock show the same mark. */}
      <img
        src="/zeru-icon.png"
        alt=""
        width={22}
        height={22}
        draggable={false}
        className="rounded-[6px]"
      />
      <span className="text-[13px] font-semibold tracking-tight text-content">Zeru</span>
    </div>
  );
}

export function TitleBar() {
  const {
    connections,
    activeConnectionId,
    setActiveConnection,
    sidebarOpen,
    toggleSidebar,
    rightOpen,
    toggleRight,
    openCommandPalette,
    openConnectionModal,
    newTab,
    tabs,
    activeTabId,
    runTab,
  } = useApp();
  const conn = connections.find((c) => c.id === activeConnectionId) ?? connections[0];
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <header
      data-tauri-drag-region
      className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-3 backdrop-blur"
    >
      {/* Reserve room for the native macOS traffic lights */}
      {isMac && <div data-tauri-drag-region className="w-[70px] shrink-0" />}

      <ZeruMark />

      <VDivider className="mx-1 h-5" />

      <Tooltip label={<span className="flex items-center gap-2">Toggle sidebar <Kbd>⌘B</Kbd></span>}>
        <IconButton active={sidebarOpen} onClick={toggleSidebar}>
          <PanelLeft size={16} />
        </IconButton>
      </Tooltip>

      {/* Connection switcher */}
      <Dropdown
        align="left"
        items={[
          ...connections.map((c) => ({
            key: c.id,
            label: (
              <span className="flex items-center gap-2">
                <EngineIcon engine={c.engine} size={16} />
                {c.name}
              </span>
            ),
            onSelect: () => setActiveConnection(c.id),
          })),
          {
            key: "new",
            label: "Nova conexão…",
            separatorBefore: true,
            icon: <Plus size={14} />,
            onSelect: () => openConnectionModal(true),
          },
        ]}
        trigger={({ onClick }) => (
          <button
            onClick={onClick}
            className="no-drag flex h-8 items-center gap-2 rounded-lg border border-line-strong/60 bg-elevated px-2.5 text-xs font-medium text-content transition-colors hover:border-line-strong hover:bg-hover"
          >
            {conn ? (
              <>
                <EngineIcon engine={conn.engine} size={16} />
                <span className="max-w-[150px] truncate">{conn.name}</span>
                {conn.environment && (
                  <span
                    className={cn(
                      "ml-0.5 flex items-center gap-1 rounded px-1 py-0.5 text-2xs",
                      conn.environment === "production"
                        ? "bg-rose/15 text-rose"
                        : "bg-white/[0.06] text-content-faint"
                    )}
                  >
                    <Circle size={6} className="fill-current" />
                    {conn.environment}
                  </span>
                )}
              </>
            ) : (
              <span className="text-content-muted">Conectar banco</span>
            )}
            <ChevronDown size={13} className="text-content-faint" />
          </button>
        )}
      />

      {/* Center: command palette */}
      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <button
          onClick={() => openCommandPalette(true)}
          className="no-drag flex h-8 w-full max-w-md items-center gap-2 rounded-lg border border-line/80 bg-base/50 px-3 text-xs text-content-faint transition-colors hover:border-line-strong hover:text-content-muted"
        >
          <Search size={13} />
          <span>Buscar tabelas, comandos, consultas…</span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      {/* Right actions */}
      <Button
        variant="primary"
        size="sm"
        onClick={() => activeTab && runTab(activeTab.id)}
        className="gap-1.5"
      >
        <Play size={13} className="fill-current" />
        Executar
        <span className="ml-1 hidden opacity-70 md:inline">
          <Kbd>⌘↵</Kbd>
        </span>
      </Button>

      <Tooltip label="Nova aba">
        <IconButton onClick={() => newTab()}>
          <Plus size={16} />
        </IconButton>
      </Tooltip>

      <VDivider className="mx-1 h-5" />

      <Tooltip label={<span className="flex items-center gap-2">Painel IA <Kbd>⌘J</Kbd></span>}>
        <IconButton active={rightOpen} onClick={toggleRight}>
          {rightOpen ? <Sparkles size={16} /> : <PanelRight size={16} />}
        </IconButton>
      </Tooltip>
    </header>
  );
}
