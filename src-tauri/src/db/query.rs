// ── Query execution ───────────────────────────────────────────────────────
// Runs SQL scripts against a live pool and shapes each statement's outcome
// into a `QueryResult` the frontend renders.
//
// Three concerns live here:
//   • Splitting a script into individual statements (the wire protocol only
//     accepts one prepared statement per round trip).
//   • Deciding whether a statement returns rows, and paging through them
//     without materialising the whole result set.
//   • Decoding cells into JSON. Decoding probes a sequence of Rust types (the
//     driver rejects mismatches cleanly), so we stay engine-agnostic without
//     hard-coding every type OID.

use std::time::Instant;

use futures_util::TryStreamExt;
use serde::Serialize;
use serde_json::Value as Json;
use sqlx::mysql::MySqlRow;
use sqlx::postgres::PgRow;
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, Executor, Row, TypeInfo};

use crate::db::DbPool;

/// Rows returned per page when the caller doesn't ask for a specific size.
pub const DEFAULT_PAGE_SIZE: usize = 1_000;
/// Upper bound on a single page, so a hostile `limit` can't exhaust memory.
const MAX_PAGE_SIZE: usize = 50_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryError {
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    /// "rows" | "affected" | "error"
    pub kind: &'static str,
    /// The single statement that produced this result. The frontend sends it
    /// back verbatim when paging, so it must stay executable on its own.
    pub statement: String,
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Json>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub duration_ms: u64,
    /// Index of the first row in `rows` within the full result set.
    pub offset: i64,
    /// True when the server had at least one more row past this page.
    pub has_more: bool,
    /// Only known once the set has been read to the end; `None` while paging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_rows: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<QueryError>,
}

// ── Entry points ──────────────────────────────────────────────────────────

/// Execute every statement in `sql`, in order, returning one result each.
///
/// A failing statement stops execution but does not discard the results that
/// already succeeded: the failure is appended as an `error` result so the UI
/// can show how far the script got.
pub async fn run_script(
    pool: &DbPool,
    sql: &str,
    limit: Option<usize>,
) -> Result<Vec<QueryResult>, String> {
    let statements = split_statements(sql, pool.is_mysql());
    if statements.is_empty() {
        return Err("Nenhum comando SQL para executar.".to_string());
    }

    let mut out = Vec::with_capacity(statements.len());
    for stmt in statements {
        match run_statement(pool, &stmt, 0, limit).await {
            Ok(result) => out.push(result),
            Err(message) => {
                out.push(error_result(stmt, message));
                break;
            }
        }
    }
    Ok(out)
}

/// Re-run a single statement to fetch the page starting at `offset`.
///
/// Offset paging re-executes the statement server-side rather than holding a
/// cursor open, which keeps connections free between pages at the cost of
/// repeated work. Non-deterministic statements may therefore shift between
/// pages — the same trade-off every stateless SQL client makes.
pub async fn fetch_page(
    pool: &DbPool,
    sql: &str,
    offset: i64,
    limit: Option<usize>,
) -> Result<QueryResult, String> {
    let offset = offset.max(0);
    run_statement(pool, sql.trim(), offset, limit).await
}

// ── Single statement ──────────────────────────────────────────────────────

