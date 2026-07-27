// Zeru backend entrypoint.
//
// Wires up the Tauri runtime, the connection manager state, and the database
// command handlers the frontend invokes.

mod ai;
mod commands;
mod db;
mod history;
mod persist;

use ai::AiRegistry;
use db::ConnectionManager;
use history::HistoryStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Desktop only: the updater has no meaning on mobile targets, where the
        // store handles distribution.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ConnectionManager::default())
        .manage(HistoryStore::default())
        .manage(AiRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::list_databases,
            commands::get_database_tree,
            commands::run_query,
            commands::fetch_page,
            commands::save_connection,
            commands::load_connections,
            commands::load_password,
            commands::delete_connection,
            commands::load_history,
            commands::push_history,
            commands::set_history_favorite,
            commands::clear_history,
            commands::load_ai_settings,
            commands::save_ai_settings,
            commands::ai_chat,
            commands::ai_cancel,
            commands::export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zeru");
}
