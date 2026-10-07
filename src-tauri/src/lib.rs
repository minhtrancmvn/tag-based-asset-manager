mod backend;
mod manifest;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(backend::BackendState::load(data_dir.join("settings.json"))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend::library_state,
            backend::choose_library,
            backend::activate_library,
            backend::remove_library,
            backend::scan_library,
            backend::cancel_scan,
            backend::delete_assets,
            backend::preview_asset,
            backend::edit_tags,
            backend::bulk_edit_tags,
            backend::upsert_saved_search,
            backend::delete_saved_search,
            backend::asset_action,
            backend::validate_metadata,
            backend::reconnect_targets,
            backend::reconnect_asset,
            backend::export_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the asset manager");
}
