//! File IO for the frontend. Phase 0 spike scope: read a PDF, Save As to a new path.
//!
//! - Rust std transparently handles Windows long paths and UNC shares (`\\server\share`).
//! - Writes go to a sibling temp file, are fsynced, then renamed over the target, so a
//!   crash never leaves a half-written PDF.
//! - Never logs document contents.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};

/// Read a whole file. Binary is returned as a raw IPC body (ArrayBuffer in JS).
#[tauri::command]
pub fn read_pdf(path: String) -> Result<Response, String> {
    let bytes = fs::read(&path).map_err(|e| io_message("open", &e))?;
    Ok(Response::new(bytes))
}

/// Save As. Body = raw PDF bytes. Headers: `x-target` and `x-source`, both
/// percent-encoded UTF-8 (headers must be ASCII; Windows paths are not).
#[tauri::command]
pub fn save_pdf_as(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw PDF bytes".into());
    };
    let target = header_path(&request, "x-target")?;
    let source = header_path(&request, "x-source").ok();
    write_new_copy(&target, source.as_deref(), bytes)
}

fn header_path(request: &Request<'_>, name: &str) -> Result<PathBuf, String> {
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
    if let Some(src) = source {
        if same_file(src, target) {
            return Err("Save As target is the original file; choose a new name".into());
        }
    }
    let dir = target.parent().ok_or("target has no parent directory")?;
    let name = target.file_name().ok_or("target has no file name")?;
    let tmp = dir.join(format!(".{}.{}.tmp", name.to_string_lossy(), std::process::id()));

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

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn io_message(action: &str, e: &std::io::Error) -> String {
    // Windows ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33): file open in another program.
    match e.raw_os_error() {
        Some(32) | Some(33) if cfg!(windows) => {
            format!("could not {action}: the file is open in another program")
        }
        _ => format!("could not {action}: {e}"),
    }
}

fn percent_decode(s: &str) -> Result<String, String> {
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
    fn refuses_to_overwrite_source() {
        let d = tmpdir("src");
        let src = d.join("orig.pdf");
        fs::write(&src, b"original").unwrap();
        assert!(write_new_copy(&src, Some(&src), b"changed").is_err());
        assert_eq!(fs::read(&src).unwrap(), b"original");
        fs::remove_dir_all(d).unwrap();
    }
}
