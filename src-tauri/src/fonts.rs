//! Font files for Edit PDF (backlog B3): lists the Windows fonts folder, the user's
//! fonts folder and the firm font share, and reads font bytes for the engine
//! (`src/engine/edit/fonts`), which describes and caches the faces itself.
//!
//! The firm share is mirrored into the config folder (`font-cache\firm\`) whenever it
//! can be reached, and the mirror is what gets listed: firm fonts keep working when the
//! share is offline, and a font file locked on the share never blocks an edit.
//! Only font files inside these folders can be read. Font contents never reach a log.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

use crate::settings;

/// Larger files are not fonts anyone edits with (and would only slow the index).
const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;
/// Subfolders followed on the firm share.
const MAX_DEPTH: usize = 3;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FontFile {
    pub path: String,
    /// "firm", "user" or "windows".
    pub source: &'static str,
    pub size: u64,
    /// Last modified, ms since epoch.
    pub mtime: f64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FontListing {
    pub files: Vec<FontFile>,
    /// "none" (no firm folder set), "online" (mirror refreshed), "offline" (mirror used).
    pub firm: &'static str,
}

fn is_font(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "ttf" | "otf" | "ttc"))
}

/// Font files under `dir` (to `depth` levels of subfolders). Missing folders give [].
pub fn list_dir(dir: &Path, source: &'static str, depth: usize) -> Vec<FontFile> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            if depth > 0 {
                out.extend(list_dir(&p, source, depth - 1));
            }
        } else if is_font(&p) && meta.len() <= MAX_FONT_BYTES {
            out.push(FontFile {
                path: p.to_string_lossy().into_owned(),
                source,
                size: meta.len(),
                mtime: mtime_ms(&meta),
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Copies the share's font files into `mirror` (same relative paths), replacing copies
/// whose size or time differ and removing copies no longer on the share. Err when the
/// share can't be read at all (offline): the mirror is then left as it was.
pub fn refresh_mirror(share: &Path, mirror: &Path) -> Result<(), String> {
    fs::read_dir(share).map_err(|e| format!("firm font folder unavailable: {e}"))?;
    let on_share = list_dir(share, "firm", MAX_DEPTH);
    let mut keep = Vec::new();
    for f in &on_share {
        let src = Path::new(&f.path);
        let Ok(rel) = src.strip_prefix(share) else {
            continue;
        };
        let dst = mirror.join(rel);
        keep.push(dst.clone());
        let same = fs::metadata(&dst)
            .map(|m| m.len() == f.size && mtime_ms(&m) >= f.mtime)
            .unwrap_or(false);
        if same {
            continue;
        }
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent);
        }
        // A file locked or removed meanwhile keeps its old copy (if any) this time.
        let _ = fs::copy(src, &dst);
    }
    for old in list_dir(mirror, "firm", MAX_DEPTH) {
        let p = PathBuf::from(&old.path);
        if !keep.contains(&p) {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

/// True when `path` is a font file inside one of `roots` (no `..` escapes).
pub fn allowed(path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(real) = fs::canonicalize(path) else {
        return false;
    };
    is_font(&real)
        && roots
            .iter()
            .filter_map(|r| fs::canonicalize(r).ok())
            .any(|r| real.starts_with(r))
}

fn windows_dir() -> PathBuf {
    std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("Fonts")
}

fn user_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(r"Microsoft\Windows\Fonts"))
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

fn mirror_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("font-cache").join("firm"))
}

/// Lists every font: firm (mirrored), user, Windows. `firm` is the share path from
/// settings (`firmFontsPath`), or None.
#[tauri::command]
pub fn fonts_list(app: AppHandle, firm: Option<String>) -> Result<FontListing, String> {
    let mirror = mirror_dir(&app)?;
    let status = match firm.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => "none",
        Some(share) => match refresh_mirror(Path::new(share), &mirror) {
            Ok(()) => "online",
            Err(_) => "offline",
        },
    };
    let mut files = if status == "none" {
        Vec::new()
    } else {
        list_dir(&mirror, "firm", MAX_DEPTH)
    };
    if let Some(user) = user_dir() {
        files.extend(list_dir(&user, "user", 0));
    }
    files.extend(list_dir(&windows_dir(), "windows", 0));
    Ok(FontListing {
        files,
        firm: status,
    })
}

