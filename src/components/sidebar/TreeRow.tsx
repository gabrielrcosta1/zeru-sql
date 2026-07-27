import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function TreeRow({
  depth = 0,
  icon,
  label,
  meta,
  badge,
  expandable,
  expanded,
  active,
  onToggle,
  onClick,
  onContextMenu,
  trailing,
}: {
  depth?: number;
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  active?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        "group/row flex h-[26px] cursor-default select-none items-center gap-1.5 rounded-md pr-2 text-xs transition-colors",
        active
          ? "bg-iris/15 text-content"
          : "text-content-muted hover:bg-white/[0.05] hover:text-content"
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded text-content-faint transition-transform",
          !expandable && "invisible",
          expanded && "rotate-90"
        )}
      >
        <ChevronRight size={12} />
      </button>
      {icon && <span className="grid h-4 w-4 shrink-0 place-items-center">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {badge}
      {meta && <span className="text-2xs text-content-faint">{meta}</span>}
      {trailing && (
        <span className="opacity-0 transition-opacity group-hover/row:opacity-100">{trailing}</span>
      )}
    </div>
  );
}
