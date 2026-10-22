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

/// Save over the opened file. Body = raw PDF bytes, header `x-target`.
/// CLAUDE.md: write a temp file, keep the previous version as `<name>.bak`, then
/// atomically replace. The `.bak` stays until the file next opens successfully
/// (`discard_backup`).
#[tauri::command]
pub fn save_pdf(request: Request<'_>) -> Result<(), FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw PDF bytes".into());
    };
    let target = header_path(&request, "x-target")?;
    save_with_backup(&target, bytes)
}

pub fn backup_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    target.with_file_name(name)
}

pub fn save_with_backup(target: &Path, bytes: &[u8]) -> Result<(), FileError> {
    let tmp = temp_sibling(target)?;
    let result = (|| {
        let mut f = File::create(&tmp).map_err(|e| classify("create a temp file", &e))?;
        f.write_all(bytes).map_err(|e| classify("write", &e))?;
        f.sync_all().map_err(|e| classify("flush", &e))?;
        drop(f);
        if target.exists() {
            fs::copy(target, backup_path(target)).map_err(|e| classify("keep a backup", &e))?;
        }
        fs::rename(&tmp, target).map_err(|e| classify("replace the file", &e))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Writes a new file into a folder (Split, Extract to folder). Body = raw bytes, headers
/// `x-folder` and `x-name`. Never overwrites: "a.pdf" becomes "a (2).pdf" if taken.
#[tauri::command]
pub fn write_new_file(request: Request<'_>) -> Result<String, FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let folder = header_path(&request, "x-folder")?;
    let name = header_path(&request, "x-name")?;
    let name = name.to_string_lossy().into_owned();
    Ok(write_unique(&folder, &name, bytes)?
        .to_string_lossy()
        .into_owned())
}

pub fn write_unique(folder: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, FileError> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return Err(FileError::other(format!("invalid file name: {name}")));
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    for k in 1..10_000 {
        let candidate = if k == 1 {
            folder.join(name)
        } else {
            folder.join(format!("{stem} ({k}){ext}"))
        };
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate);
        match file {
            Ok(mut f) => {
                let written = f.write_all(bytes).and_then(|_| f.sync_all());
                if let Err(e) = written {
                    drop(f);
                    let _ = fs::remove_file(&candidate);
                    return Err(classify("write", &e));
                }
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(classify("create the file", &e)),
        }
    }
    Err("too many files with that name".into())
}

/// Deletes `<path>.bak` after the saved file opened fine. Missing backups are not an error.
#[tauri::command]
pub fn discard_backup(path: String) -> Result<(), FileError> {
    match fs::remove_file(backup_path(Path::new(&path))) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(classify("remove the backup", &e))
        }
        _ => Ok(()),
    }
}

/// Files in a folder that Combine Files accepts (PDF and images), in natural name order.
/// Not recursive.
#[tauri::command]
pub async fn list_folder(path: String) -> Result<Vec<String>, FileError> {
    let dir = PathBuf::from(&path);
    let mut out: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| classify("open the folder", &e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_combinable(p))
        .collect();
    out.sort_by(|a, b| natural_cmp(&file_name(a), &file_name(b)));
    Ok(out
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
}

pub fn is_combinable(p: &Path) -> bool {
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "pdf" | "jpg" | "jpeg" | "png" | "tif" | "tiff"
    )
}

/// "Page 2" before "Page 10": digit runs compare as numbers.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (m, n) = (take(&mut x), take(&mut y));
                let (m, n) = (m.trim_start_matches('0'), n.trim_start_matches('0'));
                let ord = m.len().cmp(&n.len()).then_with(|| m.cmp(n));
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            (Some(c), Some(d)) => {
                if c != d {
                    return c.cmp(&d);
                }
                x.next();
                y.next();
            }
        }
    }
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
    fn save_keeps_a_backup_and_replaces_atomically() {
        let d = tmpdir("save");
        let target = d.join("Return 2025.pdf");
        fs::write(&target, b"version 1").unwrap();
        save_with_backup(&target, b"version 2").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"version 2");
        assert_eq!(fs::read(backup_path(&target)).unwrap(), b"version 1");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 2, "no temp file left");
        discard_backup(target.to_string_lossy().into()).unwrap();
        assert!(!backup_path(&target).exists());
        discard_backup(target.to_string_lossy().into()).unwrap(); // already gone: fine
        fs::remove_dir_all(d).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn save_reports_a_locked_target_and_keeps_it() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = tmpdir("savelock");
        let target = d.join("open-in-acrobat.pdf");
        fs::write(&target, b"original").unwrap();
        let _hold = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        let err = save_with_backup(&target, b"new").unwrap_err();
        assert_eq!(err.kind, "locked");
        drop(_hold);
        assert_eq!(fs::read(&target).unwrap(), b"original");
        let names: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(names.iter().all(|n| !n.to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn write_new_file_never_overwrites() {
        let d = tmpdir("unique");
        let a = write_unique(&d, "Part 1.pdf", b"one").unwrap();
        let b = write_unique(&d, "Part 1.pdf", b"two").unwrap();
        assert_eq!(a.file_name().unwrap(), "Part 1.pdf");
        assert_eq!(b.file_name().unwrap(), "Part 1 (2).pdf");
        assert_eq!(fs::read(&a).unwrap(), b"one");
        assert!(write_unique(&d, "..\\evil.pdf", b"x").is_err());
        assert!(write_unique(&d, "C:evil.pdf", b"x").is_err());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn lists_combinable_files_in_natural_order() {
        let d = tmpdir("list");
        for n in ["Scan 10.pdf", "Scan 2.PDF", "notes.txt", "a.tif", "b.JPG"] {
            fs::write(d.join(n), b"x").unwrap();
        }
        fs::create_dir_all(d.join("sub.pdf")).unwrap();
        let got = tauri::async_runtime::block_on(list_folder(d.to_string_lossy().into())).unwrap();
        let names: Vec<_> = got.iter().map(|p| file_name(Path::new(p))).collect();
        assert_eq!(names, ["a.tif", "b.jpg", "scan 2.pdf", "scan 10.pdf"]);
        fs::remove_dir_all(d).unwrap();
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
