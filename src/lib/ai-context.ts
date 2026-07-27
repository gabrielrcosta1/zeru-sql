// ── AI context assembly ───────────────────────────────────────────────────
// Turns the app's live state into the system prompt the model sees. Kept out
// of the store so the prompt can be reasoned about (and tested) on its own.
//
// Everything here is budgeted. A large database would blow past any context
// window, so the schema is serialised in a compact one-line-per-table form and
// truncated with an explicit note — a silently cut schema would make the model
// confidently reference tables it can no longer see.

import type {
  AiSqlBlock,
  Connection,
  DatabaseTree,
  HistoryEntry,
  QueryResult,
} from "@/types";

/**
 * Two separate budgets, because the two things are not interchangeable.
 *
 * `INDEX_BUDGET` covers the bare list of table names, which must be as close to
 * complete as possible: a model that cannot see a name will state, correctly
 * and uselessly, that the table does not exist.
 *
 * `DETAIL_BUDGET` covers full column definitions, which only fit for a subset
 * on a large database — so that subset is chosen by relevance, not by
 * alphabetical accident.
 */
const INDEX_BUDGET = 60_000;
const DETAIL_BUDGET = 60_000;
/** Minimum token length for substring matching, so `id` does not match everything. */
const MIN_MATCH_LEN = 4;
/** Sample rows from the last result, to ground questions about the data. */
const SAMPLE_ROWS = 5;
/** Recent queries included as style/context reference. */
const HISTORY_LIMIT = 5;
const MAX_SQL_CHARS = 4_000;

export interface AiContextInput {
  connection?: Connection;
  tree: DatabaseTree | null;
  sql?: string;
  result?: QueryResult;
  history: HistoryEntry[];
  /** The question being asked, used to pick which tables to detail. */
  question?: string;
  /** Table open in the explorer — a strong hint about what the user means. */
  openTable?: string;
}

/** SQL dialect name the model should target. */
function dialect(connection?: Connection): string {
  switch (connection?.engine) {
    case "mysql":
      return "MySQL";
    case "mariadb":
      return "MariaDB (dialeto MySQL)";
    case "sqlite":
      return "SQLite";
    case "sqlserver":
      return "SQL Server (T-SQL)";
    default:
      return "PostgreSQL";
  }
}

/** `users(id int PK, company_id int -> companies.id, email text UNIQUE)` */
function describeTable(
  table: DatabaseTree["schemas"][number]["tables"][number]
): string {
  const columns = table.columns.map((c) => {
    const flags: string[] = [];
    if (c.pk) flags.push("PK");
    if (c.fk) flags.push(`-> ${c.fk.table}.${c.fk.column}`);
    if (c.unique && !c.pk) flags.push("UNIQUE");
    if (!c.nullable && !c.pk) flags.push("NOT NULL");
    return `${c.name} ${c.type}${flags.length ? ` ${flags.join(" ")}` : ""}`;
  });
  return `${table.name}(${columns.join(", ")})`;
}

/**
 * Fold a string down to bare alphanumerics so matching survives accents,
 * underscores and spaces: `is_admin`, `is admin` and `IS ADMIN` all become
 * `isadmin`, and the question "usuarios" still contains the table name "user".
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface Candidate {
  schema: string;
  table: DatabaseTree["schemas"][number]["tables"][number];
  score: number;
}

/**
 * How likely this table is to be what the user is talking about.
 *
 * The signals are deliberately cheap and local — no embeddings, no extra round
 * trip. What matters is that a table the user named, opened or just queried
 * never loses its slot to an alphabetically luckier one.
 */
function scoreTable(
  table: Candidate["table"],
  haystack: string,
  openTable?: string
): number {
  let score = 0;
  const name = normalize(table.name);

  if (openTable && normalize(openTable) === name) score += 500;
  if (name.length >= MIN_MATCH_LEN && haystack.includes(name)) score += 100;

  for (const column of table.columns) {
    const col = normalize(column.name);
    if (col.length >= MIN_MATCH_LEN && haystack.includes(col)) score += 12;
  }
  // Break ties towards tables with more relationships: a hub table is more
  // often the answer than an isolated lookup table.
  score += Math.min(table.columns.filter((c) => c.fk).length, 5);
  return score;
}

