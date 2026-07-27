import { create } from "zustand";
import type {
  AiMessage,
  Connection,
  DatabaseTree,
  Engine,
  HistoryEntry,
  QueryResult,
  QueryTab,
} from "@/types";
import * as api from "@/lib/api";
import {
  buildGenerationPrompt,
  buildSelectionPrompt,
  buildSystemPrompt,
  contextChips,
  extractSqlBlock,
  neighbourTables,
  parseSelection,
  qualify,
  resolveTables,
  type AiContextInput,
  type TableRef,
  type TableSample,
} from "@/lib/ai-context";

/** Input from the connection form; `id`/`color` are assigned by the store. */
export interface ConnectInput {
  name: string;
  engine: Engine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  filePath?: string;
  color?: string;
  environment?: Connection["environment"];
}

const CONNECTION_COLORS = ["#f47183", "#f5be5a", "#60b2f6", "#2dd4bf", "#a78bfa"];

/**
 * Rows fetched per page. One grid page maps to exactly one server round trip,
 * so this is both the fetch size and the grid's initial page size.
 */
export const DEFAULT_PAGE_SIZE = 100;

/**
 * Collision-free ids. A per-session counter was not safe here: connection and
 * history ids are persisted to disk, and a counter restarting at the same
 * value each launch would hand a fresh record the id of a stored one —
 * overwriting its keychain entry or history row.
 */
const uid = (prefix: string) => {
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${unique}`;
};

type CenterView = { kind: "editor" } | { kind: "table"; table: string } | { kind: "relationships" };
type RightView = "ai" | "history";

interface AppState {
  connections: Connection[];
  activeConnectionId: string;
  databaseTree: DatabaseTree | null;
  connecting: boolean;
  connectError: string | null;
  tabs: QueryTab[];
  activeTabId: string;
  centerView: CenterView;
  rightView: RightView;
  rightOpen: boolean;
  sidebarOpen: boolean;
  aiMessages: AiMessage[];
  aiThinking: boolean;
  /** Id of the streaming completion in flight, if any. */
  aiRequestId: string | null;
  aiSettings: api.AiSettings | null;
  aiSettingsOpen: boolean;
  history: HistoryEntry[];
  connectionModalOpen: boolean;
  commandPaletteOpen: boolean;

  // actions
  connectAndLoad: (input: ConnectInput) => Promise<void>;
  hydrateConnections: () => Promise<void>;
  connectSaved: (id: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  refreshDatabaseTree: (id?: string) => Promise<void>;
  clearConnectError: () => void;
  setActiveConnection: (id: string) => void;
  setCenterView: (v: CenterView) => void;
  setRightView: (v: RightView) => void;
  toggleRight: () => void;
  toggleSidebar: () => void;
  openConnectionModal: (open: boolean) => void;
  openCommandPalette: (open: boolean) => void;

  newTab: (sql?: string, title?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  runTab: (id: string, sqlOverride?: string) => Promise<void>;
  setActiveResult: (tabId: string, index: number) => void;
  loadResultPage: (
    tabId: string,
    index: number,
    offset: number,
    limit: number
  ) => Promise<void>;

  sendAi: (text: string) => Promise<void>;
  cancelAi: () => Promise<void>;
  clearAi: () => void;
  openAiSettings: (open: boolean) => void;
  loadAiSettings: () => Promise<void>;
  saveAiSettings: (settings: api.AiSettings, apiKey?: string) => Promise<void>;
  insertAiSqlIntoEditor: (sql: string) => void;
  toggleFavorite: (id: string) => void;
  hydrateHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
}

/**
 * Write a history entry to disk. Fire-and-forget: a failed write must not stop
 * the query result from reaching the user, so it only warns.
 */
function persistHistory(entry: HistoryEntry) {
  if (!api.isTauri) return;
  api.pushHistory(entry).catch((e) => console.warn("Falha ao salvar o histórico:", e));
}

/** How many selected tables get a real data sample. */
const SAMPLE_TABLES = 6;
const SAMPLE_LIMIT = 3;

function quoteIdent(name: string, engine?: string): string {
  return engine === "mysql" || engine === "mariadb" ? `\`${name}\`` : `"${name}"`;
}

