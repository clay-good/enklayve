use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Initialize the SQLite database with required tables
pub async fn init_database(app_handle: &AppHandle) -> Result<()> {
    let db_path = get_database_path(app_handle)?;

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&db_path)?;

    // Create documents table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT NOT NULL,
            upload_date INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL
        )",
        [],
    )?;

    // Create chunks table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            page_number INTEGER,
            embedding BLOB,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create index for faster chunk lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_document
         ON chunks(document_id)",
        [],
    )?;

    // Create models table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS downloaded_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_name TEXT NOT NULL UNIQUE,
            file_path TEXT NOT NULL,
            download_date INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            checksum TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Initialize conversation tables
    crate::conversations::init_conversation_tables(&conn)?;

    // Initialize settings table
    crate::settings::init_settings_table(&conn)?;

    // Initialize encryption database support
    crate::encrypted_database::initialize_encryption_support(&conn)?;

    println!("Database initialized at: {}", db_path.display());

    Ok(())
}

/// Get the path to the database file
pub fn get_database_path(app_handle: &AppHandle) -> Result<PathBuf> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data directory: {}", e))?;

    Ok(app_data_dir.join("enklayve.db"))
}

/// Get a database connection
pub fn get_connection(app_handle: &AppHandle) -> Result<Connection> {
    let db_path = get_database_path(app_handle)?;
    Ok(Connection::open(db_path)?)
}
