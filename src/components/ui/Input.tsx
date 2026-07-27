import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leading, trailing, invalid, ...props }, ref) => (
    <div
      className={cn(
        "no-drag flex items-center gap-2 rounded-lg border bg-base/60 px-3 transition-colors",
        "border-line-strong/70 focus-within:border-iris focus-within:ring-2 focus-within:ring-iris/25",
        invalid && "border-rose/70 focus-within:border-rose focus-within:ring-rose/25",
        className
      )}
    >
      {leading && <span className="text-content-faint">{leading}</span>}
      <input
        ref={ref}
        className="h-9 w-full bg-transparent text-[13px] text-content placeholder:text-content-faint focus:outline-none"
        {...props}
      />
      {trailing}
    </div>
  )
);
Input.displayName = "Input";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, ...props }, ref) => (
    <div
      className={cn(
        "no-drag flex h-8 items-center gap-2 rounded-md border border-line/80 bg-base/50 px-2.5",
        "focus-within:border-iris/70 focus-within:bg-base",
        containerClassName
      )}
    >
      <Search size={13} className="shrink-0 text-content-faint" />
      <input
        ref={ref}
        className={cn(
          "w-full bg-transparent text-xs text-content placeholder:text-content-faint focus:outline-none",
          className
        )}
        {...props}
      />
    </div>
  )
);
SearchInput.displayName = "SearchInput";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-content-muted">{label}</span>
      {children}
      {hint && <span className="text-2xs text-content-faint">{hint}</span>}
    </label>
  );
}
