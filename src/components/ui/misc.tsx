import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// ── Badge ──────────────────────────────────────────────────────────────────
type Tone = "neutral" | "iris" | "teal" | "amber" | "rose" | "sky";

const toneMap: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-content-muted",
  iris: "bg-iris/15 text-iris",
  teal: "bg-teal/15 text-teal",
  amber: "bg-amber/15 text-amber",
  rose: "bg-rose/15 text-rose",
  sky: "bg-sky/15 text-sky",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium leading-none",
        toneMap[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ── Kbd ──────────────────────────────────────────────────────────────────
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.25rem] items-center justify-center rounded border border-line-strong/70 bg-base px-1 py-0.5 font-mono text-2xs text-content-faint">
      {children}
    </kbd>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────────
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("animate-spin", className)}
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Tooltip (CSS-only, group-based) ─────────────────────────────────────────
export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const pos = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }[side];
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line-strong/70 bg-overlay px-2 py-1 text-2xs text-content shadow-pop",
          "opacity-0 transition-opacity duration-100 group-hover/tt:opacity-100",
          pos
        )}
      >
        {label}
      </span>
    </span>
  );
}

// ── Segmented control ───────────────────────────────────────────────────────
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: "sm" | "md";
}) {
  return (
    <div className="no-drag inline-flex rounded-lg border border-line/80 bg-base/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2 py-1 text-2xs" : "px-2.5 py-1 text-xs",
            value === o.value
              ? "bg-elevated text-content shadow-sm"
              : "text-content-faint hover:text-content-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line", className)} />;
}

export function VDivider({ className }: { className?: string }) {
  return <div className={cn("w-px self-stretch bg-line", className)} />;
}
