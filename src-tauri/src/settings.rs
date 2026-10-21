//! App settings (theme, last zoom, open tabs, recent files) as one JSON document in the
//! per-user config folder. The frontend owns the schema; Rust only stores it atomically.
//! Window size/position is handled separately by tauri-plugin-window-state.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::fileio::atomic_write;

const FILE_NAME: &str = "settings.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(FILE_NAME))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Value {
    settings_path(&app).map(|p| load(&p)).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, value: Value) -> Result<(), String> {
    store(&settings_path(&app)?, &value)
}

/// Missing or unreadable settings fall back to defaults (Null) rather than failing startup.
pub fn load(path: &Path) -> Value {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

pub fn store(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("could not create settings folder: {e}"))?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    atomic_write(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_and_tolerates_garbage() {
        let d = std::env::temp_dir().join(format!("pdfwb-settings-{}", std::process::id()));
        let p = d.join("nested").join(FILE_NAME);
        assert_eq!(load(&p), Value::Null);
        let v = json!({ "theme": "dark", "recent": [r"\\server\share\a.pdf"] });
        store(&p, &v).unwrap();
        assert_eq!(load(&p), v);
        fs::write(&p, b"{ not json").unwrap();
        assert_eq!(load(&p), Value::Null);
        fs::remove_dir_all(d).unwrap();
    }
}
