use anyhow::Result;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use chrono::Local;

static LOG_FILE: Mutex<Option<File>> = Mutex::new(None);

/// Initialize the logging system
pub fn init_logger(app_handle: &AppHandle) -> Result<()> {
    let log_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data directory: {}", e))?
        .join("logs");

    std::fs::create_dir_all(&log_dir)?;

    let log_file_path = log_dir.join(format!("enklayve_{}.log", Local::now().format("%Y%m%d_%H%M%S")));

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)?;

    // Handle mutex poisoning gracefully
    match LOG_FILE.lock() {
        Ok(mut file_lock) => *file_lock = Some(file),
        Err(poisoned) => {
            // Recover from poisoned mutex by clearing the poison
            let mut file_lock = poisoned.into_inner();
            *file_lock = Some(file);
        }
    }

    log_info(&format!("Logger initialized at: {}", log_file_path.display()));

    Ok(())
}

/// Log an info message
pub fn log_info(message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_message = format!("[{}] INFO: {}\n", timestamp, message);

    println!("{}", log_message.trim());

    if let Ok(mut file_lock) = LOG_FILE.lock() {
        if let Some(file) = file_lock.as_mut() {
            let _ = file.write_all(log_message.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Log an error message
pub fn log_error(message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_message = format!("[{}] ERROR: {}\n", timestamp, message);

    eprintln!("{}", log_message.trim());

    if let Ok(mut file_lock) = LOG_FILE.lock() {
        if let Some(file) = file_lock.as_mut() {
            let _ = file.write_all(log_message.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Log a warning message
pub fn log_warn(message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_message = format!("[{}] WARN: {}\n", timestamp, message);

    eprintln!("{}", log_message.trim());

    if let Ok(mut file_lock) = LOG_FILE.lock() {
        if let Some(file) = file_lock.as_mut() {
            let _ = file.write_all(log_message.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Log a debug message
pub fn log_debug(message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_message = format!("[{}] DEBUG: {}\n", timestamp, message);

    println!("{}", log_message.trim());

    if let Ok(mut file_lock) = LOG_FILE.lock() {
        if let Some(file) = file_lock.as_mut() {
            let _ = file.write_all(log_message.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Get the log file path
pub fn get_log_path(app_handle: &AppHandle) -> Result<PathBuf> {
    let log_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data directory: {}", e))?
        .join("logs");

    Ok(log_dir)
}
