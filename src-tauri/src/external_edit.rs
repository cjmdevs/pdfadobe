//! "Edit Using" (Edit PDF, B3 stage 2): an image is handed to another Windows program
//! (Paint, the program the user picks, or the default one) as a temporary file; when
//! that program saves the file, the app reads it back and puts it in the PDF.
//!
//! The file sits in the user's temp folder (`%TEMP%\PDF Workbench\image-N.png`) and is
//! deleted when editing ends (the app asks) or when the app quits. A change counts once
//! the file's size and time stay the same between two checks, so a half-written file
//! is never read. No shell, no network; nothing about the image is logged.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::SystemTime;

use tauri::ipc::{InvokeBody, Request, Response};

use crate::fileio::{FileError, header_path};

struct Entry {
    path: PathBuf,
    /// Size and time last given back (or written).
    seen: (u64, Option<SystemTime>),
    /// A change seen once, waiting for the next check to confirm it settled.
    pending: Option<(u64, Option<SystemTime>)>,
}

static EDITS: Mutex<Option<HashMap<u32, Entry>>> = Mutex::new(None);
static NEXT: Mutex<u32> = Mutex::new(1);

fn folder() -> PathBuf {
    std::env::temp_dir().join("PDF Workbench")
}

fn stamp(path: &PathBuf) -> (u64, Option<SystemTime>) {
    fs::metadata(path)
        .map(|m| (m.len(), m.modified().ok()))
        .unwrap_or((0, None))
}

/// Writes the image (raw body) to a temp file and opens it. Headers: `x-ext` ("png" or
/// "jpg") and `x-app` ("paint", "choose" for the Open with dialog, or "default").
/// Returns the edit's id.
#[tauri::command]
pub fn external_edit_start(request: Request<'_>) -> Result<u32, FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(FileError::other("expected raw bytes"));
    };
    let ext = header_path(&request, "x-ext").map_err(FileError::other)?;
    let ext = ext.to_string_lossy().into_owned();
    if ext != "png" && ext != "jpg" {
        return Err(FileError::other("only PNG and JPEG images can be edited"));
    }
    let app = header_path(&request, "x-app").map_err(FileError::other)?;
    let app = app.to_string_lossy().into_owned();
    let id = {
        let mut n = NEXT.lock().map_err(|_| FileError::other("busy"))?;
        let id = *n;
        *n += 1;
        id
    };
    let dir = folder();
    fs::create_dir_all(&dir).map_err(|e| FileError::other(format!("no temp folder: {e}")))?;
    let path = dir.join(format!("image-{}-{id}.{ext}", std::process::id()));
    fs::write(&path, bytes).map_err(|e| FileError::other(format!("could not write: {e}")))?;
    let seen = stamp(&path);
    launch(&app, &path)?;
    EDITS
        .lock()
        .map_err(|_| FileError::other("busy"))?
        .get_or_insert_with(HashMap::new)
        .insert(
            id,
            Entry {
                path,
                seen,
                pending: None,
            },
        );
    Ok(id)
}

fn launch(app: &str, path: &PathBuf) -> Result<(), FileError> {
    let mut cmd = match app {
        "paint" => {
            let mut c = Command::new("mspaint.exe");
            c.arg(path);
            c
        }
        // Windows' own "Open with" dialog for the file.
        "choose" => {
            let mut c = Command::new("rundll32.exe");
            c.arg("shell32.dll,OpenAs_RunDLL").arg(path);
            c
        }
        "default" => {
            let mut c = Command::new("explorer.exe");
            c.arg(path);
            c
        }
        _ => return Err(FileError::other("unknown program")),
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| FileError::other(format!("could not start the program: {e}")))
}

/// The image once the other program saved it (and the file settled), else empty.
#[tauri::command]
pub fn external_edit_poll(id: u32) -> Result<Response, FileError> {
    poll(id).map(Response::new)
}

fn poll(id: u32) -> Result<Vec<u8>, FileError> {
    let mut guard = EDITS.lock().map_err(|_| FileError::other("busy"))?;
    let Some(e) = guard.as_mut().and_then(|m| m.get_mut(&id)) else {
        return Err(FileError::other("this edit has ended"));
    };
    let now = stamp(&e.path);
    if now == e.seen || now.1.is_none() {
        e.pending = None;
        return Ok(Vec::new());
    }
    if e.pending != Some(now) {
        e.pending = Some(now);
        return Ok(Vec::new());
    }
    // Locked by the other program while it writes: try again next time.
    let Ok(bytes) = fs::read(&e.path) else {
        return Ok(Vec::new());
    };
    e.seen = now;
    e.pending = None;
    Ok(bytes)
}

/// Stops watching and deletes the temp file.
#[tauri::command]
pub fn external_edit_end(id: u32) -> Result<(), FileError> {
    let mut guard = EDITS.lock().map_err(|_| FileError::other("busy"))?;
    if let Some(e) = guard.as_mut().and_then(|m| m.remove(&id)) {
        let _ = fs::remove_file(&e.path);
    }
    Ok(())
}

/// Deletes every temp file this run made (the app is quitting).
pub fn cleanup() {
    if let Ok(mut guard) = EDITS.lock() {
        if let Some(m) = guard.as_mut() {
            for (_, e) in m.drain() {
                let _ = fs::remove_file(&e.path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_counts_once_it_settles() {
        let dir = std::env::temp_dir().join(format!("pdfwb-extedit-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.png");
        fs::write(&path, b"one").unwrap();
        let id = 999_001;
        EDITS
            .lock()
            .unwrap()
            .get_or_insert_with(HashMap::new)
            .insert(
                id,
                Entry {
                    seen: stamp(&path),
                    path: path.clone(),
                    pending: None,
                },
            );
        let len = |b: Vec<u8>| b.len();
        let poll = |id| poll(id).unwrap();
        assert_eq!(len(poll(id)), 0);
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&path, b"changed").unwrap();
        // First sight of the change: wait for it to settle.
        assert_eq!(len(poll(id)), 0);
        assert_eq!(len(poll(id)), 7);
        // Given back once only.
        assert_eq!(len(poll(id)), 0);
        external_edit_end(id).unwrap();
        assert!(!path.exists());
        assert!(super::poll(id).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
