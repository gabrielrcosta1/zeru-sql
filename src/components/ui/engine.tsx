import type { Engine } from "@/types";
import { cn } from "@/lib/cn";

export const ENGINE_META: Record<
  Engine,
  {
    label: string;
    short: string;
    color: string;
    defaultPort?: number;
    /** False while the backend's `build_pool` still rejects this engine. */
    supported: boolean;
  }
> = {
  postgres: { label: "PostgreSQL", short: "PG", color: "#4f8ed6", defaultPort: 5432, supported: true },
  mysql: { label: "MySQL", short: "My", color: "#e0932f", defaultPort: 3306, supported: true },
  mariadb: { label: "MariaDB", short: "Ma", color: "#9b7bd4", defaultPort: 3306, supported: true },
  sqlite: { label: "SQLite", short: "Li", color: "#4bb3c4", supported: false },
  sqlserver: { label: "SQL Server", short: "MS", color: "#d15b5b", defaultPort: 1433, supported: false },
};

/** Abstract engine badge — a rounded tile with the engine's brand hue. */
export function EngineIcon({
  engine,
  size = 20,
  className,
}: {
  engine: Engine;
  size?: number;
  className?: string;
}) {
  const meta = ENGINE_META[engine];
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md font-semibold leading-none text-white",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(150deg, ${meta.color}, ${meta.color}bb)`,
        boxShadow: `0 0 0 1px ${meta.color}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
      }}
    >
      {meta.short}
    </span>
  );
}
