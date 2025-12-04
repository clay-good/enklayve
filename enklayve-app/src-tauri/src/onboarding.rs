use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub is_first_run: bool,
    pub onboarding_completed: bool,
    pub recommended_model_downloaded: bool,
    pub first_launch_timestamp: i64,
    pub completion_timestamp: Option<i64>,
    // Security settings
    pub security_enabled: bool,
    pub password_hash: Option<String>,
    pub encryption_salt: Option<String>, // Base64 encoded salt for encryption key derivation
    pub biometric_enabled: bool,
}

/// Security configuration returned to frontend (without sensitive data)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub security_enabled: bool,
    pub biometric_enabled: bool,
    pub biometric_available: bool,
}

impl Default for OnboardingState {
    fn default() -> Self {
        OnboardingState {
            is_first_run: true,
            onboarding_completed: false,
            recommended_model_downloaded: false,
            first_launch_timestamp: chrono::Utc::now().timestamp(),
            completion_timestamp: None,
            security_enabled: false,
            password_hash: None,
            encryption_salt: None,
            biometric_enabled: false,
        }
    }
}

pub fn init_onboarding_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS onboarding (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_first_run INTEGER NOT NULL DEFAULT 1,
            onboarding_completed INTEGER NOT NULL DEFAULT 0,
            recommended_model_downloaded INTEGER NOT NULL DEFAULT 0,
            first_launch_timestamp INTEGER NOT NULL,
            completion_timestamp INTEGER,
            security_enabled INTEGER NOT NULL DEFAULT 0,
            password_hash TEXT,
            encryption_salt TEXT,
            biometric_enabled INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Migrate existing tables - add security columns if they don't exist
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(onboarding)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if !columns.contains(&"security_enabled".to_string()) {
        conn.execute("ALTER TABLE onboarding ADD COLUMN security_enabled INTEGER NOT NULL DEFAULT 0", [])?;
    }
    if !columns.contains(&"password_hash".to_string()) {
        conn.execute("ALTER TABLE onboarding ADD COLUMN password_hash TEXT", [])?;
    }
    if !columns.contains(&"encryption_salt".to_string()) {
        conn.execute("ALTER TABLE onboarding ADD COLUMN encryption_salt TEXT", [])?;
    }
    if !columns.contains(&"biometric_enabled".to_string()) {
        conn.execute("ALTER TABLE onboarding ADD COLUMN biometric_enabled INTEGER NOT NULL DEFAULT 0", [])?;
    }

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM onboarding", [], |row| row.get(0))?;

    if count == 0 {
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO onboarding (id, is_first_run, onboarding_completed, recommended_model_downloaded, first_launch_timestamp)
             VALUES (1, 1, 0, 0, ?1)",
            [now],
        )?;
    }

    Ok(())
}

pub fn get_onboarding_state(app_handle: &AppHandle) -> Result<OnboardingState> {
    let conn = crate::database::get_connection(app_handle)?;

    init_onboarding_table(&conn)?;

    let state = conn.query_row(
        "SELECT is_first_run, onboarding_completed, recommended_model_downloaded, first_launch_timestamp, completion_timestamp,
                security_enabled, password_hash, encryption_salt, biometric_enabled
         FROM onboarding WHERE id = 1",
        [],
        |row| {
            Ok(OnboardingState {
                is_first_run: row.get::<_, i64>(0)? == 1,
                onboarding_completed: row.get::<_, i64>(1)? == 1,
                recommended_model_downloaded: row.get::<_, i64>(2)? == 1,
                first_launch_timestamp: row.get(3)?,
                completion_timestamp: row.get(4)?,
                security_enabled: row.get::<_, i64>(5)? == 1,
                password_hash: row.get(6)?,
                encryption_salt: row.get(7)?,
                biometric_enabled: row.get::<_, i64>(8)? == 1,
            })
        },
    )?;

    Ok(state)
}

/// Get security config (safe to expose to frontend - no password hash)
pub fn get_security_config(app_handle: &AppHandle) -> Result<SecurityConfig> {
    let state = get_onboarding_state(app_handle)?;
    let biometric_available = crate::biometric::is_biometric_available()
        .map(|cap| cap.available)
        .unwrap_or(false);

    Ok(SecurityConfig {
        security_enabled: state.security_enabled,
        biometric_enabled: state.biometric_enabled,
        biometric_available,
    })
}

/// Setup security with password (called during onboarding or settings)
pub fn setup_security(
    app_handle: &AppHandle,
    password: &str,
    enable_biometric: bool,
) -> Result<()> {
    let conn = crate::database::get_connection(app_handle)?;

    // Generate salt for encryption key derivation
    let salt = crate::encryption::EncryptionKey::generate_salt();
    let salt_base64 = BASE64.encode(salt);

    // Hash password for verification
    let password_hash = crate::encryption::hash_password(password)?;

    conn.execute(
        "UPDATE onboarding SET security_enabled = 1, password_hash = ?1, encryption_salt = ?2, biometric_enabled = ?3 WHERE id = 1",
        rusqlite::params![password_hash, salt_base64, if enable_biometric { 1 } else { 0 }],
    )?;

    // If biometric is enabled, store password in secure storage for biometric unlock
    if enable_biometric {
        // Store the password encrypted in keychain - biometric will unlock it
        crate::biometric::store_secure("enklayve_master_password", password.as_bytes())?;
    }

    // Also store encryption salt in secure storage for database encryption
    crate::biometric::store_secure("db_encryption_salt", &salt)?;

    // Initialize encryption support and encrypt existing data
    crate::encrypted_database::initialize_encryption_support(&conn)?;

    // Create encryption key from password
    let key = crate::encryption::EncryptionKey::from_password(password, &salt)?;

    // Encrypt existing conversation data
    let encrypted_count = crate::encrypted_database::migrate_to_encrypted(&conn, &key)?;
    crate::logger::log_info(&format!("Encrypted {} conversation messages", encrypted_count));

    crate::logger::log_info("Security setup completed with database encryption");
    Ok(())
}