/**
 * Read a handful of real rows from the chosen tables.
 *
 * The SQL is written here, never by the model: it is a bare `SELECT … LIMIT 3`
 * against a table the model asked about. That keeps "the assistant can look at
 * the data" from turning into "the assistant can run anything" — there is no
 * path from a model output to a statement executed without the user's click.
 */
async function sampleTables(
  connectionId: string,
  engine: string | undefined,
  refs: TableRef[]
): Promise<TableSample[]> {
  const samples: TableSample[] = [];
  for (const ref of refs.slice(0, SAMPLE_TABLES)) {
    const qualified = ref.schema
      ? `${quoteIdent(ref.schema, engine)}.${quoteIdent(ref.table.name, engine)}`
      : quoteIdent(ref.table.name, engine);
    try {
      const [result] = await api.runQuery(
        connectionId,
        `SELECT * FROM ${qualified} LIMIT ${SAMPLE_LIMIT}`,
        SAMPLE_LIMIT
      );
      if (!result || result.kind !== "rows" || result.rows.length === 0) continue;
      samples.push({
        table: qualify(ref),
        columns: result.columns.map((c) => c.name),
        rows: result.rows.map((row) =>
          row.map((cell) =>
            cell === null
              ? "NULL"
              : typeof cell === "object"
                ? JSON.stringify(cell).slice(0, 60)
                : String(cell).slice(0, 60)
          )
        ),
      });
    } catch {
      // A table we cannot read (permissions, a view over a missing relation)
      // is not worth failing the whole answer over.
    }
  }
  return samples;
}

/**
 * Check a generated SELECT against the server without running it, and return
 * the error when it does not plan. EXPLAIN executes nothing, so this is safe —
 * but it is only attempted for read statements, never for DML.
 */
async function explainError(
  connectionId: string,
  sql: string
): Promise<string | null> {
  if (!/^\s*(select|with)\b/i.test(sql)) return null;
  try {
    const results = await api.runQuery(connectionId, `EXPLAIN ${sql.replace(/;\s*$/, "")}`, 1);
    const failed = results.find((r) => r.kind === "error");
    return failed?.error?.message ?? null;
  } catch (e) {
    return String(e);
  }
}

