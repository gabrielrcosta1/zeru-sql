// ── Core domain types for Zeru's UI layer ─────────────────────────────────
// These describe the *shape* of data the UI renders. They mirror the payloads
// the Rust backend returns from its Tauri commands (see src-tauri/src/db).

export type Engine = "postgres" | "mysql" | "mariadb" | "sqlite" | "sqlserver";

export interface Connection {
  id: string;
  name: string;
  engine: Engine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  filePath?: string; // sqlite
  color: string; // accent used for the connection dot
  ssl?: boolean;
  status: "connected" | "idle" | "error";
  environment?: "local" | "staging" | "production";
}

export type ObjectKind =
  | "table"
  | "view"
  | "function"
  | "procedure"
  | "trigger"
  | "index";

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  pk?: boolean;
  fk?: { table: string; column: string };
  unique?: boolean;
  default?: string;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
  method?: string;
}

export interface TableNode {
  kind: "table" | "view";
  name: string;
  columns: Column[];
  indexes: IndexDef[];
  approxRows: number;
  sizeBytes?: number;
  comment?: string;
}

export interface RoutineNode {
  kind: "function" | "procedure" | "trigger";
  name: string;
  returns?: string;
  language?: string;
  signature?: string;
}

export interface Schema {
  name: string;
  tables: TableNode[];
  views: TableNode[];
  functions: RoutineNode[];
  procedures: RoutineNode[];
  triggers: RoutineNode[];
  indexes: IndexDef[];
}

export interface DatabaseTree {
  name: string;
  schemas: Schema[];
}

// ── Query execution ───────────────────────────────────────────────────────

export type ColumnType = "number" | "string" | "boolean" | "date" | "json" | "uuid" | "null";

export interface ResultColumn {
  name: string;
  type: ColumnType;
  table?: string;
}

/** A decoded cell. `json`/`jsonb` columns arrive as parsed structures, not text. */
export type Cell = string | number | boolean | null | Cell[] | { [key: string]: Cell };

export interface QueryResult {
  kind: "rows" | "affected" | "error";
  /** The single statement that produced this result; replayed when paging. */
  statement: string;
  columns: ResultColumn[];
  rows: Cell[][];
  affectedRows?: number;
  command?: string; // UPDATE / DELETE / INSERT
  durationMs: number;
  /** Index of the first loaded row within the full result set. */
  offset: number;
  /** The server had at least one more row past this page. */
  hasMore: boolean;
  /** Only set once the set was read to the end — unknown while paging. */
  totalRows?: number;
  error?: { message: string; line?: number };
}

// ── Editor tabs ────────────────────────────────────────────────────────────

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  connectionId: string;
  dirty: boolean;
  /** One result per statement in the script, in execution order. */
  results: QueryResult[];
  activeResultIndex: number;
  running?: boolean;
  /** Index of the result currently fetching another page, if any. */
  pagingIndex?: number;
}

/** The result the UI is currently showing for a tab, if any. */
export function activeResult(tab: QueryTab | undefined): QueryResult | undefined {
  return tab?.results[tab.activeResultIndex];
}

// ── AI assistant ─────────────────────────────────────────────────────────

export type AiRole = "user" | "assistant";

export interface AiSqlBlock {
  sql: string;
  destructive: boolean;
  explanation?: string;
}

export interface AiMessage {
  id: string;
  role: AiRole;
  text?: string;
  sql?: AiSqlBlock;
  pending?: boolean;
  contextChips?: string[]; // what the AI is aware of
}

// ── History ────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  at: string; // ISO
  durationMs?: number;
  rows?: number;
  status: "ok" | "error";
  favorite?: boolean;
  source: "editor" | "ai";
}
