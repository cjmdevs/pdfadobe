//! "Open in Acrobat" (Phase 6): XFA-only forms cannot be shown or filled here, so the
//! file is handed to Adobe Acrobat or Acrobat Reader. Our app may be the default PDF
//! program, so the file is not opened by association: Acrobat's own executable is found
//! (App Paths in the registry, then the standard install folders) and started with the
//! path as its only argument. No shell, no network.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::fileio::FileError;

/// Executables to try, best first: Acrobat (Pro, or the new 64-bit Reader), then Reader.
const APP_NAMES: [&str; 2] = ["Acrobat.exe", "AcroRd32.exe"];

const INSTALL_DIRS: [&str; 4] = [
    r"C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe",
    r"C:\Program Files (x86)\Adobe\Acrobat DC\Acrobat\Acrobat.exe",
    r"C:\Program Files\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe",
    r"C:\Program Files (x86)\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe",
];

#[tauri::command]
pub async fn open_in_acrobat(path: String) -> Result<(), FileError> {
    let file = Path::new(&path);
    if !file.is_file() {
        return Err(FileError::other("the file is not on disk; save it first"));
    }
    let exe = pick(candidates(), |p| p.is_file()).ok_or(FileError {
        kind: "acrobatMissing",
        message: "Adobe Acrobat or Acrobat Reader is not installed on this computer".into(),
    })?;
    Command::new(&exe)
        .arg(file)
        .spawn()
        .map(|_| ())
        .map_err(|e| FileError::other(format!("could not start Acrobat: {e}")))
}

/// Every place Acrobat may be, in the order to try.
fn candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = APP_NAMES.iter().filter_map(|n| app_path(n)).collect();
    out.extend(INSTALL_DIRS.iter().map(PathBuf::from));
    out
}

/// The first candidate that exists.
pub fn pick(candidates: Vec<PathBuf>, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    candidates.into_iter().find(|p| exists(p))
}

/// HKCU, then HKLM `...\App Paths\<name>` default value: where an installer says its
/// program is. Quotes around the value are removed.
#[cfg(windows)]
fn app_path(name: &str) -> Option<PathBuf> {
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW,
    };
    use windows::core::HSTRING;
    let key = HSTRING::from(format!(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}"
    ));
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let mut buf = [0u16; 1024];
        let mut size = (buf.len() * 2) as u32;
        // SAFETY: buf and size describe a valid writable buffer; the value name is null
        // (the key's default value).
        let ok = unsafe {
            RegGetValueW(
                root,
                &key,
                None,
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if ok.is_ok() {
            let len = (size as usize / 2).saturating_sub(1).min(buf.len());
            let s = String::from_utf16_lossy(&buf[..len]);
            let s = s.trim().trim_matches('"');
            if !s.is_empty() {
                return Some(PathBuf::from(s));
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn app_path(_name: &str) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_first_that_exists() {
        let list = vec![
            PathBuf::from("a.exe"),
            PathBuf::from("b.exe"),
            PathBuf::from("c.exe"),
        ];
        assert_eq!(
            pick(list.clone(), |p| p.ends_with("b.exe")
                || p.ends_with("c.exe")),
            Some(PathBuf::from("b.exe"))
        );
        assert_eq!(pick(list, |_| false), None);
    }

    #[test]
    fn acrobat_comes_before_reader() {
        let c = candidates();
        let acro = c.iter().position(|p| p.ends_with("Acrobat.exe"));
        let reader = c.iter().position(|p| p.ends_with("AcroRd32.exe"));
        assert!(acro.is_some() && reader.is_some());
        assert!(acro < reader);
    }

    #[test]
    fn refuses_a_file_that_is_not_on_disk() {
        let e = tauri::async_runtime::block_on(open_in_acrobat(r"Z:\no\such\file.pdf".into()))
            .unwrap_err();
        assert_eq!(e.kind, "other");
    }
}
