// Core modules
mod logger;
mod database;
mod documents;
mod models;
mod inference;
mod downloads;
mod embeddings;
mod vector_search;
mod hardware;
mod encryption;
mod biometric;
mod encrypted_database;
mod conversations;
mod settings;
mod model_cache;
mod ocr;

// Tauri commands
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize model cache
    let model_cache = model_cache::ModelCache::new();

    tauri::Builder::default()
        .manage(model_cache)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::upload_document,
            commands::list_documents,
            commands::delete_document,
            commands::get_models,
            commands::list_downloaded_models,
            commands::get_download_info,
            commands::download_model,
            commands::delete_model,
            commands::query_documents,
            commands::query_documents_streaming,
            commands::detect_hardware,
            commands::get_model_recommendations,
            commands::hash_password,
            commands::verify_password,
            commands::encrypt_data,
            commands::decrypt_data,
            commands::check_biometric_available,
            commands::authenticate_biometric,
            commands::store_secure_data,
            commands::retrieve_secure_data,
            commands::get_encryption_stats,
            commands::enable_database_encryption,
            commands::disable_database_encryption,
            commands::create_conversation,
            commands::list_conversations,
            commands::get_conversation,
            commands::get_conversation_messages,
            commands::add_message,
            commands::delete_conversation,
            commands::delete_message,
            commands::update_conversation_title,
            commands::search_conversations,
            commands::export_conversation_markdown,
            commands::export_conversation_json,
            commands::export_conversation_text,
            commands::get_settings,
            commands::save_settings,
            commands::reset_settings,
            commands::export_settings,
            commands::import_settings,
            commands::log_from_frontend,
            commands::get_log_path,
        ])
        .setup(|app| {
            // Initialize logger first
            let app_handle = app.handle().clone();
            if let Err(e) = logger::init_logger(&app_handle) {
                eprintln!("Failed to initialize logger: {}", e);
            }
            logger::log_info("Enklayve application starting...");

            // Initialize database on startup
            let app_handle_db = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                logger::log_info("Initializing database...");
                if let Err(e) = database::init_database(&app_handle_db).await {
                    logger::log_error(&format!("Failed to initialize database: {}", e));
                    eprintln!("Failed to initialize database: {}", e);
                } else {
                    logger::log_info("Database initialized successfully");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
