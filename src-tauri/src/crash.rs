//! Local crash reports (Phase 10a). Rust panics and the frontend's uncaught errors
//! (`src/app/crash.ts`) are written as small text files to
//! `%LOCALAPPDATA%\com.cjmdevs.pdfworkbench\crashes\`. Nothing is ever sent anywhere.
//! The newest 20 reports are kept.
//!
//! A report holds no document text and no file names: a panic message is kept only after
//! quoted parts, paths and long numbers are cut (they could come from a file), and the
//! frontend scrubs its own reports before handing them over.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::fileio::FileError;

const KEEP: usize = 20;
const MAX_REPORT: usize = 64 * 1024;
const APP_ID: &str = "com.cjmdevs.pdfworkbench";

/// `%LOCALAPPDATA%\com.cjmdevs.pdfworkbench\crashes` (same root as the thumbnails).
/// Read from the environment so the panic hook works before Tauri has started.
pub fn crashes_dir() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join(APP_ID).join("crashes"))
}

/// Installs the panic hook. Runs before the process aborts (release builds use
/// panic = "abort"), so the report is on disk before the app is gone.
pub fn install_panic_hook() {
    let version = env!("CARGO_PKG_VERSION");
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let msg = payload
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(no message)".into());
        let place = info
            .location()
            .map(|l| format!("{}:{}:{}", file_name(l.file()), l.line(), l.column()))
            .unwrap_or_else(|| "?".into());
        let thread = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string();
        let text = format!(
            "PDF Workbench crash report\nTime: {}\nVersion: {version}\nWhere: rust panic \
             (thread {thread})\nLocation: {place}\nMessage: {}\n\nThis report holds no \
             document text or file names. It was not sent anywhere.\n",
            iso_now(),
            scrub(&msg)
        );
        if let Some(dir) = crashes_dir() {
            let _ = write_report(&dir, &text);
        }
        previous(info);
    }));
}

/// Source file name only (`src\fileio.rs` -> `fileio.rs`); cargo registry paths hold
/// the Windows user name.
fn file_name(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}

/// Cuts quoted parts, paths (to the end: a path may hold spaces) and runs of 3+ digits,
/// and limits the length.
pub fn scrub(msg: &str) -> String {
    let mut out = String::new();
    let mut quote: Option<char> = None;
    let chars: Vec<char> = msg.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
                out.push_str("[…]");
            }
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' || c == '`' {
            quote = Some(c);
            i += 1;
            continue;
        }
        let unc = c == '\\' && chars.get(i + 1) == Some(&'\\');
        let drive = c.is_ascii_alphabetic()
            && chars.get(i + 1) == Some(&':')
            && matches!(chars.get(i + 2), Some('\\') | Some('/'))
            && (i == 0 || !chars[i - 1].is_alphanumeric());
        if unc || drive {
            out.push_str("[path…]");
            break;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if i - start >= 3 {
                out.push_str("[n]");
            } else {
                out.extend(&chars[start..i]);
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    if quote.is_some() {
        out.push_str("[…]");
    }
    out.chars().take(300).collect()
}

/// Writes one report and keeps only the newest KEEP. Returns the file written.
pub fn write_report(dir: &Path, text: &str) -> std::io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let stamp = file_stamp();
    let mut path = dir.join(format!("crash-{stamp}.txt"));
    let mut n = 1;
    while path.exists() {
        n += 1;
        path = dir.join(format!("crash-{stamp}-{n}.txt"));
    }
    fs::write(&path, text)?;
    prune(dir, KEEP);
    Ok(path)
}

fn prune(dir: &Path, keep: usize) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, PathBuf)> = rd
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.starts_with("crash-") && n.ends_with(".txt")
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    for (_, p) in files.into_iter().skip(keep) {
        let _ = fs::remove_file(p);
    }
}

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian (H. Hinnant).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn parts() -> (i64, u32, u32, u64, u64, u64, u128) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let (y, m, d) = civil((secs / 86_400) as i64);
    let s = secs % 86_400;
    (
        y,
        m,
        d,
        s / 3600,
        (s / 60) % 60,
        s % 60,
        now.as_millis() % 1000,
    )
}

fn iso_now() -> String {
    let (y, m, d, h, mi, s, ms) = parts();
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}

fn file_stamp() -> String {
    let (y, m, d, h, mi, s, ms) = parts();
    format!("{y:04}{m:02}{d:02}-{h:02}{mi:02}{s:02}-{ms:03}")
}

/// A report from the frontend (already scrubbed by `src/app/crash.ts`).
#[tauri::command]
pub fn crash_write(text: String) -> Result<(), FileError> {
    if text.len() > MAX_REPORT || !text.starts_with("PDF Workbench crash report\n") {
        return Err(FileError::other("not a crash report"));
    }
    let dir = crashes_dir().ok_or_else(|| FileError::other("no local app data folder"))?;
    write_report(&dir, &text)
        .map(|_| ())
        .map_err(|e| FileError::other(format!("could not write the crash report: {e}")))
}

/// Opens the crash report folder in Explorer (Settings).
#[tauri::command]
pub fn crash_open_folder() -> Result<(), FileError> {
    let dir = crashes_dir().ok_or_else(|| FileError::other("no local app data folder"))?;
    fs::create_dir_all(&dir).map_err(|e| FileError::other(e.to_string()))?;
    std::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| FileError::other(format!("could not open the folder: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_cuts_quotes_paths_and_numbers() {
        let m = scrub(
            r#"called `unwrap()` on "Jane Taxpayer 123-45-6789" at C:\Users\jsmith\Clients\a b.pdf"#,
        );
        assert!(!m.contains("Jane"), "{m}");
        assert!(!m.contains("jsmith"), "{m}");
        assert!(m.starts_with("called […] on […] at [path…]"), "{m}");
        assert_eq!(scrub(r"\\server\share\x.pdf"), "[path…]");
        assert_eq!(
            scrub("index 12 out of range 34567"),
            "index 12 out of range [n]"
        );
        assert_eq!(scrub("open 'unterminated secret"), "open […]");
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_396), (2025, 11, 4));
        assert_eq!(civil(11_016), (2000, 2, 29));
    }

    #[test]
    fn keeps_newest_twenty() {
        let dir = std::env::temp_dir().join(format!("pdfwb-crash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for i in 0..25 {
            write_report(&dir, &format!("PDF Workbench crash report\n{i}")).unwrap();
        }
        let n = fs::read_dir(&dir).unwrap().count();
        assert_eq!(n, KEEP);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn frontend_reports_must_look_like_reports() {
        assert!(crash_write("hello".into()).is_err());
        assert!(
            crash_write(format!(
                "PDF Workbench crash report\n{}",
                "x".repeat(MAX_REPORT)
            ))
            .is_err()
        );
    }
}
