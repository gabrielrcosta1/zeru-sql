import { X, Plus, FileCode2, Circle } from "lucide-react";
import { useApp } from "@/store/app";
import { cn } from "@/lib/cn";

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, newTab, centerView } = useApp();

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-surface">
      <div className="flex flex-1 items-stretch overflow-x-auto scrollbar-none">
        {tabs.map((t) => {
          const active = t.id === activeTabId && centerView.kind === "editor";
          return (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "group relative flex min-w-[140px] max-w-[220px] cursor-default items-center gap-2 border-r border-line px-3 text-xs transition-colors",
                active
                  ? "bg-base text-content"
                  : "text-content-muted hover:bg-white/[0.03] hover:text-content"
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-iris" />}
              <FileCode2 size={13} className={active ? "text-iris" : "text-content-faint"} />
              <span className="flex-1 truncate">{t.title}</span>
              {t.dirty ? (
                <Circle
                  size={7}
                  className="fill-content-muted text-content-muted group-hover:hidden"
                />
              ) : null}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className={cn(
                  "grid h-4 w-4 place-items-center rounded text-content-faint hover:bg-white/10 hover:text-content",
                  t.dirty ? "hidden group-hover:grid" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => newTab()}
        className="grid w-9 shrink-0 place-items-center border-l border-line text-content-faint hover:bg-white/[0.04] hover:text-content"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