/// Bytes of a listed font file.
#[tauri::command]
pub fn font_read(app: AppHandle, path: String) -> Result<Response, String> {
    let mut roots = vec![windows_dir(), mirror_dir(&app)?];
    roots.extend(user_dir());
    let p = PathBuf::from(&path);
    if !allowed(&p, &roots) {
        return Err("not a font file in a font folder".into());
    }
    let bytes = fs::read(&p).map_err(|e| format!("could not read the font: {e}"))?;
    Ok(Response::new(bytes))
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("font-cache").join("index.json"))
}

/// The engine's font index cache (JSON it owns), or null.
#[tauri::command]
pub fn font_index_load(app: AppHandle) -> Value {
    index_path(&app)
        .map(|p| settings::load(&p))
        .unwrap_or(Value::Null)
}

#[tauri::command]
pub fn font_index_save(app: AppHandle, value: Value) -> Result<(), String> {
    settings::store(&index_path(&app)?, &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdfwb-fonts-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn lists_font_files_only_with_subfolders_to_a_depth() {
        let d = temp("list");
        fs::write(d.join("A.ttf"), b"font").unwrap();
        fs::write(d.join("notes.txt"), b"no").unwrap();
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("sub").join("B.OTF"), b"font").unwrap();
        let names = |v: Vec<FontFile>| {
            v.into_iter()
                .map(|f| {
                    Path::new(&f.path)
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(names(list_dir(&d, "firm", 0)), ["A.ttf"]);
        assert_eq!(names(list_dir(&d, "firm", 1)), ["A.ttf", "B.OTF"]);
        assert!(list_dir(&d.join("missing"), "firm", 1).is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn mirror_follows_the_share_and_survives_it_going_offline() {
        let share = temp("share");
        let mirror = temp("mirror");
        fs::write(share.join("Firm.ttf"), b"v1").unwrap();
        fs::create_dir_all(share.join("sub")).unwrap();
        fs::write(share.join("sub").join("Other.ttf"), b"x").unwrap();
        refresh_mirror(&share, &mirror).unwrap();
        assert_eq!(fs::read(mirror.join("Firm.ttf")).unwrap(), b"v1");
        assert!(mirror.join("sub").join("Other.ttf").exists());

        // Changed and removed on the share.
        fs::write(share.join("Firm.ttf"), b"version 2").unwrap();
        fs::remove_file(share.join("sub").join("Other.ttf")).unwrap();
        refresh_mirror(&share, &mirror).unwrap();
        assert_eq!(fs::read(mirror.join("Firm.ttf")).unwrap(), b"version 2");
        assert!(!mirror.join("sub").join("Other.ttf").exists());

        // Offline: an error, and the mirror stays usable.
        let gone = share.join("no-such-share");
        assert!(refresh_mirror(&gone, &mirror).is_err());
        assert_eq!(list_dir(&mirror, "firm", MAX_DEPTH).len(), 1);
        let _ = fs::remove_dir_all(&share);
        let _ = fs::remove_dir_all(&mirror);
    }

    #[test]
    fn reads_only_fonts_inside_the_font_folders() {
        let root = temp("roots");
        let fonts = root.join("fonts");
        fs::create_dir_all(&fonts).unwrap();
        fs::write(fonts.join("A.ttf"), b"font").unwrap();
        fs::write(fonts.join("secret.txt"), b"no").unwrap();
        fs::write(root.join("Outside.ttf"), b"font").unwrap();
        let roots = vec![fonts.clone()];
        assert!(allowed(&fonts.join("A.ttf"), &roots));
        assert!(!allowed(&fonts.join("secret.txt"), &roots));
        assert!(!allowed(&root.join("Outside.ttf"), &roots));
        assert!(!allowed(&fonts.join("..").join("Outside.ttf"), &roots));
        let _ = fs::remove_dir_all(&root);
    }
}
