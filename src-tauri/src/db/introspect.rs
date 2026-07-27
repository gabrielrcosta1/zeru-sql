// ── Schema introspection ──────────────────────────────────────────────────
// Reads metadata (schemas, tables/views, columns, keys, indexes) from the live
// connection and shapes it into the `DatabaseTree` the frontend renders.
//
// Strategy: run a handful of set-based catalog queries per engine, collect the
// rows into flat intermediates, then assemble the nested tree once. This keeps
// round-trips low and the engine-specific code confined to the fetch step.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::Serialize;
use sqlx::Row;

use crate::db::DbPool;

// ── Output shapes (mirror src/types.ts) ───────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FkRef {
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
    pub nullable: bool,
    pub pk: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fk: Option<FkRef>,
    pub unique: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexDef {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableNode {
    pub kind: &'static str, // "table" | "view"
    pub name: String,
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<IndexDef>,
    pub approx_rows: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// A stored function, procedure or trigger. Mirrors `RoutineNode` in types.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineNode {
    pub kind: &'static str, // "function" | "procedure" | "trigger"
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub returns: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaNode {
    pub name: String,
    pub tables: Vec<TableNode>,
    pub views: Vec<TableNode>,
    pub functions: Vec<RoutineNode>,
    pub procedures: Vec<RoutineNode>,
    pub triggers: Vec<RoutineNode>,
    pub indexes: Vec<IndexDef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseTree {
    pub name: String,
    pub schemas: Vec<SchemaNode>,
}

// ── Flat intermediates used during assembly ───────────────────────────────

type Key = (String, String, String); // (schema, table, column)

struct TableMeta {
    schema: String,
    name: String,
    kind: &'static str,
    approx_rows: i64,
    size_bytes: i64,
    comment: Option<String>,
}

struct ColRaw {
    schema: String,
    table: String,
    name: String,
    data_type: String,
    nullable: bool,
    default: Option<String>,
}

struct IdxRaw {
    schema: String,
    table: String,
    index: String,
    unique: bool,
    method: Option<String>,
    column: String,
}

struct RoutineRaw {
    schema: String,
    node: RoutineNode,
}

struct Introspection {
    db_name: String,
    tables: Vec<TableMeta>,
    columns: Vec<ColRaw>,
    pks: HashSet<Key>,
    uniques: HashSet<Key>,
    fks: HashMap<Key, FkRef>,
    indexes: Vec<IdxRaw>,
    routines: Vec<RoutineRaw>,
}

/// Run a secondary catalog query without letting it sink the whole tree.
///
/// Routine metadata lives in catalogs whose shape drifts across engine
/// versions (`pg_proc.prokind` is Postgres 11+, `information_schema.parameters`
/// is absent on some MariaDB builds). Losing the routine list is a degraded
/// sidebar; losing the tree means the user cannot browse at all.
fn non_fatal<T: Default>(what: &str, result: Result<T, String>) -> T {
    match result {
        Ok(value) => value,
        Err(e) => {
            eprintln!("[zeru] introspecção de {what} falhou: {e}");
            T::default()
        }
    }
}

// ── Public entry points ───────────────────────────────────────────────────

/// List the databases visible on the server (used to populate the picker).
pub async fn list_databases(pool: &DbPool) -> Result<Vec<String>, String> {
    match pool {
        DbPool::Postgres(p) => {
            let rows = sqlx::query(
                "SELECT datname FROM pg_database \
                 WHERE datistemplate = false ORDER BY datname",
            )
            .fetch_all(p)
            .await
            .map_err(|e| e.to_string())?;
            let mut out = Vec::with_capacity(rows.len());
            for r in &rows {
                out.push(r.try_get::<String, _>(0).map_err(|e| e.to_string())?);
            }
            Ok(out)
        }
        DbPool::MySql(p) => {
            let rows = sqlx::query(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name NOT IN \
                 ('mysql','information_schema','performance_schema','sys') \
                 ORDER BY schema_name",
            )
            .fetch_all(p)
            .await
            .map_err(|e| e.to_string())?;
            let mut out = Vec::with_capacity(rows.len());
            for r in &rows {
                out.push(r.try_get::<String, _>(0).map_err(|e| e.to_string())?);
            }
            Ok(out)
        }
    }
}

/// Build the full schema tree for the connection.
pub async fn database_tree(pool: &DbPool) -> Result<DatabaseTree, String> {
    let intro = match pool {
        DbPool::Postgres(p) => fetch_postgres(p).await?,
        DbPool::MySql(p) => fetch_mysql(p).await?,
    };
    Ok(assemble(intro))
}

// ── Assembly (engine-agnostic) ────────────────────────────────────────────

fn assemble(intro: Introspection) -> DatabaseTree {
    // schema -> table -> node
    let mut by_schema: BTreeMap<String, BTreeMap<String, TableNode>> = BTreeMap::new();
    for t in &intro.tables {
        by_schema
            .entry(t.schema.clone())
            .or_default()
            .insert(
                t.name.clone(),
                TableNode {
                    kind: t.kind,
                    name: t.name.clone(),
                    columns: Vec::new(),
                    indexes: Vec::new(),
                    approx_rows: t.approx_rows,
                    size_bytes: Some(t.size_bytes),
                    comment: t.comment.clone().filter(|c| !c.is_empty()),
                },
            );
    }

    // Columns, decorated with pk/unique/fk flags.
    for c in &intro.columns {
        let key = (c.schema.clone(), c.table.clone(), c.name.clone());
        if let Some(node) = by_schema
            .get_mut(&c.schema)
            .and_then(|m| m.get_mut(&c.table))
        {
            node.columns.push(ColumnDef {
                name: c.name.clone(),
                col_type: c.data_type.clone(),
                nullable: c.nullable,
                pk: intro.pks.contains(&key),
                fk: intro.fks.get(&key).cloned(),
                unique: intro.uniques.contains(&key),
                default: c.default.clone(),
            });
        }
    }

    // Indexes: group raw rows by (schema, table, index) preserving column order.
    let mut idx_map: BTreeMap<(String, String, String), IndexDef> = BTreeMap::new();
    for i in &intro.indexes {
        let entry = idx_map
            .entry((i.schema.clone(), i.table.clone(), i.index.clone()))
            .or_insert_with(|| IndexDef {
                name: i.index.clone(),
                columns: Vec::new(),
                unique: i.unique,
                method: i.method.clone(),
            });
        if !i.column.is_empty() {
            entry.columns.push(i.column.clone());
        }
    }
    for ((schema, table, _), def) in idx_map {
        if let Some(node) = by_schema.get_mut(&schema).and_then(|m| m.get_mut(&table)) {
            node.indexes.push(def);
        }
    }

    // Routines, bucketed by schema and kind.
    let mut functions: BTreeMap<String, Vec<RoutineNode>> = BTreeMap::new();
    let mut procedures: BTreeMap<String, Vec<RoutineNode>> = BTreeMap::new();
    let mut triggers: BTreeMap<String, Vec<RoutineNode>> = BTreeMap::new();
    for r in intro.routines {
        let bucket = match r.node.kind {
            "procedure" => &mut procedures,
            "trigger" => &mut triggers,
            _ => &mut functions,
        };
        bucket.entry(r.schema).or_default().push(r.node);
    }

    // A schema holding only routines has no table rows, so the name set is the
    // union of every source rather than just the table map.
    let mut names: BTreeSet<String> = by_schema.keys().cloned().collect();
    names.extend(functions.keys().cloned());
    names.extend(procedures.keys().cloned());
    names.extend(triggers.keys().cloned());

    let schemas = names
        .into_iter()
        .map(|name| {
            let mut t = Vec::new();
            let mut v = Vec::new();
            for (_, node) in by_schema.remove(&name).unwrap_or_default() {
                if node.kind == "view" {
                    v.push(node);
                } else {
                    t.push(node);
                }
            }
            SchemaNode {
                tables: t,
                views: v,
                functions: functions.remove(&name).unwrap_or_default(),
                procedures: procedures.remove(&name).unwrap_or_default(),
                triggers: triggers.remove(&name).unwrap_or_default(),
                indexes: Vec::new(),
                name,
            }
        })
        .collect();

    DatabaseTree {
        name: intro.db_name,
        schemas,
    }
}

// (helper removed — first-column collection is inlined in `list_databases`)

// ── PostgreSQL fetch ──────────────────────────────────────────────────────

async fn fetch_postgres(p: &sqlx::PgPool) -> Result<Introspection, String> {
    let db_name: String = sqlx::query("SELECT current_database()")
        .fetch_one(p)
        .await
        .and_then(|r| r.try_get::<String, _>(0))
        .map_err(|e| e.to_string())?;

    let table_rows = sqlx::query(
        "SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind, \
                c.reltuples::bigint AS approx_rows, \
                pg_total_relation_size(c.oid) AS size_bytes, \
                obj_description(c.oid) AS comment \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relkind IN ('r','p','v','m') \
           AND n.nspname NOT IN ('pg_catalog','information_schema') \
           AND n.nspname NOT LIKE 'pg\\_%' \
         ORDER BY n.nspname, c.relname",
    )
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for r in &table_rows {
        let relkind: String = r.try_get("relkind").map_err(|e| e.to_string())?;
        let kind = if relkind == "v" || relkind == "m" { "view" } else { "table" };
        tables.push(TableMeta {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            name: r.try_get("name").map_err(|e| e.to_string())?,
            kind,
            approx_rows: r.try_get("approx_rows").unwrap_or(0),
            size_bytes: r.try_get("size_bytes").unwrap_or(0),
            comment: r.try_get("comment").ok().flatten(),
        });
    }

    let col_rows = sqlx::query(
        "SELECT table_schema AS schema, table_name AS \"table\", column_name AS name, \
                udt_name AS data_type, is_nullable, column_default \
         FROM information_schema.columns \
         WHERE table_schema NOT IN ('pg_catalog','information_schema') \
           AND table_schema NOT LIKE 'pg\\_%' \
         ORDER BY table_schema, table_name, ordinal_position",
    )
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut columns = Vec::new();
    for r in &col_rows {
        let nullable: String = r.try_get("is_nullable").map_err(|e| e.to_string())?;
        columns.push(ColRaw {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            table: r.try_get("table").map_err(|e| e.to_string())?,
            name: r.try_get("name").map_err(|e| e.to_string())?,
            data_type: r.try_get("data_type").map_err(|e| e.to_string())?,
            nullable: nullable.eq_ignore_ascii_case("yes"),
            default: r.try_get("column_default").ok().flatten(),
        });
    }

    let pks = pg_constraint_keys(p, "PRIMARY KEY").await?;
    let uniques = pg_constraint_keys(p, "UNIQUE").await?;

    let fk_rows = sqlx::query(
        "SELECT tc.table_schema AS schema, tc.table_name AS \"table\", \
                kcu.column_name AS \"column\", \
                ccu.table_name AS ref_table, ccu.column_name AS ref_column \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name \
          AND tc.table_schema = kcu.table_schema \
         JOIN information_schema.constraint_column_usage ccu \
           ON ccu.constraint_name = tc.constraint_name \
          AND ccu.table_schema = tc.table_schema \
         WHERE tc.constraint_type = 'FOREIGN KEY'",
    )
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut fks = HashMap::new();
    for r in &fk_rows {
        let key: Key = (
            r.try_get("schema").map_err(|e| e.to_string())?,
            r.try_get("table").map_err(|e| e.to_string())?,
            r.try_get("column").map_err(|e| e.to_string())?,
        );
        fks.insert(
            key,
            FkRef {
                table: r.try_get("ref_table").map_err(|e| e.to_string())?,
                column: r.try_get("ref_column").map_err(|e| e.to_string())?,
            },
        );
    }

    let idx_rows = sqlx::query(
        "SELECT schemaname AS schema, tablename AS \"table\", \
                indexname AS index, indexdef \
         FROM pg_indexes \
         WHERE schemaname NOT IN ('pg_catalog','information_schema') \
           AND schemaname NOT LIKE 'pg\\_%'",
    )
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut indexes = Vec::new();
    for r in &idx_rows {
        let schema: String = r.try_get("schema").map_err(|e| e.to_string())?;
        let table: String = r.try_get("table").map_err(|e| e.to_string())?;
        let index: String = r.try_get("index").map_err(|e| e.to_string())?;
        let def: String = r.try_get("indexdef").map_err(|e| e.to_string())?;
        let (unique, method, cols) = parse_pg_indexdef(&def);
        for c in cols {
            indexes.push(IdxRaw {
                schema: schema.clone(),
                table: table.clone(),
                index: index.clone(),
                unique,
                method: method.clone(),
                column: c,
            });
        }
    }

    let mut routines = non_fatal("funções/procedures", pg_routines(p).await);
    routines.extend(non_fatal("triggers", pg_triggers(p).await));

    Ok(Introspection {
        db_name,
        tables,
        columns,
        pks,
        uniques,
        fks,
        indexes,
        routines,
    })
}

/// Stored functions and procedures.
///
/// `prokind` distinguishes them and exists from Postgres 11 on; on older
/// servers this query errors and `non_fatal` drops the routine list rather
/// than failing the whole tree.
async fn pg_routines(p: &sqlx::PgPool) -> Result<Vec<RoutineRaw>, String> {
    let rows = sqlx::query(
        "SELECT n.nspname AS schema, p.proname AS name, \
                p.prokind::text AS prokind, \
                pg_get_function_result(p.oid) AS returns, \
                l.lanname AS language, \
                pg_get_function_identity_arguments(p.oid) AS args \
         FROM pg_proc p \
         JOIN pg_namespace n ON n.oid = p.pronamespace \
         JOIN pg_language l ON l.oid = p.prolang \
         WHERE p.prokind IN ('f','p') \
           AND n.nspname NOT IN ('pg_catalog','information_schema') \
           AND n.nspname NOT LIKE 'pg\\_%' \
         ORDER BY n.nspname, p.proname",
    )
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let prokind: String = r.try_get("prokind").unwrap_or_else(|_| "f".to_string());
        let name: String = r.try_get("name").map_err(|e| e.to_string())?;
        let args: String = r.try_get("args").unwrap_or_default();
        out.push(RoutineRaw {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            node: RoutineNode {
                kind: if prokind == "p" { "procedure" } else { "function" },
                signature: Some(format!("{name}({args})")),
                name,
                // Procedures return nothing; Postgres reports `void` for them.
                returns: r
                    .try_get::<Option<String>, _>("returns")
                    .ok()
                    .flatten()
                    .filter(|_| prokind != "p"),
                language: r.try_get("language").ok(),
            },
        });
    }
    Ok(out)
}

/// User triggers. `tgisinternal` filters out the ones Postgres creates behind
/// foreign keys and constraints, which are noise in a schema browser.
async fn pg_triggers(p: &sqlx::PgPool) -> Result<Vec<RoutineRaw>, String> {
    let rows = sqlx::query(
        "SELECT n.nspname AS schema, t.tgname AS name, c.relname AS table_name, \
                pg_get_triggerdef(t.oid) AS definition \
         FROM pg_trigger t \
         JOIN pg_class c ON c.oid = t.tgrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE NOT t.tgisinternal \
           AND n.nspname NOT IN ('pg_catalog','information_schema') \
           AND n.nspname NOT LIKE 'pg\\_%' \
         ORDER BY n.nspname, t.tgname",
    )
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let table: String = r.try_get("table_name").unwrap_or_default();
        out.push(RoutineRaw {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            node: RoutineNode {
                kind: "trigger",
                name: r.try_get("name").map_err(|e| e.to_string())?,
                returns: None,
                language: None,
                // The full CREATE TRIGGER is what the user wants when they open
                // it in a tab, so keep it verbatim.
                signature: r
                    .try_get::<Option<String>, _>("definition")
                    .ok()
                    .flatten()
                    .or_else(|| Some(format!("-- em {table}"))),
            },
        });
    }
    Ok(out)
}

async fn pg_constraint_keys(p: &sqlx::PgPool, kind: &str) -> Result<HashSet<Key>, String> {
    let rows = sqlx::query(
        "SELECT tc.table_schema AS schema, tc.table_name AS \"table\", \
                kcu.column_name AS \"column\" \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name \
          AND tc.table_schema = kcu.table_schema \
         WHERE tc.constraint_type = $1",
    )
    .bind(kind)
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut set = HashSet::new();
    for r in &rows {
        set.insert((
            r.try_get("schema").map_err(|e| e.to_string())?,
            r.try_get("table").map_err(|e| e.to_string())?,
            r.try_get("column").map_err(|e| e.to_string())?,
        ));
    }
    Ok(set)
}

/// Extract (unique, method, columns) from a Postgres `CREATE INDEX` statement.
fn parse_pg_indexdef(def: &str) -> (bool, Option<String>, Vec<String>) {
    let unique = def.to_uppercase().contains("CREATE UNIQUE INDEX");
    let method = def
        .find(" USING ")
        .map(|i| &def[i + 7..])
        .and_then(|rest| rest.split_whitespace().next())
        .map(|m| m.to_string());
    let columns = def
        .find('(')
        .and_then(|start| def[start + 1..].rfind(')').map(|end| &def[start + 1..start + 1 + end]))
        .map(|inner| {
            inner
                .split(',')
                .map(|c| c.trim().trim_matches('"').to_string())
                .filter(|c| !c.is_empty())
                .collect()
        })
        .unwrap_or_default();
    (unique, method, columns)
}

// ── MySQL / MariaDB fetch ─────────────────────────────────────────────────

const MYSQL_SKIP: &str =
    "('mysql','information_schema','performance_schema','sys')";

async fn fetch_mysql(p: &sqlx::MySqlPool) -> Result<Introspection, String> {
    let db_name: String = sqlx::query("SELECT DATABASE()")
        .fetch_one(p)
        .await
        .and_then(|r| r.try_get::<Option<String>, _>(0))
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "MySQL".to_string());

    let table_rows = sqlx::query(&format!(
        "SELECT CAST(table_schema AS CHAR) AS `schema`, CAST(table_name AS CHAR) AS name, \
                CAST(table_type AS CHAR) AS table_type, \
                CAST(IFNULL(table_rows,0) AS SIGNED) AS approx_rows, \
                CAST(IFNULL(data_length,0)+IFNULL(index_length,0) AS SIGNED) AS size_bytes, \
                CAST(table_comment AS CHAR) AS comment \
         FROM information_schema.tables \
         WHERE table_schema NOT IN {MYSQL_SKIP} \
         ORDER BY table_schema, table_name"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for r in &table_rows {
        let table_type: String = r.try_get("table_type").map_err(|e| e.to_string())?;
        let kind = if table_type.eq_ignore_ascii_case("VIEW") { "view" } else { "table" };
        tables.push(TableMeta {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            name: r.try_get("name").map_err(|e| e.to_string())?,
            kind,
            approx_rows: r.try_get("approx_rows").unwrap_or(0),
            size_bytes: r.try_get("size_bytes").unwrap_or(0),
            comment: r.try_get("comment").ok().flatten(),
        });
    }

    let col_rows = sqlx::query(&format!(
        "SELECT CAST(table_schema AS CHAR) AS `schema`, CAST(table_name AS CHAR) AS `table`, \
                CAST(column_name AS CHAR) AS name, CAST(column_type AS CHAR) AS data_type, \
                CAST(is_nullable AS CHAR) AS is_nullable, CAST(column_default AS CHAR) AS column_default, \
                CAST(column_key AS CHAR) AS column_key \
         FROM information_schema.columns \
         WHERE table_schema NOT IN {MYSQL_SKIP} \
         ORDER BY table_schema, table_name, ordinal_position"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut columns = Vec::new();
    let mut pks = HashSet::new();
    let mut uniques = HashSet::new();
    for r in &col_rows {
        let nullable: String = r.try_get("is_nullable").map_err(|e| e.to_string())?;
        let col_key: String = r.try_get("column_key").unwrap_or_default();
        let schema: String = r.try_get("schema").map_err(|e| e.to_string())?;
        let table: String = r.try_get("table").map_err(|e| e.to_string())?;
        let name: String = r.try_get("name").map_err(|e| e.to_string())?;
        let key: Key = (schema.clone(), table.clone(), name.clone());
        if col_key == "PRI" {
            pks.insert(key.clone());
        }
        if col_key == "UNI" {
            uniques.insert(key.clone());
        }
        columns.push(ColRaw {
            schema,
            table,
            name,
            data_type: r.try_get("data_type").map_err(|e| e.to_string())?,
            nullable: nullable.eq_ignore_ascii_case("yes"),
            default: r.try_get("column_default").ok().flatten(),
        });
    }

    let fk_rows = sqlx::query(&format!(
        "SELECT CAST(table_schema AS CHAR) AS `schema`, CAST(table_name AS CHAR) AS `table`, \
                CAST(column_name AS CHAR) AS `column`, \
                CAST(referenced_table_name AS CHAR) AS ref_table, \
                CAST(referenced_column_name AS CHAR) AS ref_column \
         FROM information_schema.key_column_usage \
         WHERE referenced_table_name IS NOT NULL \
           AND table_schema NOT IN {MYSQL_SKIP}"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut fks = HashMap::new();
    for r in &fk_rows {
        let key: Key = (
            r.try_get("schema").map_err(|e| e.to_string())?,
            r.try_get("table").map_err(|e| e.to_string())?,
            r.try_get("column").map_err(|e| e.to_string())?,
        );
        fks.insert(
            key,
            FkRef {
                table: r.try_get("ref_table").map_err(|e| e.to_string())?,
                column: r.try_get("ref_column").map_err(|e| e.to_string())?,
            },
        );
    }

    let idx_rows = sqlx::query(&format!(
        "SELECT CAST(table_schema AS CHAR) AS `schema`, CAST(table_name AS CHAR) AS `table`, \
                CAST(index_name AS CHAR) AS `index`, \
                CAST(non_unique AS SIGNED) AS non_unique, CAST(index_type AS CHAR) AS index_type, \
                CAST(column_name AS CHAR) AS `column` \
         FROM information_schema.statistics \
         WHERE table_schema NOT IN {MYSQL_SKIP} \
         ORDER BY table_schema, table_name, index_name, seq_in_index"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut indexes = Vec::new();
    for r in &idx_rows {
        let non_unique: i64 = r.try_get("non_unique").unwrap_or(1);
        indexes.push(IdxRaw {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            table: r.try_get("table").map_err(|e| e.to_string())?,
            index: r.try_get("index").map_err(|e| e.to_string())?,
            unique: non_unique == 0,
            method: r.try_get("index_type").ok(),
            column: r.try_get("column").unwrap_or_default(),
        });
    }

    let mut routines = non_fatal("funções/procedures", my_routines(p).await);
    routines.extend(non_fatal("triggers", my_triggers(p).await));

    Ok(Introspection {
        db_name,
        tables,
        columns,
        pks,
        uniques,
        fks,
        indexes,
        routines,
    })
}

/// Stored functions and procedures, with argument lists assembled from
/// `information_schema.parameters` (ordinal 0 is a function's return value).
async fn my_routines(p: &sqlx::MySqlPool) -> Result<Vec<RoutineRaw>, String> {
    let param_rows = sqlx::query(&format!(
        "SELECT CAST(specific_schema AS CHAR) AS `schema`, \
                CAST(specific_name AS CHAR) AS name, \
                CAST(IFNULL(parameter_name,'') AS CHAR) AS pname, \
                CAST(dtd_identifier AS CHAR) AS ptype \
         FROM information_schema.parameters \
         WHERE specific_schema NOT IN {MYSQL_SKIP} \
           AND ordinal_position > 0 \
         ORDER BY specific_schema, specific_name, ordinal_position"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut params: HashMap<(String, String), Vec<String>> = HashMap::new();
    for r in &param_rows {
        let schema: String = r.try_get("schema").unwrap_or_default();
        let name: String = r.try_get("name").unwrap_or_default();
        let pname: String = r.try_get("pname").unwrap_or_default();
        let ptype: String = r.try_get("ptype").unwrap_or_default();
        params
            .entry((schema, name))
            .or_default()
            .push(format!("{pname} {ptype}").trim().to_string());
    }

    let rows = sqlx::query(&format!(
        "SELECT CAST(routine_schema AS CHAR) AS `schema`, \
                CAST(routine_name AS CHAR) AS name, \
                CAST(routine_type AS CHAR) AS routine_type, \
                CAST(dtd_identifier AS CHAR) AS `returns`, \
                CAST(routine_body AS CHAR) AS `language` \
         FROM information_schema.routines \
         WHERE routine_schema NOT IN {MYSQL_SKIP} \
         ORDER BY routine_schema, routine_name"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let schema: String = r.try_get("schema").map_err(|e| e.to_string())?;
        let name: String = r.try_get("name").map_err(|e| e.to_string())?;
        let routine_type: String = r.try_get("routine_type").unwrap_or_default();
        let is_proc = routine_type.eq_ignore_ascii_case("PROCEDURE");
        let args = params
            .get(&(schema.clone(), name.clone()))
            .map(|v| v.join(", "))
            .unwrap_or_default();
        out.push(RoutineRaw {
            schema,
            node: RoutineNode {
                kind: if is_proc { "procedure" } else { "function" },
                signature: Some(format!("{name}({args})")),
                name,
                returns: r
                    .try_get::<Option<String>, _>("returns")
                    .ok()
                    .flatten()
                    .filter(|_| !is_proc),
                language: r.try_get("language").ok(),
            },
        });
    }
    Ok(out)
}

async fn my_triggers(p: &sqlx::MySqlPool) -> Result<Vec<RoutineRaw>, String> {
    let rows = sqlx::query(&format!(
        "SELECT CAST(trigger_schema AS CHAR) AS `schema`, \
                CAST(trigger_name AS CHAR) AS name, \
                CAST(event_object_table AS CHAR) AS table_name, \
                CAST(action_timing AS CHAR) AS timing, \
                CAST(event_manipulation AS CHAR) AS `event` \
         FROM information_schema.triggers \
         WHERE trigger_schema NOT IN {MYSQL_SKIP} \
         ORDER BY trigger_schema, trigger_name"
    ))
    .fetch_all(p)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let timing: String = r.try_get("timing").unwrap_or_default();
        let event: String = r.try_get("event").unwrap_or_default();
        let table: String = r.try_get("table_name").unwrap_or_default();
        out.push(RoutineRaw {
            schema: r.try_get("schema").map_err(|e| e.to_string())?,
            node: RoutineNode {
                kind: "trigger",
                name: r.try_get("name").map_err(|e| e.to_string())?,
                returns: None,
                language: None,
                signature: Some(format!("{timing} {event} ON `{table}`").trim().to_string()),
            },
        });
    }
    Ok(out)
}
