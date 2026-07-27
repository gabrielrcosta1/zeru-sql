// ── Tauri command surface ─────────────────────────────────────────────────
// Thin async wrappers the frontend calls via `invoke`. All errors are returned
// as strings so they surface cleanly in the UI.

use tauri::{AppHandle, State};

use crate::db::introspect::{self, DatabaseTree};
use crate::db::query::{self, QueryResult};
use crate::ai::{self, AiRegistry, AiSettings, ChatMessage};
use crate::db::{build_pool, ConnectionConfig, ConnectionInfo, ConnectionManager};
use crate::history::{HistoryEntry, HistoryStore};
use crate::persist::{self, SavedConnection};

/// Validate a config by opening a pool, running a trivial probe, then dropping
/// it. Does not register the connection.
#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    let pool = build_pool(&config).await?;
    // `build_pool` already established a live connection; report the engine.
    drop(pool);
    Ok(format!("{:?}", config.engine))
}

/// Open and register a connection pool, returning server metadata.
#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionInfo, String> {
    manager.connect(&config).await
}

/// Close a registered connection. Returns true if one was open.
#[tauri::command]
pub async fn disconnect(
    id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<bool, String> {
    Ok(manager.disconnect(&id).await)
}

/// List the databases visible on an open connection's server.
#[tauri::command]
pub async fn list_databases(
    id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<String>, String> {
    let pool = manager
        .get(&id)
        .await
        .ok_or_else(|| "Conexão não encontrada ou não está aberta.".to_string())?;
    introspect::list_databases(&pool).await
}

/// Build the full schema tree (schemas → tables/views → columns/indexes).
#[tauri::command]
pub async fn get_database_tree(
    id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<DatabaseTree, String> {
    let pool = manager
        .get(&id)
        .await
        .ok_or_else(|| "Conexão não encontrada ou não está aberta.".to_string())?;
    introspect::database_tree(&pool).await
}

/// Execute a SQL script on an open connection: one result per statement, in
/// order. A statement that fails ends the run but keeps the results before it.
#[tauri::command]
pub async fn run_query(
    id: String,
    sql: String,
    limit: Option<usize>,
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<QueryResult>, String> {
    let pool = manager
        .get(&id)
        .await
        .ok_or_else(|| "Conexão não encontrada ou não está aberta.".to_string())?;
    query::run_script(&pool, &sql, limit).await
}

/// Re-run a single statement to retrieve the page starting at `offset`.
/// `sql` is the `statement` field of a previous `run_query` result.
#[tauri::command]
pub async fn fetch_page(
    id: String,
    sql: String,
    offset: i64,
    limit: Option<usize>,
    manager: State<'_, ConnectionManager>,
) -> Result<QueryResult, String> {
    let pool = manager
        .get(&id)
        .await
        .ok_or_else(|| "Conexão não encontrada ou não está aberta.".to_string())?;
    query::fetch_page(&pool, &sql, offset, limit).await
}

// ── Connection persistence ────────────────────────────────────────────────

/// Save (or update) a connection's metadata on disk and its password in the OS
/// keychain. Pass `password: Some("")` to clear a stored secret.
#[tauri::command]
pub fn save_connection(
    app: AppHandle,
    connection: SavedConnection,
    password: Option<String>,
) -> Result<(), String> {
    persist::upsert(&app, connection, password)
}

/// Return all persisted connection metadata (passwords excluded).
#[tauri::command]
pub fn load_connections(app: AppHandle) -> Result<Vec<SavedConnection>, String> {
    persist::load(&app)
}

/// Fetch a saved connection's password from the keychain, if present.
#[tauri::command]
pub fn load_password(id: String) -> Result<Option<String>, String> {
    persist::password(&id)
}

/// Delete a saved connection's metadata and keychain password.
#[tauri::command]
pub fn delete_connection(app: AppHandle, id: String) -> Result<(), String> {
    persist::remove(&app, &id)
}

// ── Query history ─────────────────────────────────────────────────────────

/// Load the persisted query history, newest first.
#[tauri::command]
pub async fn load_history(
    app: AppHandle,
    history: State<'_, HistoryStore>,
) -> Result<Vec<HistoryEntry>, String> {
    history.load(&app).await
}

/// Record an executed query.
#[tauri::command]
pub async fn push_history(
    app: AppHandle,
    entry: HistoryEntry,
    history: State<'_, HistoryStore>,
) -> Result<(), String> {
    history.push(&app, entry).await
}

/// Mark or unmark a history entry as a favourite. Returns `None` when the id
/// is no longer in the store.
#[tauri::command]
pub async fn set_history_favorite(
    app: AppHandle,
    id: String,
    favorite: bool,
    history: State<'_, HistoryStore>,
) -> Result<Option<bool>, String> {
    history.set_favorite(&app, &id, favorite).await
}

/// Wipe the history, favourites included.
#[tauri::command]
pub async fn clear_history(
    app: AppHandle,
    history: State<'_, HistoryStore>,
) -> Result<(), String> {
    history.clear(&app).await
}

// ── File export ───────────────────────────────────────────────────────────

/// Ask the user where to save, then write `contents` there.
///
/// Returns the chosen path, or `None` when the dialog was cancelled.
///
/// This exists because the browser download path does not work inside the
/// app: WKWebView ignores the `download` attribute on blob URLs, so the
/// previous implementation silently did nothing on macOS. Async so the
/// blocking dialog never runs on the main thread.
#[tauri::command]
pub async fn export_file(
    app: AppHandle,
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let path = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ── AI assistant ──────────────────────────────────────────────────────────

/// Current AI provider settings. `hasApiKey` reports whether a key is stored;
/// the key itself is never returned.
#[tauri::command]
pub fn load_ai_settings(app: AppHandle) -> Result<AiSettings, String> {
    ai::load_settings(&app)
}

/// Save provider settings, and the API key when supplied. Pass `apiKey: ""`
/// to remove a stored key, or omit it to leave the key untouched.
#[tauri::command]
pub fn save_ai_settings(
    app: AppHandle,
    settings: AiSettings,
    api_key: Option<String>,
) -> Result<AiSettings, String> {
    ai::save_settings(&app, settings, api_key)
}

/// Stream a completion. Progress arrives as `ai:delta` / `ai:done` /
/// `ai:error` events tagged with `requestId`.
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    request_id: String,
    messages: Vec<ChatMessage>,
    registry: State<'_, AiRegistry>,
) -> Result<(), String> {
    ai::chat(&app, &registry, request_id, messages).await
}

/// Stop a streaming completion. Returns false if it had already finished.
#[tauri::command]
pub async fn ai_cancel(
    request_id: String,
    registry: State<'_, AiRegistry>,
) -> Result<bool, String> {
    Ok(registry.cancel(&request_id).await)
}
