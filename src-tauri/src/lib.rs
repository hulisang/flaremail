mod commands;
mod db;
mod email;
mod graph_api;
mod proxy;
mod token_cache;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let pool = db::init_db(&handle)
                    .await
                    .expect("Failed to initialize database");
                handle.manage(db::AppState { db: pool });
            });
            Ok(())
        })
        // 注册后端命令
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::add_email,
            commands::get_emails,
            commands::delete_email,
            commands::import_emails,
            commands::check_outlook_email,
            commands::batch_check_outlook_emails,
            commands::get_mail_records,
            commands::get_attachments,
            commands::get_attachment_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
