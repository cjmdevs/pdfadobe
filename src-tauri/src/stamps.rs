//! Custom stamp images (Phase 3): PNG/JPEG files the user added, kept per user in the
//! config folder (`stamps\<id>.png|jpg` + `stamps\index.json`). Built-in stamps are drawn
//! by the frontend and never stored here. Image contents never reach a log.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::fileio::{atomic_write, percent_decode};

/// Larger images make every stamped PDF large too.
pub const MAX_STAMP_BYTES: usize = 5 * 1024 * 1024;
const MAX_STAMPS: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StampInfo {
    pub id: String,
    pub name: String,
    /// "image/png" or "image/jpeg".
    pub mime: String,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("stamps"))
}

/// The image type from its first bytes; anything else is refused.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

/// Ids are made here (never taken from the caller as a path).
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn file_of(dir: &Path, s: &StampInfo) -> PathBuf {
    let ext = if s.mime == "image/png" { "png" } else { "jpg" };
    dir.join(format!("{}.{ext}", s.id))
}

pub fn list_in(dir: &Path) -> Vec<StampInfo> {
    fs::read(dir.join("index.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<StampInfo>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|s| valid_id(&s.id) && file_of(dir, s).is_file())
        .collect()
}

fn write_index(dir: &Path, list: &[StampInfo]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    atomic_write(&dir.join("index.json"), &bytes)
}

static SEQ: AtomicU32 = AtomicU32::new(0);

pub fn add_in(dir: &Path, name: &str, bytes: &[u8]) -> Result<StampInfo, String> {
    if bytes.len() > MAX_STAMP_BYTES {
        return Err("the image is larger than 5 MB".into());
    }
    let mime = sniff(bytes).ok_or("only PNG and JPEG images can be stamps")?;
    let mut list = list_in(dir);
    if list.len() >= MAX_STAMPS {
        return Err(format!("there are already {MAX_STAMPS} custom stamps"));
    }
    fs::create_dir_all(dir).map_err(|e| format!("could not create the stamps folder: {e}"))?;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let info = StampInfo {
        id: format!("{ms:x}-{:x}", SEQ.fetch_add(1, Ordering::Relaxed)),
        name: name.trim().chars().take(60).collect::<String>(),
        mime: mime.into(),
    };
    atomic_write(&file_of(dir, &info), bytes)?;
    list.push(info.clone());
    write_index(dir, &list)?;
    Ok(info)
}

pub fn remove_in(dir: &Path, id: &str) -> Result<(), String> {
    let mut list = list_in(dir);
    if let Some(i) = list.iter().position(|s| s.id == id) {
        let s = list.remove(i);
        let _ = fs::remove_file(file_of(dir, &s));
        write_index(dir, &list)?;
    }
    Ok(())
}

#[tauri::command]
pub fn stamps_list(app: AppHandle) -> Vec<StampInfo> {
    dir(&app).map(|d| list_in(&d)).unwrap_or_default()
}

#[tauri::command]
pub fn stamp_read(app: AppHandle, id: String) -> Result<Response, String> {
    let d = dir(&app)?;
    let s = list_in(&d)
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("this stamp no longer exists")?;
    let bytes = fs::read(file_of(&d, &s)).map_err(|e| format!("could not read the stamp: {e}"))?;
    Ok(Response::new(bytes))
}

#[derive(Deserialize)]
struct AddHeader {
    name: String,
}

/// Image bytes as the raw body, `{name}` as a percent-encoded JSON `x-stamp` header.
#[tauri::command]
pub fn stamp_add(app: AppHandle, request: Request<'_>) -> Result<StampInfo, String> {
    let raw = request
        .headers()
        .get("x-stamp")
        .ok_or("missing x-stamp header")?
        .to_str()
        .map_err(|_| "x-stamp header is not ASCII")?;
    let h: AddHeader = serde_json::from_str(&percent_decode(raw)?).map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    add_in(&dir(&app)?, &h.name, bytes)
}

#[tauri::command]
pub fn stamp_remove(app: AppHandle, id: String) -> Result<(), String> {
    remove_in(&dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n rest of a png";

    #[test]
    fn adds_lists_and_removes_images_only() {
        let d = std::env::temp_dir().join(format!("pdfwb-stamps-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        assert!(list_in(&d).is_empty());
        let a = add_in(&d, "  Tied to TB  ", PNG).unwrap();
        assert_eq!(a.name, "Tied to TB");
        assert_eq!(a.mime, "image/png");
        assert!(add_in(&d, "pdf", b"%PDF-1.7").is_err());
        assert!(add_in(&d, "big", &vec![0u8; MAX_STAMP_BYTES + 1]).is_err());
        assert_eq!(list_in(&d), vec![a.clone()]);
        assert_eq!(fs::read(file_of(&d, &a)).unwrap(), PNG);
        remove_in(&d, &a.id).unwrap();
        assert!(list_in(&d).is_empty());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn index_entries_with_unsafe_ids_are_ignored() {
        let d = std::env::temp_dir().join(format!("pdfwb-stamps-bad-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("index.json"),
            br#"[{"id":"..\\..\\x","name":"x","mime":"image/png"}]"#,
        )
        .unwrap();
        assert!(list_in(&d).is_empty());
        fs::remove_dir_all(d).unwrap();
    }
}
