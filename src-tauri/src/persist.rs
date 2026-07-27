// ── Connection persistence ────────────────────────────────────────────────
// Saved connections are split across two stores:
//   • metadata (host/port/db/user/ssl/…) → JSON file in the app config dir
//   • password                           → OS keychain via the `keyring` crate
// This keeps secrets out of plaintext on disk while the non-sensitive shape
// stays easy to inspect and back up.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db::Engine;

/// Keychain service name; entries are keyed by connection id (the account).
const KEYCHAIN_SERVICE: &str = "com.zeru.sql";
/// Metadata file name inside the app config directory.
const STORE_FILE: &str = "connections.json";

/// Persisted connection metadata. Never contains the password — that lives in
/// the OS keychain and is fetched on demand via [`password`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
}

/// Resolve the metadata file path, creating the config directory if needed.
fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STORE_FILE))
}

/// Load all saved connection metadata (empty when nothing has been saved yet).
pub fn load(app: &AppHandle) -> Result<Vec<SavedConnection>, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Overwrite the metadata file with `list`.
fn write(app: &AppHandle, list: &[SavedConnection]) -> Result<(), String> {
    let path = store_path(app)?;
    let raw = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

/// A keychain handle for a given connection id.
fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, id).map_err(|e| e.to_string())
}

/// Insert or update a connection's metadata, and optionally its password. A
/// `Some("")` password clears any stored secret; `None` leaves it untouched.
pub fn upsert(
    app: &AppHandle,
    conn: SavedConnection,
    password: Option<String>,
) -> Result<(), String> {
    let mut list = load(app)?;
    match list.iter_mut().find(|c| c.id == conn.id) {
        Some(slot) => *slot = conn.clone(),
        None => list.push(conn.clone()),
    }
    write(app, &list)?;

    if let Some(pw) = password {
        let e = entry(&conn.id)?;
        if pw.is_empty() {
            // Ignore "no such entry" — clearing an absent password is a no-op.
            let _ = e.delete_credential();
        } else {
            e.set_password(&pw).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Fetch a connection's stored password, if one exists.
pub fn password(id: &str) -> Result<Option<String>, String> {
    match entry(id)?.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove a connection's metadata and its keychain password.
pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut list = load(app)?;
    list.retain(|c| c.id != id);
    write(app, &list)?;

    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
