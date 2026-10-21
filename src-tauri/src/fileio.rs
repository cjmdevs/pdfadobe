//! File IO for the frontend: read a PDF, Save As to a new path.
//!
//! - Rust std transparently handles Windows long paths and UNC shares (`\\server\share`).
//! - Errors are classified (`FileError::kind`) so the UI can say "locked by another
//!   program" or "network share unreachable" instead of a raw OS string.
//! - Writes go to a sibling temp file, are fsynced, then renamed over the target, so a
//!   crash never leaves a half-written PDF.
//! - Never logs document contents.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

/// Error returned to the frontend. `kind` drives the UI message; `message` is for detail.
/// Never contains document contents (only paths and OS error text).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct FileError {
    pub kind: &'static str,
    pub message: String,
}

impl FileError {
    pub fn other(message: impl Into<String>) -> Self {
        Self {
            kind: "other",
            message: message.into(),
        }
    }
}

impl From<&str> for FileError {
    fn from(message: &str) -> Self {
        Self::other(message)
    }
}

impl From<String> for FileError {
    fn from(message: String) -> Self {
        Self::other(message)
    }
}

/// Read a whole file. Binary is returned as a raw IPC body (ArrayBuffer in JS).
/// Async so a slow network share never blocks the main thread.
#[tauri::command]
pub async fn read_pdf(path: String) -> Result<Response, FileError> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        return Err(FileError {
            kind: "isDirectory",
            message: "that path is a folder".into(),
        });
    }
    let bytes = fs::read(&p).map_err(|e| classify("open", &e))?;
    Ok(Response::new(bytes))
}

/// Maps an OS error to a stable `kind` for the UI.
pub fn classify(action: &str, e: &std::io::Error) -> FileError {
    use std::io::ErrorKind;
    let kind = match (e.raw_os_error(), e.kind()) {
        // ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33): open in another program.
        (Some(32 | 33), _) if cfg!(windows) => "locked",
        // ERROR_BAD_NETPATH (53), ERROR_NETNAME_DELETED (64), ERROR_BAD_NET_NAME (67),
        // ERROR_NETWORK_UNREACHABLE (1231), ERROR_HOST_UNREACHABLE (1232).
        (Some(53 | 64 | 67 | 1231 | 1232), _) if cfg!(windows) => "network",
        (_, ErrorKind::NotFound) => "notFound",
        (_, ErrorKind::PermissionDenied) => "accessDenied",
        _ => "other",
    };
    FileError {
        kind,
        message: io_message(action, e),
    }
}

/// Save As. Body = raw PDF bytes. Headers: `x-target` and `x-source`, both
/// percent-encoded UTF-8 (headers must be ASCII; Windows paths are not).
#[tauri::command]
pub fn save_pdf_as(request: Request<'_>) -> Result<(), FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw PDF bytes".into());
    };
    let target = header_path(&request, "x-target")?;
    let source = header_path(&request, "x-source").ok();
    Ok(write_new_copy(&target, source.as_deref(), bytes)?)
}

pub fn header_path(request: &Request<'_>, name: &str) -> Result<PathBuf, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing {name} header"))?
        .to_str()
        .map_err(|_| format!("{name} header is not ASCII"))?;
    Ok(PathBuf::from(percent_decode(raw)?))
}

/// Writes `bytes` to `target` atomically. Refuses to write over `source`
/// (CLAUDE.md: never overwrite an original).
pub fn write_new_copy(target: &Path, source: Option<&Path>, bytes: &[u8]) -> Result<(), String> {
    if source.is_some_and(|src| same_file(src, target)) {
        return Err("Save As target is the original file; choose a new name".into());
    }
    atomic_write(target, bytes)
}

/// Sibling temp file in the target's folder (same volume, so the rename is atomic).
pub fn temp_sibling(target: &Path) -> Result<PathBuf, String> {
    let dir = target.parent().ok_or("target has no parent directory")?;
    let name = target.file_name().ok_or("target has no file name")?;
    Ok(dir.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id()
    )))
}

/// Write to a sibling temp file, fsync, then rename over `target`.
pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_sibling(target)?;
    let result = (|| {
        let mut f = File::create(&tmp).map_err(|e| io_message("create temp file", &e))?;
        f.write_all(bytes).map_err(|e| io_message("write", &e))?;
        f.sync_all().map_err(|e| io_message("flush", &e))?;
        drop(f);
        fs::rename(&tmp, target).map_err(|e| io_message("replace target", &e))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

pub fn io_message(action: &str, e: &std::io::Error) -> String {
    // Windows ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33): file open in another program.
    match e.raw_os_error() {
        Some(32) | Some(33) if cfg!(windows) => {
            format!("could not {action}: the file is open in another program")
        }
        _ => format!("could not {action}: {e}"),
    }
}

pub fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3).ok_or("bad percent-encoding")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "bad percent-encoding")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "path is not UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdfwb-test-{tag}-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn decodes_utf8_paths() {
        assert_eq!(
            percent_decode("C%3A%5CClients%5C%C3%A9t%C3%A9.pdf").unwrap(),
            "C:\\Clients\\été.pdf"
        );
        assert!(percent_decode("%zz").is_err());
    }

    #[test]
    fn writes_new_file_and_leaves_no_temp() {
        let d = tmpdir("write");
        let target = d.join("out.pdf");
        write_new_copy(&target, None, b"%PDF-1.7 test").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-1.7 test");
        let leftovers = fs::read_dir(&d).unwrap().count();
        assert_eq!(leftovers, 1);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn classifies_missing_files() {
        let e = fs::read("/definitely/not/here.pdf").unwrap_err();
        assert_eq!(classify("open", &e).kind, "notFound");
    }

    #[test]
    fn read_pdf_reports_missing_and_directory() {
        let d = tmpdir("read");
        let dir_err = tauri::async_runtime::block_on(read_pdf(d.to_string_lossy().into()));
        assert_eq!(dir_err.err().unwrap().kind, "isDirectory");
        let missing = d.join("nope.pdf");
        let err = tauri::async_runtime::block_on(read_pdf(missing.to_string_lossy().into()));
        assert_eq!(err.err().unwrap().kind, "notFound");
        fs::remove_dir_all(d).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn classifies_locked_file_on_windows() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = tmpdir("lock");
        let p = d.join("locked.pdf");
        fs::write(&p, b"%PDF-1.7").unwrap();
        // share_mode(0): exclusive, like a program that locks the file.
        let _hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&p)
            .unwrap();
        let err = tauri::async_runtime::block_on(read_pdf(p.to_string_lossy().into()));
        assert_eq!(err.err().unwrap().kind, "locked");
    }

    #[test]
    fn refuses_to_overwrite_source() {
        let d = tmpdir("src");
        let src = d.join("orig.pdf");
        fs::write(&src, b"original").unwrap();
        assert!(write_new_copy(&src, Some(&src), b"changed").is_err());
        assert_eq!(fs::read(&src).unwrap(), b"original");
        fs::remove_dir_all(d).unwrap();
    }
}