export const useApp = create<AppState>((set, get) => ({
  connections: [],
  activeConnectionId: "",
  databaseTree: null,
  connecting: false,
  connectError: null,
  tabs: [
    {
      id: "tab-1",
      title: "consulta sem título",
      sql: "",
      connectionId: "",
      dirty: false,
      results: [],
      activeResultIndex: 0,
    },
  ],
  activeTabId: "tab-1",
  centerView: { kind: "editor" },
  rightView: "ai",
  rightOpen: true,
  sidebarOpen: true,
  aiMessages: [],
  aiThinking: false,
  aiRequestId: null,
  aiSettings: null,
  aiSettingsOpen: false,
  history: [],
  connectionModalOpen: false,
  commandPaletteOpen: false,

  connectAndLoad: async (input) => {
    set({ connecting: true, connectError: null });
    const id = uid("conn");
    const color =
      input.color ??
      CONNECTION_COLORS[get().connections.length % CONNECTION_COLORS.length];
    const conn: Connection = {
      id,
      name: input.name || `${input.engine} — conexão`,
      engine: input.engine,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      filePath: input.filePath,
      color,
      ssl: input.ssl,
      status: "connected",
      environment: input.environment,
    };
    try {
      if (api.isTauri) {
        await api.connect({
          id,
          engine: input.engine,
          host: input.host,
          port: input.port,
          database: input.database,
          username: input.username,
          password: input.password,
          ssl: input.ssl,
          filePath: input.filePath,
        });
        const tree = await api.getDatabaseTree(id);
        // Persist metadata + password so the connection survives a restart.
        try {
          await api.saveConnection(
            {
              id,
              name: conn.name,
              engine: conn.engine,
              host: conn.host,
              port: conn.port,
              database: conn.database,
              username: conn.username,
              ssl: conn.ssl,
              filePath: conn.filePath,
              color: conn.color,
              environment: conn.environment,
            },
            input.password
          );
        } catch (e) {
          console.warn("Falha ao salvar a conexão:", e);
        }
        set((s) => ({
          connections: [...s.connections, conn],
          activeConnectionId: id,
          databaseTree: tree,
          connecting: false,
        }));
      } else {
        // Browser preview: register the connection without a live backend.
        set((s) => ({
          connections: [...s.connections, conn],
          activeConnectionId: id,
          connecting: false,
        }));
      }
    } catch (e) {
      set({ connecting: false, connectError: String(e) });
      throw e;
    }
  },

  refreshDatabaseTree: async (id) => {
    if (!api.isTauri) return;
    const connId = id ?? get().activeConnectionId;
    try {
      const tree = await api.getDatabaseTree(connId);
      set({ databaseTree: tree });
    } catch (e) {
      set({ connectError: String(e) });
    }
  },

  clearConnectError: () => set({ connectError: null }),

  // Load persisted connections at startup as idle entries (no live pool yet).
  hydrateConnections: async () => {
    if (!api.isTauri) return;
    try {
      const saved = await api.loadConnections();
      if (saved.length === 0) return;
      const connections: Connection[] = saved.map((c, i) => ({
        id: c.id,
        name: c.name,
        engine: c.engine,
        host: c.host,
        port: c.port,
        database: c.database,
        username: c.username,
        filePath: c.filePath,
        color: c.color ?? CONNECTION_COLORS[i % CONNECTION_COLORS.length],
        ssl: c.ssl,
        status: "idle",
        environment: c.environment,
      }));
      set((s) => ({
        connections,
        activeConnectionId: s.activeConnectionId || connections[0].id,
      }));
    } catch (e) {
      console.warn("Falha ao carregar conexões salvas:", e);
    }
  },

  // Open a pool for a previously saved connection, pulling its password from
  // the keychain, then load its schema tree.
  connectSaved: async (id) => {
    if (!api.isTauri) return;
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;
    set({ connecting: true, connectError: null, activeConnectionId: id });
    try {
      const password = (await api.loadPassword(id)) ?? undefined;
      await api.connect({
        id,
        engine: conn.engine,
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        password,
        ssl: conn.ssl,
        filePath: conn.filePath,
      });
      const tree = await api.getDatabaseTree(id);
      set((s) => ({
        connections: s.connections.map((c) =>
          c.id === id ? { ...c, status: "connected" } : c
        ),
        activeConnectionId: id,
        databaseTree: tree,
        connecting: false,
      }));
    } catch (e) {
      set((s) => ({
        connecting: false,
        connectError: String(e),
        connections: s.connections.map((c) =>
          c.id === id ? { ...c, status: "error" } : c
        ),
      }));
    }
  },

  // Forget a connection: close its pool, drop its persisted metadata/password,
  // and remove it from the UI.
  removeConnection: async (id) => {
    if (api.isTauri) {
      try {
        await api.disconnect(id);
        await api.deleteConnection(id);
      } catch (e) {
        console.warn("Falha ao remover a conexão:", e);
      }
    }
    set((s) => {
      const connections = s.connections.filter((c) => c.id !== id);
      const wasActive = s.activeConnectionId === id;
      return {
        connections,
        activeConnectionId: wasActive
          ? connections[0]?.id ?? ""
          : s.activeConnectionId,
        databaseTree: wasActive ? null : s.databaseTree,
      };
    });
  },

  setActiveConnection: (id) => set({ activeConnectionId: id }),
  setCenterView: (v) => set({ centerView: v }),
  setRightView: (v) => set({ rightView: v, rightOpen: true }),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openConnectionModal: (open) => set({ connectionModalOpen: open }),
  openCommandPalette: (open) => set({ commandPaletteOpen: open }),

  newTab: (sql = "", title = "consulta sem título") => {
    const id = uid("tab");
    set((s) => ({
      tabs: [
        ...s.tabs,
        {
          id,
          title,
          sql,
          connectionId: s.activeConnectionId,
          dirty: false,
          results: [],
          activeResultIndex: 0,
        },
      ],
      activeTabId: id,
      centerView: { kind: "editor" },
    }));
  },

  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? tabs[tabs.length - 1]?.id ?? "" : s.activeTabId;
      return { tabs: tabs.length ? tabs : s.tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id, centerView: { kind: "editor" } }),

  updateTabSql: (id, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql, dirty: true } : t)),
    })),

  // `sqlOverride` runs something other than the tab's full text — used by
  // "run selection", where only the highlighted statement should execute.
  runTab: async (id, sqlOverride) => {
    const found = get().tabs.find((t) => t.id === id);
    if (!found) return;
    const tab = sqlOverride?.trim() ? { ...found, sql: sqlOverride } : found;
    const connId = tab.connectionId || get().activeConnectionId;
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, running: true } : t)) }));

    // A script yields one result per statement; the history keeps a single
    // entry for the run, aggregating the statements it contains.
    const finish = (results: QueryResult[]) => {
      const failed = results.some((r) => r.kind === "error");
      const rows = results.reduce(
        (sum, r) =>
          sum + (r.kind === "rows" ? r.totalRows ?? r.rows.length : r.affectedRows ?? 0),
        0
      );
      const entry: HistoryEntry = {
        id: uid("h"),
        sql: tab.sql,
        connectionId: connId,
        at: new Date().toISOString(),
        durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
        rows,
        status: failed ? "error" : "ok",
        source: "editor",
      };
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                running: false,
                results,
                // Land on the failing statement when there is one, so the
                // error is what the user sees first.
                activeResultIndex: failed
                  ? results.findIndex((r) => r.kind === "error")
                  : 0,
                dirty: false,
              }
            : t
        ),
        history: [entry, ...s.history],
      }));
      persistHistory(entry);
    };

    const fail = (message: string) =>
      finish([
        {
          kind: "error",
          statement: tab.sql,
          columns: [],
          rows: [],
          durationMs: 0,
          offset: 0,
          hasMore: false,
          error: { message },
        },
      ]);

    if (!connId) {
      fail("Nenhuma conexão selecionada. Crie ou selecione uma conexão primeiro.");
      return;
    }
    if (!api.isTauri) {
      fail("Backend indisponível: execute o app via Tauri (npm run tauri dev).");
      return;
    }
    try {
      finish(await api.runQuery(connId, tab.sql, DEFAULT_PAGE_SIZE));
    } catch (e) {
      fail(String(e));
    }
  },

  setActiveResult: (tabId, index) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && index >= 0 && index < t.results.length
          ? { ...t, activeResultIndex: index }
          : t
      ),
    })),

  // Replace one result in place with another page of the same statement. The
  // statement is replayed server-side, so this is a real round trip.
  loadResultPage: async (tabId, index, offset, limit) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    const target = tab?.results[index];
    if (!tab || !target || target.kind !== "rows" || !api.isTauri) return;
    const connId = tab.connectionId || get().activeConnectionId;
    if (!connId) return;

    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, pagingIndex: index } : t)),
    }));
    const replace = (result: QueryResult) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                pagingIndex: undefined,
                results: t.results.map((r, i) => (i === index ? result : r)),
              }
            : t
        ),
      }));

    try {
      replace(await api.fetchPage(connId, target.statement, offset, limit));
    } catch (e) {
      replace({
        ...target,
        kind: "error",
        error: { message: String(e) },
      });
    }
  },

  sendAi: async (text) => {
    const state = get();
    if (state.aiThinking) return;

    const userMsg: AiMessage = { id: uid("m"), role: "user", text };
    const replyId = uid("m");
    const requestId = uid("req");

    set((s) => ({
      aiMessages: [
        ...s.aiMessages,
        userMsg,
        { id: replyId, role: "assistant", text: "", pending: true },
      ],
      aiThinking: true,
      aiRequestId: requestId,
    }));

    const patchReply = (patch: Partial<AiMessage>) =>
      set((s) => ({
        aiMessages: s.aiMessages.map((m) => (m.id === replyId ? { ...m, ...patch } : m)),
      }));

    const failWith = (message: string) => {
      patchReply({ pending: false, text: message });
      set({ aiThinking: false, aiRequestId: null });
    };

    if (!api.isTauri) {
      failWith("Backend indisponível: execute o app via Tauri (npm run tauri dev).");
      return;
    }

    // Context is rebuilt per turn: the user may have switched connection, run a
    // query or edited the tab between messages.
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    const connIdForAi = tab?.connectionId || state.activeConnectionId;
    const contextInput: AiContextInput = {
      connection: state.connections.find((c) => c.id === state.activeConnectionId),
      tree: state.databaseTree,
      sql: tab?.sql,
      result: tab ? tab.results[tab.activeResultIndex] : undefined,
      history: state.history,
      // Both are relevance signals: on a large database only a subset of the
      // tables can have their columns sent, and the question plus whatever the
      // user is looking at are the best evidence of which subset matters.
      question: text,
      openTable:
        state.centerView.kind === "table" ? state.centerView.table : undefined,
    };

    const priorTurns = state.aiMessages
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, content: m.text as string }));

    let unlisten: (() => void) | undefined;
    try {
      // ── Pass 1: the model picks the tables ──────────────────────────────
      // A regex cannot know that "usuários que assinaram o termo da empresa"
      // needs a join table; the model can. Table choice belongs to the part of
      // the system that understands language.
      let chips = ["seleção de tabelas"];
      let selected: TableRef[] = [];
      const chosenNames: string[] = [];

      if (state.databaseTree) {
        patchReply({ text: "Procurando as tabelas certas no esquema…" });
        try {
          const answer = await api.aiComplete(`${requestId}-sel`, [
            { role: "system", content: buildSelectionPrompt(contextInput) },
            { role: "user", content: text },
          ]);
          chosenNames.push(...parseSelection(answer));
          selected = resolveTables(state.databaseTree, chosenNames);
        } catch (e) {
          console.warn("Seleção de tabelas falhou, usando heurística:", e);
        }
      }

      // ── Probe: read a few real rows from the chosen tables ───────────────
      let samples: TableSample[] = [];
      if (selected.length > 0 && connIdForAi) {
        patchReply({
          text: `Conferindo ${selected.length} tabela(s): ${selected
            .map(qualify)
            .join(", ")}`,
        });
        samples = await sampleTables(
          connIdForAi,
          contextInput.connection?.engine,
          selected
        );
      }

      // ── Pass 2: write the SQL with the full schema of what was chosen ────
      patchReply({ text: "" });
      const neighbours =
        selected.length > 0 ? neighbourTables(state.databaseTree, selected) : [];

      const systemPrompt =
        selected.length > 0
          ? buildGenerationPrompt(contextInput, selected, neighbours, samples)
          : // Fallback when pass 1 produced nothing usable: the old single-pass
            // prompt, which at least lists every table name.
            buildSystemPrompt(contextInput);

      if (selected.length > 0) {
        chips = [
          `${selected.length} tabelas escolhidas pela IA`,
          ...(samples.length ? [`amostra real: ${samples.length} tabelas`] : []),
          ...(neighbours.length ? [`+${neighbours.length} vizinhas por FK`] : []),
        ];
      } else {
        chips = contextChips(contextInput);
      }

      let full = "";
      unlisten = await api.listenAi(requestId, {
        onDelta: (chunk) => {
          full += chunk;
          set((s) => ({
            aiMessages: s.aiMessages.map((m) =>
              m.id === replyId ? { ...m, text: (m.text ?? "") + chunk } : m
            ),
          }));
        },
        onDone: (final) => {
          full = final || full;
        },
        onError: (message) => failWith(`Falha na IA: ${message}`),
      });

      await api.aiChat(requestId, [
        { role: "system", content: systemPrompt },
        ...priorTurns,
        { role: "user", content: text },
      ]);

      // ── Validate: EXPLAIN the generated SELECT, retry once on failure ────
      let { prose, block } = extractSqlBlock(full);
      if (block && connIdForAi && !block.destructive) {
        const problem = await explainError(connIdForAi, block.sql);
        if (problem) {
          patchReply({ text: "A consulta não validou no banco. Corrigindo…" });
          try {
            const fixed = await api.aiComplete(`${requestId}-fix`, [
              { role: "system", content: systemPrompt },
              { role: "user", content: text },
              { role: "assistant", content: full },
              {
                role: "user",
                content:
                  `O banco recusou essa consulta com o erro abaixo. ` +
                  `Corrija usando apenas as colunas listadas no esquema e ` +
                  `devolva a consulta corrigida.\n\nErro: ${problem}`,
              },
            ]);
            const retry = extractSqlBlock(fixed);
            if (retry.block) {
              ({ prose, block } = retry);
              chips = [...chips, "corrigida após erro do banco"];
            }
          } catch (e) {
            console.warn("Retry após falha de EXPLAIN não funcionou:", e);
          }
        }
      }

      patchReply({
        pending: false,
        text: prose || (block ? "" : "(resposta vazia)"),
        sql: block,
        contextChips: chips,
      });
      set({ aiThinking: false, aiRequestId: null });
    } catch (e) {
      failWith(`Falha na IA: ${String(e)}`);
    } finally {
      unlisten?.();
      // A backend that returned without emitting `done` would otherwise leave
      // the panel spinning forever.
      if (get().aiRequestId === requestId) {
        set({ aiThinking: false, aiRequestId: null });
        patchReply({ pending: false });
      }
    }
  },

  cancelAi: async () => {
    const requestId = get().aiRequestId;
    if (!requestId) return;
    set({ aiThinking: false, aiRequestId: null });
    if (api.isTauri) {
      try {
        await api.aiCancel(requestId);
      } catch (e) {
        console.warn("Falha ao cancelar a IA:", e);
      }
    }
  },

  clearAi: () => set({ aiMessages: [], aiThinking: false, aiRequestId: null }),

  openAiSettings: (open) => set({ aiSettingsOpen: open }),

  loadAiSettings: async () => {
    if (!api.isTauri) return;
    try {
      set({ aiSettings: await api.loadAiSettings() });
    } catch (e) {
      console.warn("Falha ao carregar as configurações da IA:", e);
    }
  },

  saveAiSettings: async (settings, apiKey) => {
    const saved = await api.saveAiSettings(settings, apiKey);
    set({ aiSettings: saved });
  },

  insertAiSqlIntoEditor: (sql) => {
    const { activeTabId, updateTabSql, setCenterView } = get();
    updateTabSql(activeTabId, sql);
    setCenterView({ kind: "editor" });
  },

  toggleFavorite: (id) => {
    const current = get().history.find((h) => h.id === id);
    if (!current) return;
    const favorite = !current.favorite;
    set((s) => ({
      history: s.history.map((h) => (h.id === id ? { ...h, favorite } : h)),
    }));
    if (api.isTauri) {
      api
        .setHistoryFavorite(id, favorite)
        .catch((e) => console.warn("Falha ao salvar o favorito:", e));
    }
  },

  // Load the persisted history at startup.
  hydrateHistory: async () => {
    if (!api.isTauri) return;
    try {
      set({ history: await api.loadHistory() });
    } catch (e) {
      console.warn("Falha ao carregar o histórico:", e);
    }
  },

  clearHistory: async () => {
    set({ history: [] });
    if (!api.isTauri) return;
    try {
      await api.clearHistory();
    } catch (e) {
      console.warn("Falha ao limpar o histórico:", e);
    }
  },
}));