/// Verify password for unlock
pub fn verify_unlock_password(app_handle: &AppHandle, password: &str) -> Result<bool> {
    let state = get_onboarding_state(app_handle)?;

    match state.password_hash {
        Some(hash) => crate::encryption::verify_password(password, &hash),
        None => Ok(false),
    }
}

/// Get encryption key from password (used for database encryption)
pub fn get_encryption_key(app_handle: &AppHandle, password: &str) -> Result<crate::encryption::EncryptionKey> {
    let state = get_onboarding_state(app_handle)?;

    let salt_base64 = state.encryption_salt
        .ok_or_else(|| anyhow::anyhow!("No encryption salt configured"))?;

    let salt_bytes = BASE64.decode(&salt_base64)
        .map_err(|e| anyhow::anyhow!("Invalid salt encoding: {}", e))?;

    let salt: [u8; 16] = salt_bytes.try_into()
        .map_err(|_| anyhow::anyhow!("Invalid salt length"))?;

    crate::encryption::EncryptionKey::from_password(password, &salt)
}

/// Disable security (requires current password)
pub fn disable_security(app_handle: &AppHandle, current_password: &str) -> Result<()> {
    // Verify current password first
    if !verify_unlock_password(app_handle, current_password)? {
        anyhow::bail!("Invalid password");
    }

    let conn = crate::database::get_connection(app_handle)?;

    // Decrypt database before disabling security
    let state = get_onboarding_state(app_handle)?;
    if let Some(salt_base64) = &state.encryption_salt {
        let salt_bytes = BASE64.decode(salt_base64)
            .map_err(|e| anyhow::anyhow!("Invalid salt encoding: {}", e))?;

        if salt_bytes.len() >= 16 {
            let salt: [u8; 16] = salt_bytes[..16].try_into()
                .map_err(|_| anyhow::anyhow!("Invalid salt length"))?;

            let key = crate::encryption::EncryptionKey::from_password(current_password, &salt)?;

            // Decrypt all encrypted data
            let decrypted_count = crate::encrypted_database::migrate_to_unencrypted(&conn, &key)?;
            crate::logger::log_info(&format!("Decrypted {} conversation messages", decrypted_count));
        }
    }

    conn.execute(
        "UPDATE onboarding SET security_enabled = 0, password_hash = NULL, encryption_salt = NULL, biometric_enabled = 0 WHERE id = 1",
        [],
    )?;

    crate::logger::log_info("Security disabled and data decrypted");
    Ok(())
}

/// Change password (requires current password)
pub fn change_password(
    app_handle: &AppHandle,
    current_password: &str,
    new_password: &str,
) -> Result<()> {
    // Verify current password first
    if !verify_unlock_password(app_handle, current_password)? {
        anyhow::bail!("Invalid current password");
    }

    let conn = crate::database::get_connection(app_handle)?;

    // Generate new salt
    let salt = crate::encryption::EncryptionKey::generate_salt();
    let salt_base64 = BASE64.encode(salt);

    // Hash new password
    let password_hash = crate::encryption::hash_password(new_password)?;

    conn.execute(
        "UPDATE onboarding SET password_hash = ?1, encryption_salt = ?2 WHERE id = 1",
        rusqlite::params![password_hash, salt_base64],
    )?;

    // Update biometric storage if enabled
    let state = get_onboarding_state(app_handle)?;
    if state.biometric_enabled {
        crate::biometric::store_secure("enklayve_master_password", new_password.as_bytes())?;
    }

    crate::logger::log_info("Password changed successfully");
    Ok(())
}

/// Toggle biometric authentication (requires current password to enable)
pub fn toggle_biometric(
    app_handle: &AppHandle,
    current_password: &str,
    enable: bool,
) -> Result<()> {
    // Verify current password first
    if !verify_unlock_password(app_handle, current_password)? {
        anyhow::bail!("Invalid password");
    }

    let conn = crate::database::get_connection(app_handle)?;

    if enable {
        // Store password in keychain for biometric unlock
        crate::biometric::store_secure("enklayve_master_password", current_password.as_bytes())?;
        crate::logger::log_info("Biometric authentication enabled");
    } else {
        // We don't need to remove from keychain - just disable the flag
        crate::logger::log_info("Biometric authentication disabled");
    }

    conn.execute(
        "UPDATE onboarding SET biometric_enabled = ?1 WHERE id = 1",
        rusqlite::params![if enable { 1 } else { 0 }],
    )?;

    Ok(())
}

pub fn mark_onboarding_completed(app_handle: &AppHandle) -> Result<()> {
    let conn = crate::database::get_connection(app_handle)?;
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "UPDATE onboarding SET onboarding_completed = 1, is_first_run = 0, completion_timestamp = ?1 WHERE id = 1",
        [now],
    )?;

    Ok(())
}

pub fn mark_model_downloaded(app_handle: &AppHandle) -> Result<()> {
    let conn = crate::database::get_connection(app_handle)?;

    conn.execute(
        "UPDATE onboarding SET recommended_model_downloaded = 1 WHERE id = 1",
        [],
    )?;

    Ok(())
}

pub fn reset_onboarding(app_handle: &AppHandle) -> Result<()> {
    let conn = crate::database::get_connection(app_handle)?;
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "UPDATE onboarding SET is_first_run = 1, onboarding_completed = 0, recommended_model_downloaded = 0, first_launch_timestamp = ?1, completion_timestamp = NULL WHERE id = 1",
        [now],
    )?;

    Ok(())
}
