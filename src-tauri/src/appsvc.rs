//! Installed-app services (Phase 10a): version, "is PDF Workbench the default PDF
//! program", and opening Windows' Default apps page for it.
//!
//! Windows does not let an app make itself the default. The installer registers the app
//! (src-tauri/windows/hooks.nsh: Capabilities + RegisteredApplications under HKCU), and
//! the first-run setup opens Settings at PDF Workbench so the person picks it there.

use crate::fileio::FileError;

/// ProgID the installer writes (tauri.conf.json fileAssociations name).
pub const PROGID: &str = "PDFWorkbench.Document";
/// Name under HKCU\Software\RegisteredApplications (hooks.nsh PW_REGNAME).
pub const REGISTERED_NAME: &str = "PDF Workbench";

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Whether a UserChoice ProgId means PDF Workbench.
pub fn is_ours(progid: &str) -> bool {
    progid.eq_ignore_ascii_case(PROGID)
        || progid.eq_ignore_ascii_case(r"Applications\pdf-workbench.exe")
}

/// Some(true/false) from the user's choice for .pdf; None if Windows has no record.
#[tauri::command]
pub fn default_pdf_app() -> Option<bool> {
    let base = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf";
    // Newer Windows 11 builds keep the choice in UserChoiceLatest; older ones in UserChoice.
    for sub in ["UserChoiceLatest", "UserChoice"] {
        if let Some(p) = reg::string(reg::Root::User, &format!(r"{base}\{sub}"), Some("ProgId")) {
            return Some(is_ours(&p));
        }
    }
    None
}

/// The Settings link for this app's page in Default apps (per-user registration).
pub fn default_apps_uri() -> String {
    format!(
        "ms-settings:defaultapps?registeredAppUser={}",
        REGISTERED_NAME.replace(' ', "%20")
    )
}

#[tauri::command]
pub fn open_default_apps() -> Result<(), FileError> {
    // ShellExecute hands the ms-settings: link to Settings. explorer.exe with the same
    // link opened the Documents folder instead (owner test, Phase 10a step 4).
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, PCWSTR, w};
    let uri = HSTRING::from(default_apps_uri());
    // SAFETY: plain call with valid, NUL-terminated wide strings that outlive it.
    let h = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &uri,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute reports success as a value above 32.
    if h.0 as usize > 32 {
        Ok(())
    } else {
        Err(FileError::other(format!(
            "could not open Settings (code {})",
            h.0 as usize
        )))
    }
}

/// Opens THIRD-PARTY-NOTICES.txt (installed next to the app, bundle.resources) in
/// Notepad, which every Windows PC has.
#[tauri::command]
pub fn open_notices(app: tauri::AppHandle) -> Result<(), FileError> {
    use tauri::Manager;
    let file = app
        .path()
        .resource_dir()
        .map_err(|e| FileError::other(e.to_string()))?
        .join("THIRD-PARTY-NOTICES.txt");
    if !file.is_file() {
        return Err(FileError::other("THIRD-PARTY-NOTICES.txt is not installed"));
    }
    std::process::Command::new("notepad.exe")
        .arg(dunce_path(&file))
        .spawn()
        .map(|_| ())
        .map_err(|e| FileError::other(format!("could not open the notices: {e}")))
}

/// Notepad does not open `\\?\` paths (Tauri canonicalises the resource folder).
pub fn dunce_path(p: &std::path::Path) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}").into(),
        None => s
            .strip_prefix(r"\\?\")
            .map(Into::into)
            .unwrap_or_else(|| p.to_path_buf()),
    }
}

/// Small registry readers (HKCU / HKLM, REG_SZ and REG_DWORD).
pub mod reg {
    #[derive(Clone, Copy)]
    pub enum Root {
        User,
        Machine,
    }

    #[cfg(windows)]
    fn hkey(root: Root) -> windows::Win32::System::Registry::HKEY {
        use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        match root {
            Root::User => HKEY_CURRENT_USER,
            Root::Machine => HKEY_LOCAL_MACHINE,
        }
    }

    #[cfg(windows)]
    pub fn string(root: Root, key: &str, value: Option<&str>) -> Option<String> {
        use windows::Win32::System::Registry::{RRF_RT_REG_SZ, RegGetValueW};
        use windows::core::HSTRING;
        let k = HSTRING::from(key);
        let v = value.map(HSTRING::from);
        let mut buf = vec![0u16; 4096];
        let mut size = (buf.len() * 2) as u32;
        // SAFETY: buf/size describe a valid writable buffer; key and value are valid
        // null-terminated wide strings that outlive the call.
        let ok = unsafe {
            RegGetValueW(
                hkey(root),
                &k,
                v.as_ref()
                    .map(|h| windows::core::PCWSTR(h.as_ptr()))
                    .unwrap_or_default(),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if ok.is_err() {
            return None;
        }
        let len = (size as usize / 2).saturating_sub(1).min(buf.len());
        let s = String::from_utf16_lossy(&buf[..len]).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    #[cfg(windows)]
    pub fn dword(root: Root, key: &str, value: &str) -> Option<u32> {
        use windows::Win32::System::Registry::{RRF_RT_REG_DWORD, RegGetValueW};
        use windows::core::HSTRING;
        let k = HSTRING::from(key);
        let v = HSTRING::from(value);
        let mut out: u32 = 0;
        let mut size = 4u32;
        // SAFETY: out is a valid 4-byte buffer and size says so.
        let ok = unsafe {
            RegGetValueW(
                hkey(root),
                &k,
                &v,
                RRF_RT_REG_DWORD,
                None,
                Some((&mut out as *mut u32).cast()),
                Some(&mut size),
            )
        };
        ok.is_ok().then_some(out)
    }

    #[cfg(not(windows))]
    pub fn string(_: Root, _: &str, _: Option<&str>) -> Option<String> {
        None
    }

    #[cfg(not(windows))]
    pub fn dword(_: Root, _: &str, _: &str) -> Option<u32> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_our_progids_only() {
        assert!(is_ours("PDFWorkbench.Document"));
        assert!(is_ours("pdfworkbench.document"));
        assert!(is_ours(r"Applications\pdf-workbench.exe"));
        assert!(!is_ours("Acrobat.Document.DC"));
        assert!(!is_ours("MSEdgePDF"));
    }

    #[test]
    fn plain_paths_for_notepad() {
        use std::path::{Path, PathBuf};
        assert_eq!(
            dunce_path(Path::new(
                r"\\?\C:\Users\a\AppData\Local\PDF Workbench\x.txt"
            )),
            PathBuf::from(r"C:\Users\a\AppData\Local\PDF Workbench\x.txt")
        );
        assert_eq!(
            dunce_path(Path::new(r"\\?\UNC\server\share\x.txt")),
            PathBuf::from(r"\\server\share\x.txt")
        );
        assert_eq!(
            dunce_path(Path::new(r"C:\x.txt")),
            PathBuf::from(r"C:\x.txt")
        );
    }

    #[test]
    fn settings_link_names_the_registered_app() {
        assert_eq!(
            default_apps_uri(),
            "ms-settings:defaultapps?registeredAppUser=PDF%20Workbench"
        );
    }

    #[cfg(windows)]
    #[test]
    fn reads_a_value_windows_always_has() {
        let v = reg::string(
            reg::Root::Machine,
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
            Some("ProductName"),
        );
        assert!(v.is_some_and(|s| s.contains("Windows")));
        assert!(reg::string(reg::Root::User, r"Software\PDFWB-no-such-key", None).is_none());
    }
}