function describeSchema(input: AiContextInput): string {
  const tree = input.tree;
  if (!tree || tree.schemas.length === 0) {
    return "Nenhum esquema carregado — não há conexão aberta.";
  }

  const haystack = normalize(`${input.question ?? ""} ${input.sql ?? ""}`);
  const candidates: Candidate[] = [];
  for (const schema of tree.schemas) {
    for (const table of [...schema.tables, ...schema.views]) {
      candidates.push({
        schema: schema.name,
        table,
        score: scoreTable(table, haystack, input.openTable),
      });
    }
  }

  // 1. The index of names.
  //
  // Two rules make this survive a very large database. Anything the question
  // or the open explorer points at is admitted first, unconditionally — losing
  // *that* name is what makes the assistant deny a table the user is looking
  // at. Only then is the remainder filled in, and truncation happens per name
  // rather than per schema: dropping a whole schema because its list was one
  // character too long would blank out the index entirely on a single-schema
  // database.
  const admitted = new Set<Candidate["table"]>();
  let indexUsed = 0;
  const admit = (c: Candidate, force: boolean) => {
    const cost = c.table.name.length + 2;
    if (!force && indexUsed + cost > INDEX_BUDGET) return false;
    admitted.add(c.table);
    indexUsed += cost;
    return true;
  };

  for (const c of candidates) if (c.score >= 100) admit(c, true);
  for (const c of candidates) if (!admitted.has(c.table)) admit(c, false);

  const sections: string[] = [];
  for (const schema of tree.schemas) {
    const names = [...schema.tables, ...schema.views]
      .filter((t) => admitted.has(t))
      .map((t) => t.name);
    if (names.length === 0) continue;
    sections.push(`${schema.name || "(padrão)"}: ${names.join(", ")}`);
  }

  const hidden = candidates.length - admitted.size;
  const index = [
    `Tabelas e views existentes (${candidates.length} no total), por schema:`,
    ...sections,
    hidden > 0
      ? `-- ATENÇÃO: o banco é grande e ${hidden} nome(s) não couberam nesta lista. ` +
        `A lista acima está INCOMPLETA. Se o usuário citar algo que não aparece aqui, ` +
        `NÃO afirme que não existe: diga que não encontrou na lista e peça o nome exato.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 2. The detail: columns for the highest-scoring tables that fit.
  const detail: string[] = [];
  let detailUsed = 0;
  let detailed = 0;
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    const line = `${c.schema ? `${c.schema}.` : ""}${describeTable(c.table)}`;
    if (detailUsed + line.length > DETAIL_BUDGET) break;
    detail.push(line);
    detailUsed += line.length;
    detailed += 1;
  }

  const routines = tree.schemas.flatMap((s) => [
    ...s.functions.map((f) => `função ${s.name}.${f.signature ?? f.name}`),
    ...s.procedures.map((p) => `procedure ${s.name}.${p.signature ?? p.name}`),
  ]);

  return [
    index,
    "",
    detailed < candidates.length
      ? `Colunas detalhadas das ${detailed} tabelas mais prováveis para esta pergunta (as demais existem, mas suas colunas não estão listadas aqui):`
      : "Colunas:",
    ...detail,
    routines.length ? `\nRotinas: ${routines.join("; ").slice(0, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Count of tables whose columns actually fit in the prompt. */
export function detailedTableCount(input: AiContextInput): number {
  const prompt = describeSchema(input);
  return prompt.split("\n").filter((l) => /^[\w.]+\(/.test(l)).length;
}

// ── Two-pass retrieval ────────────────────────────────────────────────────
//
// Picking tables by substring match was the wrong tool: a question written in
// Portuguese ("usuários que assinaram o termo") shares no substring with the
// tables that answer it (`company_group_user`, `company_terms_acceptances`).
// So the model picks, not a regex — it is the part of the system that actually
// understands that "termo aceito pela empresa" means a join table.

const EDGE_BUDGET = 30_000;

export interface TableRef {
  schema: string;
  table: DatabaseTree["schemas"][number]["tables"][number];
}

export function allTables(tree: DatabaseTree | null): TableRef[] {
  return (tree?.schemas ?? []).flatMap((s) =>
    [...s.tables, ...s.views].map((table) => ({ schema: s.name, table }))
  );
}

export function qualify(ref: TableRef): string {
  return ref.schema ? `${ref.schema}.${ref.table.name}` : ref.table.name;
}

/**
 * Foreign keys as a flat edge list. This is the highest-value-per-character
 * thing in the whole prompt: join paths are exactly what the model cannot
 * guess, and one line per edge is far cheaper than full column lists.
 */
function describeEdges(refs: TableRef[], budget = EDGE_BUDGET): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const ref of refs) {
    for (const column of ref.table.columns) {
      if (!column.fk) continue;
      const line = `${qualify(ref)}.${column.name} -> ${column.fk.table}.${column.fk.column}`;
      if (used + line.length > budget) return lines;
      lines.push(line);
      used += line.length;
    }
  }
  return lines;
}

/** Pass 1 — ask the model which tables the question needs. */
export function buildSelectionPrompt(input: AiContextInput): string {
  const refs = allTables(input.tree);
  const bySchema = new Map<string, string[]>();
  for (const ref of refs) {
    const key = ref.schema || "(padrão)";
    bySchema.set(key, [...(bySchema.get(key) ?? []), ref.table.name]);
  }

  const edges = describeEdges(refs);
  return [
    "Você é um especialista no esquema deste banco de dados.",
    "NESTA ETAPA VOCÊ NÃO ESCREVE SQL. Sua única tarefa é escolher tabelas.",
    "",
    "Responda APENAS com JSON, sem texto ao redor, no formato:",
    '{"tables": ["schema.tabela", "schema.outra"], "raciocinio": "uma frase"}',
    "",
    "Como escolher:",
    "- A pergunta vem em português; os nomes das tabelas costumam estar em inglês.",
    "  Faça a tradução mentalmente: usuários→user/users, empresa→company,",
    "  termo/aceite→terms/acceptance, pedido→order, and so on.",
    "- Inclua as tabelas de LIGAÇÃO necessárias para o caminho do JOIN, mesmo que",
    "  o usuário não as tenha citado. É o erro mais comum: ligar duas entidades",
    "  direto quando existe uma tabela associativa entre elas.",
    "- Use a lista de chaves estrangeiras abaixo para achar o caminho real.",
    "- Na dúvida, inclua tabelas demais. Faltar uma quebra a resposta; sobrar não.",
    "- Devolva de 1 a 15 tabelas.",
    "",
    `Tabelas existentes (${refs.length}):`,
    ...[...bySchema].map(([schema, names]) => `${schema}: ${names.join(", ")}`),
    "",
    `Chaves estrangeiras (caminhos de JOIN reais, ${edges.length}):`,
    ...edges,
  ].join("\n");
}

/** Extract the table list from pass 1, tolerating fences and stray prose. */
export function parseSelection(text: string): string[] {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(stripped.slice(start, end + 1));
    const tables = (parsed as { tables?: unknown }).tables;
    if (!Array.isArray(tables)) return [];
    return tables.filter((t): t is string => typeof t === "string").slice(0, 15);
  } catch {
    return [];
  }
}

/** Resolve names from pass 1 back to real tables, tolerating missing schema. */
export function resolveTables(tree: DatabaseTree | null, names: string[]): TableRef[] {
  const refs = allTables(tree);
  const wanted = new Set(names.map(normalize));
  return refs.filter(
    (r) => wanted.has(normalize(qualify(r))) || wanted.has(normalize(r.table.name))
  );
}

/**
 * Tables one foreign key away from `selected`. Cheap insurance: if pass 1
 * missed a link table, its neighbours are usually enough for the model to
 * notice and route around it.
 */
export function neighbourTables(tree: DatabaseTree | null, selected: TableRef[]): TableRef[] {
  const chosen = new Set(selected.map((r) => normalize(r.table.name)));
  if (chosen.size === 0) return [];
  return allTables(tree).filter((ref) => {
    if (chosen.has(normalize(ref.table.name))) return false;
    // Points at something selected…
    if (ref.table.columns.some((c) => c.fk && chosen.has(normalize(c.fk.table)))) return true;
    // …or is pointed at by something selected.
    return selected.some((s) =>
      s.table.columns.some((c) => c.fk && normalize(c.fk.table) === normalize(ref.table.name))
    );
  });
}

/** A few real rows, so the model sees actual values instead of assuming them. */
export interface TableSample {
  table: string;
  columns: string[];
  rows: string[][];
}

/** Pass 2 — full detail for the chosen tables, then write the SQL. */
export function buildGenerationPrompt(
  input: AiContextInput,
  selected: TableRef[],
  neighbours: TableRef[],
  samples: TableSample[]
): string {
  const sections: string[] = [
    `Você é o assistente SQL do Zeru. Responda em português do Brasil.`,
    `Dialeto alvo: ${dialect(input.connection)}.`,
    "",
    "Regras:",
    "- Devolva SQL sempre em um bloco cercado por ```sql.",
    "- Um bloco de SQL por resposta. Explique em texto curto antes dele.",
    "- Use SOMENTE as tabelas e colunas listadas abaixo. Elas foram selecionadas",
    "  para esta pergunta e o esquema delas está completo — não invente colunas.",
    "- Se o que o usuário pediu não for possível com estas tabelas, diga qual",
    "  informação falta em vez de improvisar uma coluna plausível.",
    "- Prefira JOIN explícito pelo caminho de chaves estrangeiras listado.",
    "- Qualifique as tabelas com o schema.",
    "- Você não executa nada. Para DELETE/UPDATE/DROP/TRUNCATE/ALTER, avise o",
    "  impacto e sugira transação.",
    "",
    "TABELAS SELECIONADAS (esquema completo):",
    ...selected.map((r) => `${qualify(r)}(${describeTable(r.table).replace(/^[^(]*\(/, "")}`),
  ];

  const edges = describeEdges([...selected, ...neighbours], 12_000);
  if (edges.length) {
    sections.push("", "CAMINHOS DE JOIN (chaves estrangeiras):", ...edges);
  }

  if (neighbours.length) {
    sections.push(
      "",
      `TABELAS VIZINHAS (ligadas por FK; use se precisar de um passo a mais no caminho):`,
      ...neighbours.slice(0, 40).map((r) => `${qualify(r)}(${r.table.columns.map((c) => c.name).join(", ")})`)
    );
  }

  if (samples.length) {
    sections.push(
      "",
      "AMOSTRA REAL DE DADOS (para você ver os valores que existem de fato):"
    );
    for (const s of samples) {
      sections.push(
        `${s.table}: ${s.columns.join(" | ")}`,
        ...s.rows.map((r) => `  ${r.join(" | ")}`)
      );
    }
  }

  if (input.sql?.trim()) {
    sections.push("", "SQL na aba aberta agora:", input.sql.trim().slice(0, MAX_SQL_CHARS));
  }

  const history = describeHistory(input.history);
  if (history) sections.push("", history);

  return sections.join("\n");
}

function describeResult(result?: QueryResult): string | null {
  if (!result || result.kind !== "rows" || result.rows.length === 0) return null;
  const header = result.columns.map((c) => c.name).join(" | ");
  const rows = result.rows.slice(0, SAMPLE_ROWS).map((row) =>
    row
      .map((cell) =>
        cell === null
          ? "NULL"
          : typeof cell === "object"
            ? JSON.stringify(cell)
            : String(cell)
      )
      .join(" | ")
  );
  const total =
    result.totalRows !== undefined
      ? `${result.totalRows} linhas`
      : `${result.rows.length}+ linhas`;
  return [
    `Resultado da última consulta (${total}, mostrando até ${SAMPLE_ROWS}):`,
    header,
    ...rows,
  ].join("\n");
}

function describeHistory(history: HistoryEntry[]): string | null {
  const recent = history
    .filter((h) => h.status === "ok" && h.sql.trim())
    .slice(0, HISTORY_LIMIT)
    .map((h) => h.sql.trim().replace(/\s+/g, " ").slice(0, 200));
  if (recent.length === 0) return null;
  return ["Consultas recentes do usuário:", ...recent.map((s) => `- ${s}`)].join("\n");
}

/** The full system prompt for a chat turn. */
export function buildSystemPrompt(input: AiContextInput): string {
  const sections: string[] = [
    `Você é o assistente SQL do Zeru, um cliente de banco de dados. Responda em português do Brasil.`,
    `Dialeto alvo: ${dialect(input.connection)}.`,
    "",
    "Regras:",
    "- Devolva SQL sempre em um bloco cercado por ```sql.",
    "- Um bloco de SQL por resposta. Explique em texto curto antes dele.",
    "- Qualifique com o schema quando houver mais de um.",
    "- Você não executa nada: quem decide executar é o usuário. Para comandos destrutivos (DELETE, UPDATE, DROP, TRUNCATE, ALTER), avise o impacto e sugira rodar em transação.",
    "",
    "Sobre o esquema abaixo — leia com atenção:",
    "- Se um nome está na lista de tabelas, a tabela EXISTE.",
    "- Em bancos muito grandes a lista pode vir marcada como INCOMPLETA. Nesse",
    "  caso, ausência de um nome não prova nada: peça o nome exato ao usuário.",
    "- As COLUNAS só estão detalhadas para parte das tabelas, por limite de espaço.",
    "  Uma tabela sem colunas listadas não é uma tabela inexistente.",
    "- Nunca responda que uma tabela ou coluna não existe só porque ela não aparece",
    "  na seção de colunas. Se o nome está na lista, escreva a consulta usando os",
    "  nomes que o usuário mencionou e avise, em uma linha, que não pôde conferir",
    "  os nomes exatos das colunas.",
    "- O usuário costuma se referir às tabelas em português e no plural: 'usuários'",
    "  quase sempre significa a tabela `user` ou `users`. Faça essa ponte.",
    "",
    "Esquema:",
    describeSchema(input),
  ];

  if (input.sql?.trim()) {
    sections.push(
      "",
      "SQL na aba aberta agora:",
      input.sql.trim().slice(0, MAX_SQL_CHARS)
    );
  }

  const result = describeResult(input.result);
  if (result) sections.push("", result);

  const history = describeHistory(input.history);
  if (history) sections.push("", history);

  return sections.join("\n");
}

/** Short labels shown under an answer, so the context sent is never a mystery. */
export function contextChips(input: AiContextInput): string[] {
  const chips: string[] = [];
  const tableCount =
    input.tree?.schemas.reduce((n, s) => n + s.tables.length + s.views.length, 0) ?? 0;
  if (tableCount) {
    // Says how many tables had their columns sent, not just how many exist —
    // the earlier "418 objetos" chip implied the model saw all of them.
    const detailed = detailedTableCount(input);
    chips.push(
      detailed < tableCount
        ? `esquema: ${tableCount} tabelas (${detailed} com colunas)`
        : `esquema: ${tableCount} tabelas`
    );
  }
  if (input.sql?.trim()) chips.push("SQL da aba");
  if (input.result?.kind === "rows" && input.result.rows.length)
    chips.push(`amostra: ${Math.min(SAMPLE_ROWS, input.result.rows.length)} linhas`);
  if (input.history.some((h) => h.status === "ok")) chips.push("histórico");
  return chips;
}

/**
 * Statements that change data or structure. Matched on word boundaries so a
 * column called `updated_at` or `deleted` does not trip the warning.
 */
const DESTRUCTIVE = /\b(delete|drop|truncate|update|alter|insert|replace|grant|revoke|create)\b/i;

export function isDestructive(sql: string): boolean {
  // Comments can contain anything; only look at code.
  const bare = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  return DESTRUCTIVE.test(bare);
}

/**
 * Pull the fenced SQL block out of an answer, returning it separately from the
 * prose so the UI can render a runnable card instead of a code blob.
 */
export function extractSqlBlock(text: string): {
  prose: string;
  block?: AiSqlBlock;
} {
  const match = /```(?:sql)?[ \t]*\r?\n([\s\S]*?)```/i.exec(text);
  const sql = match?.[1]?.trim();
  if (!match || !sql) return { prose: text.trim() };
  return {
    prose: (text.slice(0, match.index) + text.slice(match.index + match[0].length))
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    block: { sql, destructive: isDestructive(sql) },
  };
}
