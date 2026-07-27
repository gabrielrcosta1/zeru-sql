// ── Query history persistence ─────────────────────────────────────────────
// Executed queries are kept in a JSON file in the app config directory so the
// history survives a restart. Unlike connections there is no secret involved,
// so nothing goes to the keychain.
//
// The list is held in memory behind a mutex and written through on every
// mutation. Keeping it in state (rather than re-reading the file per command)
// makes read-modify-write atomic: two queries finishing at the same instant
// cannot clobber each other's entry.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

const STORE_FILE: &str = "history.json";

/// How many non-favourite entries to keep. Favourites are never pruned — the
/// user explicitly marked them, so age should not evict them.
const MAX_ENTRIES: usize = 500;

/// One executed query. Mirrors `HistoryEntry` in types.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub sql: String,
    pub connection_id: String,
    /// ISO-8601 timestamp, produced by the frontend.
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<i64>,
    /// "ok" | "error"
    pub status: String,
    /// "editor" | "ai"
    pub source: String,
    #[serde(default)]
    pub favorite: bool,
}

/// In-memory history, loaded from disk on first use. Held in Tauri state.
#[derive(Default)]
pub struct HistoryStore {
    entries: Mutex<Option<Vec<HistoryEntry>>>,
}

impl HistoryStore {
    /// Newest first.
    pub async fn load(&self, app: &AppHandle) -> Result<Vec<HistoryEntry>, String> {
        let mut guard = self.entries.lock().await;
        let list = ensure_loaded(&mut guard, app)?;
        Ok(list.clone())
    }

    /// Prepend an entry, prune, and write through.
    pub async fn push(&self, app: &AppHandle, entry: HistoryEntry) -> Result<(), String> {
        let mut guard = self.entries.lock().await;
        let list = ensure_loaded(&mut guard, app)?;
        list.insert(0, entry);
        prune(list);
        write(app, list)
    }

    /// Flip an entry's favourite flag. Returns the new value, or `None` when
    /// the id is unknown (the entry may have been pruned).
    pub async fn set_favorite(
        &self,
        app: &AppHandle,
        id: &str,
        favorite: bool,
    ) -> Result<Option<bool>, String> {
        let mut guard = self.entries.lock().await;
        let list = ensure_loaded(&mut guard, app)?;
        let Some(entry) = list.iter_mut().find(|e| e.id == id) else {
            return Ok(None);
        };
        entry.favorite = favorite;
        // Un-favouriting can push the entry past the retention cut.
        prune(list);
        write(app, list)?;
        Ok(Some(favorite))
    }

    /// Drop everything, including favourites — this is an explicit user action.
    pub async fn clear(&self, app: &AppHandle) -> Result<(), String> {
        let mut guard = self.entries.lock().await;
        let list = ensure_loaded(&mut guard, app)?;
        list.clear();
        write(app, list)
    }
}

/// Borrow the cached list, reading the file on first access.
fn ensure_loaded<'a>(
    guard: &'a mut Option<Vec<HistoryEntry>>,
    app: &AppHandle,
) -> Result<&'a mut Vec<HistoryEntry>, String> {
    if guard.is_none() {
        *guard = Some(read(app)?);
    }
    Ok(guard.as_mut().expect("just populated"))
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STORE_FILE))
}

fn read(app: &AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    // A corrupt file should not brick the app: start over rather than refusing
    // to load. The history is a convenience, not data the user authored.
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write(app: &AppHandle, list: &[HistoryEntry]) -> Result<(), String> {
    let path = store_path(app)?;
    let raw = serde_json::to_string(list).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

/// Keep every favourite plus the newest `MAX_ENTRIES` ordinary entries,
/// preserving the newest-first order of the list.
fn prune(list: &mut Vec<HistoryEntry>) {
    let mut kept = 0usize;
    list.retain(|e| {
        if e.favorite {
            return true;
        }
        kept += 1;
        kept <= MAX_ENTRIES
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, favorite: bool) -> HistoryEntry {
        HistoryEntry {
            id: id.to_string(),
            sql: "SELECT 1".into(),
            connection_id: "c1".into(),
            at: "2026-01-01T00:00:00Z".into(),
            duration_ms: Some(1),
            rows: Some(1),
            status: "ok".into(),
            source: "editor".into(),
            favorite,
        }
    }

    #[test]
    fn prune_keeps_newest_and_all_favorites() {
        let mut list: Vec<HistoryEntry> = (0..MAX_ENTRIES + 10)
            .map(|i| entry(&format!("n{i}"), false))
            .collect();
        // One favourite sitting past the retention cut.
        list.push(entry("fav", true));

        prune(&mut list);

        assert_eq!(list.len(), MAX_ENTRIES + 1);
        assert!(list.iter().any(|e| e.id == "fav"));
        assert_eq!(list[0].id, "n0", "newest entry must survive");
        assert!(
            !list.iter().any(|e| e.id == format!("n{}", MAX_ENTRIES)),
            "entries past the cut must be dropped"
        );
    }

    #[test]
    fn prune_is_a_noop_below_the_cap() {
        let mut list: Vec<HistoryEntry> = (0..3).map(|i| entry(&format!("n{i}"), false)).collect();
        prune(&mut list);
        assert_eq!(list.len(), 3);
    }
}
