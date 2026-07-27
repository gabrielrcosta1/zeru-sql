// ── Backend bridge ────────────────────────────────────────────────────────
// Typed wrappers around the Tauri `invoke` commands exposed by src-tauri.
// `isTauri` lets the UI degrade gracefully when running in a plain browser
// (e.g. `vite` preview without the Tauri shell), where no backend exists.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DatabaseTree, Engine, HistoryEntry, QueryResult } from "@/types";

/** True when running inside the Tauri runtime (native backend available). */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Connection parameters sent to the backend (password is transient). */
export interface ConnectPayload {
  id: string;
  engine: Engine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  filePath?: string;
}

/** Metadata returned after a successful `connect`. */
export interface ConnectionInfo {
  id: string;
  engine: Engine;
  database?: string;
  serverVersion: string;
}

/** Validate a config without registering the connection. */
export function testConnection(config: ConnectPayload): Promise<string> {
  return invoke<string>("test_connection", { config });
}

/** Open and register a connection pool; returns server metadata. */
export function connect(config: ConnectPayload): Promise<ConnectionInfo> {
  return invoke<ConnectionInfo>("connect", { config });
}

/** Close a registered connection. */
export function disconnect(id: string): Promise<boolean> {
  return invoke<boolean>("disconnect", { id });
}

/** List databases visible on an open connection's server. */
export function listDatabases(id: string): Promise<string[]> {
  return invoke<string[]>("list_databases", { id });
}

/** Fetch the full schema tree for an open connection. */
export function getDatabaseTree(id: string): Promise<DatabaseTree> {
  return invoke<DatabaseTree>("get_database_tree", { id });
}

/**
 * Execute a SQL script on an open connection: one result per statement, in
 * order. A statement that fails ends the run, and its failure comes back as a
 * trailing result of kind `"error"` — results before it are still returned.
 */
export function runQuery(
  id: string,
  sql: string,
  limit?: number
): Promise<QueryResult[]> {
  return invoke<QueryResult[]>("run_query", { id, sql, limit });
}

/**
 * Re-run a single statement to load the page starting at `offset`. Pass the
 * `statement` field of a previous result.
 */
export function fetchPage(
  id: string,
  sql: string,
  offset: number,
  limit?: number
): Promise<QueryResult> {
  return invoke<QueryResult>("fetch_page", { id, sql, offset, limit });
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Connection metadata persisted to disk (password stored separately). */
export interface SavedConnection {
  id: string;
  name: string;
  engine: Engine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  ssl?: boolean;
  filePath?: string;
  color?: string;
  environment?: "local" | "staging" | "production";
}

/**
 * Persist a connection's metadata to disk and its password to the OS keychain.
 * Pass `password: ""` to clear a stored secret; `undefined` leaves it untouched.
 */
export function saveConnection(
  connection: SavedConnection,
  password?: string
): Promise<void> {
  return invoke<void>("save_connection", { connection, password });
}

/** Load all persisted connection metadata (passwords excluded). */
export function loadConnections(): Promise<SavedConnection[]> {
  return invoke<SavedConnection[]>("load_connections");
}

/** Fetch a saved connection's password from the keychain, if present. */
export function loadPassword(id: string): Promise<string | null> {
  return invoke<string | null>("load_password", { id });
}

/** Delete a saved connection's metadata and keychain password. */
export function deleteConnection(id: string): Promise<void> {
  return invoke<void>("delete_connection", { id });
}

// ── Query history ───────────────────────────────────────────────────────────

/** Load the persisted query history, newest first. */
export function loadHistory(): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("load_history");
}

/** Record an executed query. */
export function pushHistory(entry: HistoryEntry): Promise<void> {
  return invoke<void>("push_history", { entry });
}

/**
 * Mark or unmark a history entry as a favourite. Resolves to `null` when the
 * id is no longer stored (it may have been pruned).
 */
export function setHistoryFavorite(
  id: string,
  favorite: boolean
): Promise<boolean | null> {
  return invoke<boolean | null>("set_history_favorite", { id, favorite });
}

/** Wipe the history, favourites included. */
export function clearHistory(): Promise<void> {
  return invoke<void>("clear_history");
}

// ── AI assistant ────────────────────────────────────────────────────────────

/**
 * Provider settings. There is deliberately no `apiKey` field: the key lives in
 * the OS keychain and the backend never hands it back, so the UI can only know
 * *whether* one is set.
 */
export interface AiSettings {
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  hasApiKey: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function loadAiSettings(): Promise<AiSettings> {
  return invoke<AiSettings>("load_ai_settings");
}

/** Pass `apiKey: ""` to remove a stored key, or omit it to keep the current one. */
export function saveAiSettings(
  settings: AiSettings,
  apiKey?: string
): Promise<AiSettings> {
  return invoke<AiSettings>("save_ai_settings", { settings, apiKey });
}

/** Start a streaming completion. Progress arrives through `listenAi`. */
export function aiChat(requestId: string, messages: ChatMessage[]): Promise<void> {
  return invoke<void>("ai_chat", { requestId, messages });
}

/** Stop a stream. Resolves false when it had already finished. */
export function aiCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("ai_cancel", { requestId });
}

/**
 * Run a completion and resolve with the whole text, without rendering it.
 *
 * Used for internal reasoning steps the user should not see as chat. It rides
 * on the same streaming command — the backend already delivers the full text
 * in `ai:done`, so no separate non-streaming endpoint is needed.
 */
export async function aiComplete(
  requestId: string,
  messages: ChatMessage[]
): Promise<string> {
  let unlisten: (() => void) | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      listenAi(requestId, {
        onDelta: () => {},
        onDone: resolve,
        onError: (message) => reject(new Error(message)),
      })
        .then((un) => {
          unlisten = un;
          return aiChat(requestId, messages);
        })
        .catch(reject);
    });
  } finally {
    unlisten?.();
  }
}

export interface AiStreamHandlers {
  onDelta: (text: string) => void;
  onDone: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Subscribe to one request's stream events. Events carry a `requestId` because
 * they are broadcast app-wide; everything for another request is ignored here.
 * Returns an unsubscribe function — always call it, or listeners accumulate.
 */
export async function listenAi(
  requestId: string,
  handlers: AiStreamHandlers
): Promise<() => void> {
  const forThis =
    <T extends { requestId: string }>(fn: (payload: T) => void) =>
    (event: { payload: T }) => {
      if (event.payload.requestId === requestId) fn(event.payload);
    };

  const unlisteners = await Promise.all([
    listen<{ requestId: string; text: string }>(
      "ai:delta",
      forThis((p) => handlers.onDelta(p.text))
    ),
    listen<{ requestId: string; text: string }>(
      "ai:done",
      forThis((p) => handlers.onDone(p.text))
    ),
    listen<{ requestId: string; message: string }>(
      "ai:error",
      forThis((p) => handlers.onError(p.message))
    ),
  ]);

  return () => unlisteners.forEach((un) => un());
}
