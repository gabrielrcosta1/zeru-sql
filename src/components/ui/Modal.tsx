import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 flex max-h-[86vh] w-full animate-slide-in flex-col overflow-hidden rounded-2xl border border-line-strong/70 bg-surface shadow-pop",
          width
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          {icon && <div className="mt-0.5">{icon}</div>}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-content">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-content-muted">{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={16} />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-base/40 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
