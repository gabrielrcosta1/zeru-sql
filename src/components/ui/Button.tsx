import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "default" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-iris text-white hover:bg-iris-hi active:bg-iris-lo shadow-[0_1px_0_0_rgb(255_255_255/0.12)_inset] disabled:bg-iris/40",
  default:
    "bg-elevated text-content hover:bg-hover border border-line-strong/70 hover:border-line-strong",
  subtle: "bg-white/[0.03] text-content-muted hover:bg-white/[0.06] hover:text-content",
  ghost: "text-content-muted hover:bg-white/[0.06] hover:text-content",
  danger: "bg-rose/90 text-white hover:bg-rose",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "no-drag inline-flex select-none items-center justify-center font-medium transition-all duration-200 ease-soft",
        "focus-visible:ring-2 focus-visible:ring-iris/60 focus-visible:ring-offset-0",
        "active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, active, size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "no-drag inline-grid place-items-center rounded-md text-content-muted transition-all duration-200 ease-soft",
        "hover:bg-white/[0.07] hover:text-content focus-visible:ring-2 focus-visible:ring-iris/60",
        "active:scale-90",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:active:scale-100",
        size === "sm" ? "h-6 w-6" : "h-8 w-8",
        active && "bg-iris/15 text-iris hover:bg-iris/20 hover:text-iris",
        className
      )}
      {...props}
    />
  )
);
IconButton.displayName = "IconButton";
