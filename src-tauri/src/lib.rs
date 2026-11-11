mod app_updates;
mod backend;
mod manifest;
mod usage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Release builds only, so `pnpm tauri dev` can run beside an installed copy.
    // Must be the first plugin: a second launch focuses the running window and
    // exits before anything else starts.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_updates::UpdateState::default())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let backend = backend::BackendState::load(data_dir.join("settings.json"))?;
            let usage = usage::UsageState::for_app(backend.usage_stop_flag());
            let (consent, client_id) = backend.usage_settings();
            app.manage(backend);
            // A stored opt-in resumes sending and records `app_open`.
            usage.restore(consent, client_id);
            app.manage(usage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_updates::check_for_updates,
            app_updates::install_update,
            backend::library_state,
            backend::set_app_theme,
            backend::choose_library,
            backend::activate_library,
            backend::remove_library,
            backend::scan_library,
            backend::cancel_scan,
            backend::delete_assets,
            backend::preview_asset,
            backend::edit_tags,
            backend::edit_notes,
            backend::bulk_edit_tags,
            backend::upsert_saved_search,
            backend::delete_saved_search,
            backend::asset_action,
            backend::validate_metadata,
            backend::reconnect_targets,
            backend::reconnect_asset,
            backend::remove_missing_entry,
            backend::export_metadata,
            backend::preview_tag_rename,
            backend::apply_tag_rename,
            usage::track_usage,
            usage::set_usage_consent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the asset manager");
}
