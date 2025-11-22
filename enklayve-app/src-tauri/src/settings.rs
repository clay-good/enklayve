use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Application settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    // General settings
    pub theme: String,
    pub language: String,

    // Model settings
    pub default_model: Option<String>,
    pub temperature: f32,
    pub max_tokens: i32,
    pub top_p: f32,
    pub top_k: i32,

    // Security settings
    pub encryption_enabled: bool,
    pub biometric_enabled: bool,
    pub auto_lock_minutes: Option<i32>,

    // RAG settings
    pub chunk_size: i32,
    pub chunk_overlap: i32,
    pub retrieval_count: i32,

    // UI settings
    pub streaming_enabled: bool,
    pub show_citations: bool,
    pub auto_save_conversations: bool,

    // Privacy settings
    pub telemetry_enabled: bool,
    pub crash_reporting_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            // General
            theme: "dark".to_string(),
            language: "en".to_string(),

            // Model - Default to Llama 3.1 8B for best balance of speed and quality
            default_model: Some("Llama 3.1 8B Instruct (Q4)".to_string()),
            temperature: 0.7,
            max_tokens: 512,
            top_p: 0.9,
            top_k: 40,

            // Security
            encryption_enabled: false,
            biometric_enabled: false,
            auto_lock_minutes: Some(30),

            // RAG
            chunk_size: 500,
            chunk_overlap: 50,
            retrieval_count: 5,

            // UI
            streaming_enabled: true,
            show_citations: true,
            auto_save_conversations: true,

            // Privacy
            telemetry_enabled: false,
            crash_reporting_enabled: false,
        }
    }
}

/// Initialize settings table
pub fn init_settings_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

/// Get a setting value
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;

    let result = stmt
        .query_row([key], |row| row.get(0))
        .optional()?;

    Ok(result)
}

/// Set a setting value
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )?;

    Ok(())
}

/// Delete a setting
pub fn delete_setting(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;

    Ok(())
}

/// Load all settings
pub fn load_settings(conn: &Connection) -> Result<AppSettings> {
    let mut settings = AppSettings::default();

    // General
    if let Some(theme) = get_setting(conn, "theme")? {
        settings.theme = theme;
    }
    if let Some(language) = get_setting(conn, "language")? {
        settings.language = language;
    }

    // Model
    settings.default_model = get_setting(conn, "default_model")?;
    if let Some(temp) = get_setting(conn, "temperature")? {
        settings.temperature = temp.parse().unwrap_or(0.7);
    }
    if let Some(max_tok) = get_setting(conn, "max_tokens")? {
        settings.max_tokens = max_tok.parse().unwrap_or(512);
    }
    if let Some(top_p) = get_setting(conn, "top_p")? {
        settings.top_p = top_p.parse().unwrap_or(0.9);
    }
    if let Some(top_k) = get_setting(conn, "top_k")? {
        settings.top_k = top_k.parse().unwrap_or(40);
    }

    // Security
    if let Some(enc) = get_setting(conn, "encryption_enabled")? {
        settings.encryption_enabled = enc == "true";
    }
    if let Some(bio) = get_setting(conn, "biometric_enabled")? {
        settings.biometric_enabled = bio == "true";
    }
    if let Some(lock) = get_setting(conn, "auto_lock_minutes")? {
        settings.auto_lock_minutes = lock.parse().ok();
    }

    // RAG
    if let Some(chunk) = get_setting(conn, "chunk_size")? {
        settings.chunk_size = chunk.parse().unwrap_or(500);
    }
    if let Some(overlap) = get_setting(conn, "chunk_overlap")? {
        settings.chunk_overlap = overlap.parse().unwrap_or(50);
    }
    if let Some(retrieval) = get_setting(conn, "retrieval_count")? {
        settings.retrieval_count = retrieval.parse().unwrap_or(5);
    }

    // UI
    if let Some(stream) = get_setting(conn, "streaming_enabled")? {
        settings.streaming_enabled = stream == "true";
    }
    if let Some(cite) = get_setting(conn, "show_citations")? {
        settings.show_citations = cite == "true";
    }
    if let Some(auto_save) = get_setting(conn, "auto_save_conversations")? {
        settings.auto_save_conversations = auto_save == "true";
    }

    // Privacy
    if let Some(telemetry) = get_setting(conn, "telemetry_enabled")? {
        settings.telemetry_enabled = telemetry == "true";
    }
    if let Some(crash) = get_setting(conn, "crash_reporting_enabled")? {
        settings.crash_reporting_enabled = crash == "true";
    }

    Ok(settings)
}

