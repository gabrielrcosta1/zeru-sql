import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
}

interface MenuProps {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

function MenuList({ items, x, y, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) ny = window.innerHeight - r.height - 8;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[100] min-w-[190px] animate-slide-in rounded-lg border border-line-strong/70 bg-overlay/95 p-1 shadow-pop backdrop-blur-md"
    >
      {items.map((it) => (
        <div key={it.key}>
          {it.separatorBefore && <div className="my-1 h-px bg-line" />}
          <button
            disabled={it.disabled}
            onClick={() => {
              it.onSelect?.();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-40",
              it.danger
                ? "text-rose hover:bg-rose/15"
                : "text-content-muted hover:bg-white/[0.07] hover:text-content"
            )}
          >
            {it.icon && <span className="grid h-4 w-4 place-items-center">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && (
              <span className="font-mono text-2xs text-content-faint">{it.shortcut}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Hook that wires up a right-click context menu for an element. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number } | null>(null);
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY });
  };
  const close = () => setState(null);
  const render = (items: MenuItem[]) =>
    state
      ? createPortal(
          <MenuList items={items} x={state.x} y={state.y} onClose={close} />,
          document.body
        )
      : null;
  return { open, close, render, isOpen: !!state };
}

/** Anchored dropdown opened by a trigger button. */
export function Dropdown({
  trigger,
  items,
  align = "left",
}: {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; open: boolean }) => ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const onClick = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchor({ x: align === "right" ? r.right - 190 : r.left, y: r.bottom + 4 });
  };
  return (
    <>
      {trigger({ onClick, open: !!anchor })}
      {anchor &&
        createPortal(
          <MenuList items={items} x={anchor.x} y={anchor.y} onClose={() => setAnchor(null)} />,
          document.body
        )}
    </>
  );
}
