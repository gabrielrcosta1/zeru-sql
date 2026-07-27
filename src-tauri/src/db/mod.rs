// ── Zeru database layer ───────────────────────────────────────────────────
// Owns the connection pools and the config shapes shared with the frontend.
// Introspection and query execution live in sibling modules (added in later
// phases) and reuse the `DbPool` handles kept by `ConnectionManager`.

use std::collections::HashMap;

pub mod introspect;
pub mod query;

use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::{MySqlPool, PgPool, Row};
use tokio::sync::Mutex;

/// Engines the backend can currently talk to. Mirrors the frontend `Engine`
/// union; MariaDB speaks the MySQL protocol so it maps onto the MySQL driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
    Sqlserver,
}

impl Engine {
    fn default_port(self) -> u16 {
        match self {
            Engine::Postgres => 5432,
            Engine::Mysql | Engine::Mariadb => 3306,
            Engine::Sqlite | Engine::Sqlserver => 0,
        }
    }
}

/// Connection parameters sent from the UI at connect time. The password lives
/// only here (in-flight) and is never stored on the frontend `Connection` type.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub engine: Engine,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub ssl: Option<bool>,
    // Reserved for SQLite support (later phase); accepted but unused for now.
    #[allow(dead_code)]
    #[serde(default)]
    pub file_path: Option<String>,
}

/// Summary returned after a successful `connect`, surfaced in the UI status bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub engine: Engine,
    pub database: Option<String>,
    pub server_version: String,
}

/// A live pool, tagged by engine so callers can branch on driver-specific SQL.
#[derive(Clone)]
pub enum DbPool {
    Postgres(PgPool),
    MySql(MySqlPool),
}

impl DbPool {
    /// Whether this pool speaks the MySQL dialect. Callers use it to pick
    /// dialect-specific parsing rules (comment markers, string escapes).
    pub fn is_mysql(&self) -> bool {
        matches!(self, DbPool::MySql(_))
    }
}

/// Registry of open pools keyed by connection id, kept in Tauri managed state.
#[derive(Default)]
pub struct ConnectionManager {
    pools: Mutex<HashMap<String, DbPool>>,
}

impl ConnectionManager {
    /// Fetch a clone of the pool for `id`, if the connection is open.
    pub async fn get(&self, id: &str) -> Option<DbPool> {
        self.pools.lock().await.get(id).cloned()
    }

    async fn insert(&self, id: String, pool: DbPool) {
        self.pools.lock().await.insert(id, pool);
    }

    async fn remove(&self, id: &str) -> bool {
        self.pools.lock().await.remove(id).is_some()
    }

    /// Open (or replace) a pool for the given config and probe its server
    /// version. Returns connection metadata on success.
    pub async fn connect(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        let pool = build_pool(cfg).await?;
        let server_version = probe_version(&pool).await?;
        let info = ConnectionInfo {
            id: cfg.id.clone(),
            engine: cfg.engine,
            database: cfg.database.clone(),
            server_version,
        };
        self.insert(cfg.id.clone(), pool).await;
        Ok(info)
    }

    /// Close and drop the pool for `id`. Returns whether one existed.
    pub async fn disconnect(&self, id: &str) -> bool {
        self.remove(id).await
    }
}

/// Build a pool for the config without registering it — used by both `connect`
/// and `test_connection` (the latter drops the pool immediately).
pub async fn build_pool(cfg: &ConnectionConfig) -> Result<DbPool, String> {
    match cfg.engine {
        Engine::Postgres => {
            let mut opts = PgConnectOptions::new()
                .host(cfg.host.as_deref().unwrap_or("localhost"))
                .port(cfg.port.unwrap_or_else(|| cfg.engine.default_port()))
                .ssl_mode(if cfg.ssl.unwrap_or(false) {
                    PgSslMode::Require
                } else {
                    PgSslMode::Prefer
                });
            if let Some(user) = &cfg.username {
                opts = opts.username(user);
            }
            if let Some(pass) = &cfg.password {
                opts = opts.password(pass);
            }
            if let Some(db) = &cfg.database {
                opts = opts.database(db);
            }
            let pool = PgPoolOptions::new()
                .max_connections(5)
                .connect_with(opts)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DbPool::Postgres(pool))
        }
        Engine::Mysql | Engine::Mariadb => {
            let mut opts = MySqlConnectOptions::new()
                .host(cfg.host.as_deref().unwrap_or("localhost"))
                .port(cfg.port.unwrap_or_else(|| cfg.engine.default_port()))
                .ssl_mode(if cfg.ssl.unwrap_or(false) {
                    MySqlSslMode::Required
                } else {
                    MySqlSslMode::Preferred
                });
            if let Some(user) = &cfg.username {
                opts = opts.username(user);
            }
            if let Some(pass) = &cfg.password {
                opts = opts.password(pass);
            }
            if let Some(db) = &cfg.database {
                opts = opts.database(db);
            }
            let pool = MySqlPoolOptions::new()
                .max_connections(5)
                .connect_with(opts)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DbPool::MySql(pool))
        }
        Engine::Sqlite | Engine::Sqlserver => {
            Err("Engine ainda não suportada nesta fase (foco: Postgres e MySQL).".into())
        }
    }
}

/// Read the server version string via a lightweight query.
async fn probe_version(pool: &DbPool) -> Result<String, String> {
    match pool {
        DbPool::Postgres(p) => sqlx::query("SELECT version()")
            .fetch_one(p)
            .await
            .and_then(|row| row.try_get::<String, _>(0))
            .map_err(|e| e.to_string()),
        DbPool::MySql(p) => sqlx::query("SELECT version()")
            .fetch_one(p)
            .await
            .and_then(|row| row.try_get::<String, _>(0))
            .map_err(|e| e.to_string()),
    }
}
