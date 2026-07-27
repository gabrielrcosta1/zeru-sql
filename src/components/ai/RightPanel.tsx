import { Sparkles, Clock, PanelRightClose } from "lucide-react";
import { useApp } from "@/store/app";
import { AiPanel } from "./AiPanel";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function RightPanel() {
  const { rightView, setRightView, toggleRight } = useApp();

  return (
    <div className="flex h-full flex-col bg-surface animate-slide-r">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-2 pr-2.5">
        <Tab
          active={rightView === "ai"}
          onClick={() => setRightView("ai")}
          icon={<Sparkles size={13} />}
          label="Assistente"
        />
        <Tab
          active={rightView === "history"}
          onClick={() => setRightView("history")}
          icon={<Clock size={13} />}
          label="Histórico"
        />
        <div className="flex-1" />
        <IconButton size="sm" onClick={toggleRight} aria-label="Recolher painel">
          <PanelRightClose size={15} />
        </IconButton>
      </div>
      <div key={rightView} className="min-h-0 flex-1 animate-fade-in">
        {rightView === "ai" ? <AiPanel /> : <HistoryPanel />}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-white/[0.06] text-content"
          : "text-content-faint hover:text-content-muted"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