async fn run_statement(
    pool: &DbPool,
    sql: &str,
    offset: i64,
    limit: Option<usize>,
) -> Result<QueryResult, String> {
    let page = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let start = Instant::now();

    if !returns_rows(sql) {
        let affected = match pool {
            DbPool::Postgres(p) => sqlx::query(sql).execute(p).await.map(|r| r.rows_affected()),
            DbPool::MySql(p) => sqlx::query(sql).execute(p).await.map(|r| r.rows_affected()),
        }
        .map_err(|e| e.to_string())?;
        return Ok(affected_result(sql, affected, start));
    }

    match pool {
        DbPool::Postgres(p) => {
            // Fetch one row past the page so `has_more` is exact without a
            // second count query.
            let mut stream = sqlx::query(sql).fetch(p);
            let mut rows: Vec<PgRow> = Vec::new();
            let mut has_more = false;
            let mut seen: i64 = 0;
            while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                if seen >= offset {
                    if rows.len() >= page {
                        has_more = true;
                        break;
                    }
                    rows.push(row);
                }
                seen += 1;
            }
            drop(stream);

            let mut columns: Vec<ResultColumn> = rows
                .first()
                .map(|r| {
                    r.columns()
                        .iter()
                        .map(|c| ResultColumn {
                            name: c.name().to_string(),
                            col_type: map_pg_type(c.type_info().name()),
                            table: None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            if columns.is_empty() {
                columns = describe_pg_columns(p, sql).await;
            }

            let cells = rows
                .iter()
                .map(|row| (0..columns.len()).map(|i| pg_cell(row, i)).collect())
                .collect();
            Ok(rows_result(sql, columns, cells, offset, has_more, seen, start))
        }
        DbPool::MySql(p) => {
            let mut stream = sqlx::query(sql).fetch(p);
            let mut rows: Vec<MySqlRow> = Vec::new();
            let mut has_more = false;
            let mut seen: i64 = 0;
            while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                if seen >= offset {
                    if rows.len() >= page {
                        has_more = true;
                        break;
                    }
                    rows.push(row);
                }
                seen += 1;
            }
            drop(stream);

            let mut columns: Vec<ResultColumn> = rows
                .first()
                .map(|r| {
                    r.columns()
                        .iter()
                        .map(|c| ResultColumn {
                            name: c.name().to_string(),
                            col_type: map_my_type(c.type_info().name()),
                            table: None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            if columns.is_empty() {
                columns = describe_my_columns(p, sql).await;
            }

            let cells = rows
                .iter()
                .map(|row| (0..columns.len()).map(|i| my_cell(row, i)).collect())
                .collect();
            Ok(rows_result(sql, columns, cells, offset, has_more, seen, start))
        }
    }
}

/// Column metadata for a statement that returned no rows. Preparing the
/// statement yields its output shape without executing it; failures are
/// swallowed because an empty header is a cosmetic loss, not an error.
async fn describe_pg_columns(pool: &sqlx::PgPool, sql: &str) -> Vec<ResultColumn> {
    match pool.describe(sql).await {
        Ok(d) => d
            .columns()
            .iter()
            .map(|c| ResultColumn {
                name: c.name().to_string(),
                col_type: map_pg_type(c.type_info().name()),
                table: None,
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

async fn describe_my_columns(pool: &sqlx::MySqlPool, sql: &str) -> Vec<ResultColumn> {
    match pool.describe(sql).await {
        Ok(d) => d
            .columns()
            .iter()
            .map(|c| ResultColumn {
                name: c.name().to_string(),
                col_type: map_my_type(c.type_info().name()),
                table: None,
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

// ── Result assembly ───────────────────────────────────────────────────────

fn rows_result(
    sql: &str,
    columns: Vec<ResultColumn>,
    rows: Vec<Vec<Json>>,
    offset: i64,
    has_more: bool,
    seen: i64,
    start: Instant,
) -> QueryResult {
    QueryResult {
        kind: "rows",
        statement: sql.to_string(),
        columns,
        rows,
        affected_rows: None,
        command: None,
        duration_ms: elapsed_ms(start),
        offset,
        has_more,
        // `seen` is the true row count only when the stream ran dry.
        total_rows: (!has_more).then_some(seen),
        error: None,
    }
}

fn affected_result(sql: &str, n: u64, start: Instant) -> QueryResult {
    QueryResult {
        kind: "affected",
        statement: sql.to_string(),
        columns: Vec::new(),
        rows: Vec::new(),
        affected_rows: Some(n as i64),
        command: command_word(sql),
        duration_ms: elapsed_ms(start),
        offset: 0,
        has_more: false,
        total_rows: None,
        error: None,
    }
}

fn error_result(sql: String, message: String) -> QueryResult {
    QueryResult {
        kind: "error",
        statement: sql,
        columns: Vec::new(),
        rows: Vec::new(),
        affected_rows: None,
        command: None,
        duration_ms: 0,
        offset: 0,
        has_more: false,
        total_rows: None,
        error: Some(QueryError { message }),
    }
}

// ── Cell decoding ─────────────────────────────────────────────────────────

/// Build a JSON number from an f64, falling back to null for NaN/inf.
fn jf(v: f64) -> Json {
    serde_json::Number::from_f64(v)
        .map(Json::Number)
        .unwrap_or(Json::Null)
}

fn pg_cell(row: &PgRow, i: usize) -> Json {
    if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
        return v.map(Json::Bool).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<i16>, _>(i) {
        return v.map(|n| Json::from(n as i64)).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<i32>, _>(i) {
        return v.map(|n| Json::from(n as i64)).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
        return v.map(Json::from).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<f32>, _>(i) {
        return v.map(|n| jf(n as f64)).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
        return v.map(jf).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<BigDecimal>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<Json>, _>(i) {
        return v.unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<Uuid>, _>(i) {
        return v.map(|u| Json::String(u.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<DateTime<Utc>>, _>(i) {
        return v.map(|d| Json::String(d.to_rfc3339())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<NaiveDateTime>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<NaiveDate>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<NaiveTime>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<String>, _>(i) {
        return v.map(Json::String).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return v.map(|b| Json::String(hex(&b))).unwrap_or(Json::Null);
    }
    Json::Null
}

fn my_cell(row: &MySqlRow, i: usize) -> Json {
    // MySQL has no native boolean: BOOL/BOOLEAN are aliases for TINYINT, and
    // sqlx's `bool` decoder is compatible with the integer types. Probing bool
    // first would collapse every non-zero integer column to `true`, so only
    // take the bool path when the driver actually reports a boolean type.
    let ty = row.column(i).type_info().name().to_ascii_uppercase();
    if matches!(ty.as_str(), "BOOL" | "BOOLEAN") {
        if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
            return v.map(Json::Bool).unwrap_or(Json::Null);
        }
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
        return v.map(Json::from).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
        return v.map(Json::from).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
        return v.map(jf).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<BigDecimal>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<Json>, _>(i) {
        return v.unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<DateTime<Utc>>, _>(i) {
        return v.map(|d| Json::String(d.to_rfc3339())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<NaiveDateTime>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<NaiveDate>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<NaiveTime>, _>(i) {
        return v.map(|d| Json::String(d.to_string())).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<String>, _>(i) {
        return v.map(Json::String).unwrap_or(Json::Null);
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return v.map(|b| Json::String(hex(&b))).unwrap_or(Json::Null);
    }
    Json::Null
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(2 + bytes.len() * 2);
    s.push_str("0x");
    for b in bytes {
        let _ = write!(s, "{:02x}", b);
    }
    s
}

// ── Type labels (→ frontend ColumnType) ───────────────────────────────────

fn map_pg_type(name: &str) -> &'static str {
    match name.to_uppercase().as_str() {
        "BOOL" => "boolean",
        "INT2" | "INT4" | "INT8" | "FLOAT4" | "FLOAT8" | "NUMERIC" | "MONEY" | "OID" => "number",
        "UUID" => "uuid",
        "JSON" | "JSONB" => "json",
        "DATE" | "TIME" | "TIMETZ" | "TIMESTAMP" | "TIMESTAMPTZ" => "date",
        _ => "string",
    }
}

fn map_my_type(name: &str) -> &'static str {
    let n = name.to_uppercase();
    if n.contains("INT") {
        return "number";
    }
    match n.as_str() {
        "DECIMAL" | "FLOAT" | "DOUBLE" | "NEWDECIMAL" | "YEAR" => "number",
        "JSON" => "json",
        "BOOL" | "BOOLEAN" => "boolean",
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME" => "date",
        _ => "string",
    }
}

// ── SQL classification ────────────────────────────────────────────────────

/// True when the statement is expected to return a result set.
fn returns_rows(sql: &str) -> bool {
    let bare = strip_comments(sql, false);
    if has_word(&bare, "RETURNING") {
        return true;
    }
    matches!(
        leading_keyword(&bare).as_str(),
        "SELECT"
            | "WITH"
            | "SHOW"
            | "EXPLAIN"
            | "VALUES"
            | "TABLE"
            | "DESCRIBE"
            | "DESC"
            | "PRAGMA"
            | "ANALYZE"
            | "CALL"
    )
}

/// Whole-word, case-insensitive search. Guards against matching `RETURNING`
/// inside an identifier such as `no_returning_flag`.
fn has_word(sql: &str, word: &str) -> bool {
    let hay = sql.to_uppercase();
    let needle = word.to_uppercase();
    let bytes = hay.as_bytes();
    let mut from = 0;
    while let Some(rel) = hay[from..].find(&needle) {
        let at = from + rel;
        let end = at + needle.len();
        let before_ok = at == 0 || !is_ident_byte(bytes[at - 1]);
        let after_ok = end >= bytes.len() || !is_ident_byte(bytes[end]);
        if before_ok && after_ok {
            return true;
        }
        from = at + 1;
    }
    false
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

/// First SQL keyword, uppercased. Expects comment-free input.
fn leading_keyword(sql: &str) -> String {
    sql.split_whitespace()
        .next()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .to_uppercase()
        })
        .unwrap_or_default()
}

fn command_word(sql: &str) -> Option<String> {
    let kw = leading_keyword(&strip_comments(sql, false));
    (!kw.is_empty()).then_some(kw)
}

fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64
}

// ── Statement splitting ───────────────────────────────────────────────────

/// Split a script on top-level semicolons.
///
/// Semicolons inside string literals, quoted identifiers, comments and
/// Postgres dollar-quoted bodies are ignored. `mysql` switches on the dialect
/// quirks that differ: `#` line comments and backslash escapes inside string
/// literals (both MySQL-only; in Postgres `#` is an operator character).
///
/// Known limitation: a routine body written with plain `BEGIN … END;` and no
/// dollar quoting (MySQL `CREATE PROCEDURE` without a `DELIMITER` change) will
/// be split at its inner semicolons, exactly as the MySQL CLI would.
fn split_statements(sql: &str, mysql: bool) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut out: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < n {
        match chars[i] {
            '\'' => i = skip_quoted(&chars, i, '\'', mysql),
            '"' => i = skip_quoted(&chars, i, '"', false),
            '`' => i = skip_quoted(&chars, i, '`', false),
            '-' if i + 1 < n && chars[i + 1] == '-' => i = skip_line_comment(&chars, i),
            '#' if mysql => i = skip_line_comment(&chars, i),
            '/' if i + 1 < n && chars[i + 1] == '*' => i = skip_block_comment(&chars, i),
            '$' if !mysql => {
                i = match skip_dollar_quoted(&chars, i) {
                    Some(end) => end,
                    None => i + 1,
                }
            }
            ';' => {
                push_statement(&mut out, &chars[start..i], mysql);
                i += 1;
                start = i;
            }
            _ => i += 1,
        }
    }
    push_statement(&mut out, &chars[start..], mysql);
    out
}

/// Append a statement unless it is only whitespace and comments.
fn push_statement(out: &mut Vec<String>, chars: &[char], mysql: bool) {
    let stmt: String = chars.iter().collect();
    if strip_comments(&stmt, mysql).trim().is_empty() {
        return;
    }
    out.push(stmt.trim().to_string());
}

/// Advance past a quoted run that starts at `start`. Doubled delimiters escape
/// themselves in every dialect; `backslash` additionally honours `\x` escapes.
fn skip_quoted(chars: &[char], start: usize, quote: char, backslash: bool) -> usize {
    let n = chars.len();
    let mut i = start + 1;
    while i < n {
        if backslash && chars[i] == '\\' {
            i += 2;
            continue;
        }
        if chars[i] == quote {
            if i + 1 < n && chars[i + 1] == quote {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    n
}

fn skip_line_comment(chars: &[char], start: usize) -> usize {
    let n = chars.len();
    let mut i = start;
    while i < n && chars[i] != '\n' {
        i += 1;
    }
    i
}

/// Postgres allows nested block comments, so track depth rather than scanning
/// for the first `*/`.
fn skip_block_comment(chars: &[char], start: usize) -> usize {
    let n = chars.len();
    let mut i = start + 2;
    let mut depth = 1usize;
    while i < n {
        if i + 1 < n && chars[i] == '/' && chars[i + 1] == '*' {
            depth += 1;
            i += 2;
            continue;
        }
        if i + 1 < n && chars[i] == '*' && chars[i + 1] == '/' {
            depth -= 1;
            i += 2;
            if depth == 0 {
                return i;
            }
            continue;
        }
        i += 1;
    }
    n
}

/// Advance past a Postgres dollar-quoted body (`$$…$$` or `$tag$…$tag$`).
/// Returns `None` when the `$` is not opening one — e.g. a `$1` placeholder.
fn skip_dollar_quoted(chars: &[char], start: usize) -> Option<usize> {
    let n = chars.len();
    let mut i = start + 1;
    let mut tag = String::new();
    while i < n && chars[i] != '$' {
        let c = chars[i];
        let valid = if tag.is_empty() {
            c.is_alphabetic() || c == '_'
        } else {
            c.is_alphanumeric() || c == '_'
        };
        if !valid {
            return None;
        }
        tag.push(c);
        i += 1;
    }
    if i >= n {
        return None;
    }

    let delim: Vec<char> = format!("${}$", tag).chars().collect();
    let mut j = i + 1;
    while j + delim.len() <= n {
        if chars[j..j + delim.len()] == delim[..] {
            return Some(j + delim.len());
        }
        j += 1;
    }
    Some(n)
}

/// Blank out comments so keyword checks and blankness tests see only code.
/// Quoted runs are preserved verbatim; comment bodies collapse to a space.
fn strip_comments(sql: &str, mysql: bool) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0usize;

    while i < n {
        let next = match chars[i] {
            '\'' => skip_quoted(&chars, i, '\'', mysql),
            '"' => skip_quoted(&chars, i, '"', false),
            '`' => skip_quoted(&chars, i, '`', false),
            '-' if i + 1 < n && chars[i + 1] == '-' => {
                let end = skip_line_comment(&chars, i);
                out.push(' ');
                i = end;
                continue;
            }
            '#' if mysql => {
                let end = skip_line_comment(&chars, i);
                out.push(' ');
                i = end;
                continue;
            }
            '/' if i + 1 < n && chars[i + 1] == '*' => {
                let end = skip_block_comment(&chars, i);
                out.push(' ');
                i = end;
                continue;
            }
            _ => {
                out.push(chars[i]);
                i += 1;
                continue;
            }
        };
        out.extend(&chars[i..next]);
        i = next;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_top_level_semicolons() {
        let stmts = split_statements("SELECT 1; SELECT 2;", false);
        assert_eq!(stmts, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn ignores_semicolons_inside_literals_and_comments() {
        let sql = "SELECT ';' AS a; -- trailing; comment\nSELECT \"b;c\" FROM t";
        let stmts = split_statements(sql, false);
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[0], "SELECT ';' AS a");
        // A comment sitting after the semicolon belongs to the next fragment
        // and is kept verbatim — the server ignores it.
        assert!(stmts[1].ends_with("SELECT \"b;c\" FROM t"));
    }

    #[test]
    fn ignores_semicolons_inside_dollar_quoted_bodies() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; SELECT 1";
        let stmts = split_statements(sql, false);
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[1], "SELECT 1");
    }

    #[test]
    fn drops_comment_only_fragments() {
        assert!(split_statements("-- nothing here\n;   ;", false).is_empty());
        assert!(split_statements("/* just a note */", false).is_empty());
    }

    #[test]
    fn mysql_hash_comments_and_backslash_escapes() {
        let sql = "SELECT '\\';' AS a # note; here\n; SELECT 2";
        let stmts = split_statements(sql, true);
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[1], "SELECT 2");
    }

    #[test]
    fn postgres_dollar_placeholder_is_not_a_quote() {
        let stmts = split_statements("SELECT $1; SELECT 2", false);
        assert_eq!(stmts.len(), 2);
    }

    #[test]
    fn returning_detection_requires_word_boundaries() {
        assert!(returns_rows("INSERT INTO t VALUES (1) RETURNING id"));
        assert!(!returns_rows("INSERT INTO t (no_returning_flag) VALUES (1)"));
        assert!(!returns_rows("-- RETURNING\nUPDATE t SET a = 1"));
    }

    #[test]
    fn leading_keyword_skips_comments() {
        assert!(returns_rows("/* hi */ SELECT 1"));
        assert!(returns_rows("  -- note\n  with x as (select 1) select * from x"));
    }
}
