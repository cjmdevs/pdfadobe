//! Home screen (backlog B2): page-1 thumbnails of recent files, and whether a recent file
//! can be reached right now.
//!
//! Thumbnails are pictures of client documents, so they live only in the user's Local
//! AppData (`thumbnails\<id>.jpg`, never Roaming, which a roaming profile copies to a
//! server). Ids are 32 hex characters made by the frontend; file names never carry the
//! PDF's name. The frontend deletes a thumbnail when its file leaves Recent Files, and
//! `thumbs_keep` sweeps anything left over at startup.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::fileio::atomic_write;

const MAX_THUMB_BYTES: usize = 512 * 1024;
/// A dead server can take 20+ s to fail; the Home screen shows "Offline" sooner.
const STATUS_TIMEOUT: Duration = Duration::from_millis(2500);

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails"))
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn file_of(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("bad thumbnail id".into());
    }
    Ok(dir.join(format!("{id}.jpg")))
}

pub fn put_in(dir: &Path, id: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_THUMB_BYTES || !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Err("a thumbnail must be a JPEG under 512 KB".into());
    }
    let file = file_of(dir, id)?;
    fs::create_dir_all(dir).map_err(|e| format!("could not create the thumbnail folder: {e}"))?;
    atomic_write(&file, bytes)
}

pub fn remove_in(dir: &Path, ids: &[String]) {
    for id in ids {
        if let Ok(f) = file_of(dir, id) {
            let _ = fs::remove_file(f);
        }
    }
}

/// Deletes every thumbnail whose id is not in `keep` (empty `keep` = clear all).
pub fn keep_in(dir: &Path, keep: &[String]) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let id = name.strip_suffix(".jpg").unwrap_or("");
        if !(valid_id(id) && keep.iter().any(|k| k == id)) {
            let _ = fs::remove_file(e.path());
        }
    }
}

#[tauri::command]
pub fn thumb_put(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-thumb")
        .ok_or("missing x-thumb header")?
        .to_str()
        .map_err(|_| "x-thumb header is not ASCII")?
        .to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    put_in(&dir(&app)?, &id, bytes)
}

#[tauri::command]
pub fn thumb_get(app: AppHandle, id: String) -> Result<Response, String> {
    let bytes = fs::read(file_of(&dir(&app)?, &id)?).map_err(|_| "no thumbnail")?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn thumbs_remove(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    remove_in(&dir(&app)?, &ids);
    Ok(())
}

#[tauri::command]
pub fn thumbs_keep(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    keep_in(&dir(&app)?, &ids);
    Ok(())
}

/// "ok", "missing" (the drive or share answers but the file is gone) or "offline" (the
/// share, mapped drive or removable drive cannot be reached, or did not answer in time).
pub fn status_of(path: &str) -> &'static str {
    match fs::metadata(path) {
        Ok(_) => "ok",
        Err(e) => {
            if crate::fileio::classify("open", &e).kind == "network" {
                return "offline";
            }
            if e.kind() != std::io::ErrorKind::NotFound {
                return "ok"; // locked or no access: opening it says why
            }
            match root_of(path) {
                Some(root) if fs::metadata(&root).is_err() => "offline",
                _ => "missing",
            }
        }
    }
}

/// `\\server\share\` for UNC paths, `X:\` for drive paths.
pub fn root_of(path: &str) -> Option<String> {
    let p = path.replace('/', "\\");
    if let Some(rest) = p.strip_prefix("\\\\") {
        let mut parts = rest.split('\\').filter(|s| !s.is_empty());
        let (server, share) = (parts.next()?, parts.next()?);
        return Some(format!("\\\\{server}\\{share}\\"));
    }
    let b = p.as_bytes();
    (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':').then(|| format!("{}\\", &p[..2]))
}

/// Each path is checked on its own thread so one dead server never holds up the rest.
#[tauri::command]
pub async fn path_status(paths: Vec<String>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let waits: Vec<_> = paths
            .into_iter()
            .map(|p| {
                let (tx, rx) = mpsc::channel();
                std::thread::spawn(move || {
                    let _ = tx.send(status_of(&p));
                });
                rx
            })
            .collect();
        let deadline = std::time::Instant::now() + STATUS_TIMEOUT;
        waits
            .into_iter()
            .map(|rx| {
                let left = deadline.saturating_duration_since(std::time::Instant::now());
                rx.recv_timeout(left).unwrap_or("offline").to_string()
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
    const A: &str = "0123456789abcdef0123456789abcdef";
    const B: &str = "fedcba9876543210fedcba9876543210";

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdfwb-thumbs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn ids_are_32_lowercase_hex_only() {
        assert!(valid_id(A));
        assert!(!valid_id("..\\..\\settings"));
        assert!(!valid_id(&A.to_uppercase()));
        assert!(!valid_id(&A[..31]));
    }

    #[test]
    fn puts_removes_and_sweeps() {
        let d = temp("store");
        assert!(put_in(&d, A, b"%PDF-1.7").is_err());
        assert!(put_in(&d, "../x", JPG).is_err());
        put_in(&d, A, JPG).unwrap();
        put_in(&d, B, JPG).unwrap();
        fs::write(d.join("stray.txt"), b"x").unwrap();
        assert_eq!(fs::read(d.join(format!("{A}.jpg"))).unwrap(), JPG);
        remove_in(&d, &[A.into(), "../../x".into()]);
        assert!(!d.join(format!("{A}.jpg")).exists());
        put_in(&d, A, JPG).unwrap();
        keep_in(&d, &[B.into()]);
        let left: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from(format!("{B}.jpg"))]);
        keep_in(&d, &[]);
        assert_eq!(fs::read_dir(&d).unwrap().count(), 0);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn finds_share_and_drive_roots() {
        assert_eq!(
            root_of(r"\\srv\share\a\b.pdf").as_deref(),
            Some(r"\\srv\share\")
        );
        assert_eq!(
            root_of("//srv/share/b.pdf").as_deref(),
            Some(r"\\srv\share\")
        );
        assert_eq!(root_of(r"C:\a\b.pdf").as_deref(), Some(r"C:\"));
        assert_eq!(root_of(r"\\srv"), None);
        assert_eq!(root_of("relative.pdf"), None);
    }

    #[test]
    fn status_tells_missing_from_offline() {
        let d = temp("status");
        fs::create_dir_all(&d).unwrap();
        let f = d.join("a.pdf");
        fs::write(&f, b"%PDF").unwrap();
        assert_eq!(status_of(f.to_str().unwrap()), "ok");
        assert_eq!(status_of(d.join("gone.pdf").to_str().unwrap()), "missing");
        #[cfg(windows)]
        {
            // A share that does not exist on this PC answers ERROR_BAD_NET_NAME.
            assert_eq!(
                status_of(r"\\localhost\pdfwb-no-such-share\a.pdf"),
                "offline"
            );
            // A drive letter with nothing behind it.
            let free = ('D'..='Z')
                .rev()
                .find(|c| fs::metadata(format!("{c}:\\")).is_err());
            if let Some(c) = free {
                assert_eq!(status_of(&format!("{c}:\\x\\a.pdf")), "offline");
            }
        }
        fs::remove_dir_all(d).unwrap();
    }
}