/// Save all settings
pub fn save_settings(conn: &Connection, settings: &AppSettings) -> Result<()> {
    // General
    set_setting(conn, "theme", &settings.theme)?;
    set_setting(conn, "language", &settings.language)?;

    // Model
    if let Some(model) = &settings.default_model {
        set_setting(conn, "default_model", model)?;
    }
    set_setting(conn, "temperature", &settings.temperature.to_string())?;
    set_setting(conn, "max_tokens", &settings.max_tokens.to_string())?;
    set_setting(conn, "top_p", &settings.top_p.to_string())?;
    set_setting(conn, "top_k", &settings.top_k.to_string())?;

    // Security
    set_setting(conn, "encryption_enabled", if settings.encryption_enabled { "true" } else { "false" })?;
    set_setting(conn, "biometric_enabled", if settings.biometric_enabled { "true" } else { "false" })?;
    if let Some(minutes) = settings.auto_lock_minutes {
        set_setting(conn, "auto_lock_minutes", &minutes.to_string())?;
    }

    // RAG
    set_setting(conn, "chunk_size", &settings.chunk_size.to_string())?;
    set_setting(conn, "chunk_overlap", &settings.chunk_overlap.to_string())?;
    set_setting(conn, "retrieval_count", &settings.retrieval_count.to_string())?;

    // UI
    set_setting(conn, "streaming_enabled", if settings.streaming_enabled { "true" } else { "false" })?;
    set_setting(conn, "show_citations", if settings.show_citations { "true" } else { "false" })?;
    set_setting(conn, "auto_save_conversations", if settings.auto_save_conversations { "true" } else { "false" })?;

    // Privacy
    set_setting(conn, "telemetry_enabled", if settings.telemetry_enabled { "true" } else { "false" })?;
    set_setting(conn, "crash_reporting_enabled", if settings.crash_reporting_enabled { "true" } else { "false" })?;

    Ok(())
}

/// Reset settings to defaults
pub fn reset_settings(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM settings", [])?;

    let defaults = AppSettings::default();
    save_settings(conn, &defaults)?;

    Ok(())
}

/// Export settings to JSON
pub fn export_settings_json(settings: &AppSettings) -> Result<String> {
    Ok(serde_json::to_string_pretty(settings)?)
}

/// Import settings from JSON
pub fn import_settings_json(json: &str) -> Result<AppSettings> {
    Ok(serde_json::from_str(json)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Result<Connection> {
        let conn = Connection::open_in_memory()?;
        init_settings_table(&conn)?;
        Ok(conn)
    }

    #[test]
    fn test_get_set_setting() {
        let conn = create_test_db().unwrap();

        set_setting(&conn, "test_key", "test_value").unwrap();
        let value = get_setting(&conn, "test_key").unwrap();

        assert_eq!(value, Some("test_value".to_string()));
    }

    #[test]
    fn test_save_load_settings() {
        let conn = create_test_db().unwrap();

        let mut settings = AppSettings::default();
        settings.theme = "light".to_string();
        settings.temperature = 0.8;
        settings.encryption_enabled = true;

        save_settings(&conn, &settings).unwrap();
        let loaded = load_settings(&conn).unwrap();

        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.temperature, 0.8);
        assert_eq!(loaded.encryption_enabled, true);
    }

    #[test]
    fn test_reset_settings() {
        let conn = create_test_db().unwrap();

        let mut settings = AppSettings::default();
        settings.theme = "custom".to_string();
        save_settings(&conn, &settings).unwrap();

        reset_settings(&conn).unwrap();
        let loaded = load_settings(&conn).unwrap();

        assert_eq!(loaded.theme, "dark"); // Default
    }

    #[test]
    fn test_export_import_json() {
        let settings = AppSettings::default();

        let json = export_settings_json(&settings).unwrap();
        let imported = import_settings_json(&json).unwrap();

        assert_eq!(settings.theme, imported.theme);
        assert_eq!(settings.temperature, imported.temperature);
    }
}
