use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub is_first_run: bool,
    pub onboarding_completed: bool,
    pub recommended_model_downloaded: bool,
    pub first_launch_timestamp: i64,
    pub completion_timestamp: Option<i64>,
}

impl Default for OnboardingState {
    fn default() -> Self {
        OnboardingState {
            is_first_run: true,
            onboarding_completed: false,
            recommended_model_downloaded: false,
            first_launch_timestamp: chrono::Utc::now().timestamp(),
            completion_timestamp: None,
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
            completion_timestamp INTEGER
        )",
        [],
    )?;

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
        "SELECT is_first_run, onboarding_completed, recommended_model_downloaded, first_launch_timestamp, completion_timestamp
         FROM onboarding WHERE id = 1",
        [],
        |row| {
            Ok(OnboardingState {
                is_first_run: row.get::<_, i64>(0)? == 1,
                onboarding_completed: row.get::<_, i64>(1)? == 1,
                recommended_model_downloaded: row.get::<_, i64>(2)? == 1,
                first_launch_timestamp: row.get(3)?,
                completion_timestamp: row.get(4)?,
            })
        },
    )?;

    Ok(state)
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
