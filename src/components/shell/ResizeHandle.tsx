import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/cn";

export function ResizeHandle({
  direction = "vertical",
  className,
}: {
  direction?: "vertical" | "horizontal";
  className?: string;
}) {
  const isV = direction === "vertical";
  return (
    <PanelResizeHandle
      className={cn(
        "group relative flex items-center justify-center bg-line/60 transition-colors data-[resize-handle-state=drag]:bg-iris data-[resize-handle-state=hover]:bg-iris/60",
        isV ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        className
      )}
    >
      <span
        className={cn(
          "absolute z-10",
          isV ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1"
        )}
      />
    </PanelResizeHandle>
  );
}
