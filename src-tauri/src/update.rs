//! Updates from a firm-controlled folder (Phase 10a; decision 1 in docs/phases/phase-10a.md).
//!
//! The firm publishes into one folder (normally a UNC share):
//!   latest.json        { "version", "notes", "pub_date", "file", "sha256", "rollback"? }
//!   latest.json.sig    signature of latest.json
//!   <file>             the NSIS setup .exe (Authenticode-signed)
//!   <file>.sig         signature of the setup .exe
//! Signatures are made with `tauri signer sign` (minisign, ed25519) by
//! scripts/update-package.mjs. The public key is built into the app
//! (src-tauri/update-key.pub); a manifest or installer signed with any other key is
//! refused. The installer is copied to Local AppData first and every check runs on the
//! copy, so the share file cannot change between check and start.
//!
//! Where the folder is (first found wins):
//!   HKLM\Software\Policies\PDF Workbench\Update  Source (REG_SZ)
//!   HKCU\Software\Policies\PDF Workbench\Update  Source (REG_SZ)
//!   PDFWB_UPDATE_SOURCE at build time
//! `Disabled` = DWORD 1 in either key turns checking off.
//!
//! This is the app's only network use (CLAUDE.md: "the explicit update check"): it reads
//! files from the firm's own share. Nothing is sent.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::appsvc::reg;
use crate::fileio::FileError;

const POLICY_KEY: &str = r"Software\Policies\PDF Workbench\Update";
const PUBKEY: &str = include_str!("../update-key.pub");
const MAX_MANIFEST: u64 = 64 * 1024;
const MAX_SIG: u64 = 4 * 1024;
/// A share that does not answer must not hang the app.
const READ_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize, PartialEq)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub pub_date: String,
    pub file: String,
    pub sha256: String,
    /// The firm is sending everyone back to this (older) version.
    #[serde(default)]
    pub rollback: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateState {
    Off { reason: &'static str },
    UpToDate { current: String },
    Available { info: UpdateInfo },
    Unreachable,
    Bad { message: String },
}

#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct UpdateInfo {
    pub current: String,
    pub version: String,
    pub notes: String,
    pub rollback: bool,
}

/// Parsed "1.2.3" or "1.2.3-beta.1"; pre-releases sort before the release.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64, Option<String>)> {
    let v = v.trim().trim_start_matches('v');
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (v, None),
    };
    let mut it = core.split('.').map(|n| n.parse::<u64>().ok());
    let r = (it.next()??, it.next()??, it.next()??, pre);
    it.next().is_none().then_some(r)
}

/// Ordering of two versions; None if either does not parse.
pub fn compare(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    let (a, b) = (parse_version(a)?, parse_version(b)?);
    Some(
        (a.0, a.1, a.2)
            .cmp(&(b.0, b.1, b.2))
            .then_with(|| match (&a.3, &b.3) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(x), Some(y)) => x.cmp(y),
            }),
    )
}

/// What to offer for a checked manifest.
pub fn decide(current: &str, m: &Manifest) -> UpdateState {
    use std::cmp::Ordering::*;
    let info = || UpdateInfo {
        current: current.to_string(),
        version: m.version.clone(),
        notes: m.notes.chars().take(2000).collect(),
        rollback: m.rollback,
    };
    match compare(&m.version, current) {
        None => UpdateState::Bad {
            message: "the update manifest has an invalid version".into(),
        },
        Some(Greater) if !m.rollback => UpdateState::Available { info: info() },
        Some(Less) if m.rollback => UpdateState::Available { info: info() },
        _ => UpdateState::UpToDate {
            current: current.to_string(),
        },
    }
}

/// A plain setup file name: no folders, no tricks.
pub fn valid_file_name(f: &str) -> bool {
    !f.is_empty()
        && f.len() < 200
        && f.to_ascii_lowercase().ends_with("-setup.exe")
        && !f.contains(['/', '\\', ':', '"', '<', '>', '|', '?', '*'])
        && !f.starts_with('.')
        && !f.chars().any(|c| c.is_control())
}

/// The built-in public key: a `tauri signer generate` key file is the base64 of a
/// minisign public key file.
fn public_key(text: &str) -> Option<minisign_verify::PublicKey> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let decoded = base64::engine::general_purpose::STANDARD.decode(t).ok()?;
    minisign_verify::PublicKey::decode(std::str::from_utf8(&decoded).ok()?).ok()
}

/// Checks a `tauri signer sign` signature (base64 of a minisign signature file).
pub fn verify_sig(key_text: &str, data: &[u8], sig_text: &str) -> Result<(), String> {
    let key = public_key(key_text).ok_or("no update key in this build")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(sig_text.trim())
        .map_err(|_| "the signature file is damaged")?;
    let sig = minisign_verify::Signature::decode(
        std::str::from_utf8(&decoded).map_err(|_| "the signature file is damaged")?,
    )
    .map_err(|_| "the signature file is damaged")?;
    key.verify(data, &sig, false)
        .map_err(|_| "the signature does not match the firm's update key".to_string())
}

/// Parses and checks latest.json against its signature.
pub fn check_manifest(key: &str, json: &[u8], sig: &str) -> Result<Manifest, String> {
    verify_sig(key, json, sig).map_err(|e| format!("update manifest: {e}"))?;
    let m: Manifest =
        serde_json::from_slice(json).map_err(|_| "the update manifest is not valid".to_string())?;
    if !valid_file_name(&m.file) {
        return Err("the update manifest names an invalid installer file".into());
    }
    if m.sha256.len() != 64 || !m.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("the update manifest has an invalid checksum".into());
    }
    Ok(m)
}

fn policy() -> (bool, Option<String>) {
    let mut disabled = false;
    let mut source = None;
    for root in [reg::Root::Machine, reg::Root::User] {
        disabled |= reg::dword(root, POLICY_KEY, "Disabled") == Some(1);
        if source.is_none() {
            source = reg::string(root, POLICY_KEY, Some("Source"));
        }
    }
    let source = source.or_else(|| option_env!("PDFWB_UPDATE_SOURCE").map(String::from));
    (disabled, source.filter(|s| !s.trim().is_empty()))
}

/// Runs `f` on its own thread and gives up after `limit` (a dead share can block a
/// file read for minutes).
fn with_timeout<T: Send + 'static>(
    limit: Duration,
    f: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(limit).ok()
}

fn read_limited(path: &Path, max: u64) -> std::io::Result<Vec<u8>> {
    let len = fs::metadata(path)?.len();
    if len > max {
        return Err(std::io::Error::other("file too large"));
    }
    fs::read(path)
}

fn read_manifest(source: &str) -> Result<Option<Manifest>, String> {
    let dir = PathBuf::from(source);
    let read = with_timeout(READ_TIMEOUT, move || {
        let json = read_limited(&dir.join("latest.json"), MAX_MANIFEST)?;
        let sig = read_limited(&dir.join("latest.json.sig"), MAX_SIG)?;
        Ok::<_, std::io::Error>((json, sig))
    });
    let Some(Ok((json, sig))) = read else {
        return Ok(None);
    };
    check_manifest(PUBKEY, &json, &String::from_utf8_lossy(&sig)).map(Some)
}

pub fn check() -> UpdateState {
    if cfg!(debug_assertions) && std::env::var_os("PDFWB_UPDATE_DEV").is_none() {
        return UpdateState::Off { reason: "dev" };
    }
    let (disabled, source) = policy();
    if disabled {
        return UpdateState::Off { reason: "policy" };
    }
    let Some(source) = source else {
        return UpdateState::Off { reason: "noSource" };
    };
    if public_key(PUBKEY).is_none() {
        return UpdateState::Off { reason: "noKey" };
    }
    match read_manifest(&source) {
        Ok(Some(m)) => decide(env!("CARGO_PKG_VERSION"), &m),
        Ok(None) => UpdateState::Unreachable,
        Err(message) => UpdateState::Bad { message },
    }
}

#[tauri::command]
pub async fn update_check() -> UpdateState {
    tauri::async_runtime::spawn_blocking(check)
        .await
        .unwrap_or(UpdateState::Unreachable)
}

fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Copies the installer next to the app's local data and checks the copy.
fn fetch_installer(source: &str, m: &Manifest) -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or("no local app data folder")?;
    let dir = PathBuf::from(base)
        .join("com.mgrcpas.pdfworkbench")
        .join("updates");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| format!("could not make the update folder: {e}"))?;
    let local = dir.join(&m.file);
    let (src, sig_src) = (
        PathBuf::from(source).join(&m.file),
        PathBuf::from(source).join(format!("{}.sig", m.file)),
    );
    let to = local.clone();
    let copied = with_timeout(Duration::from_secs(600), move || {
        fs::copy(&src, &to).map(|_| ())?;
        read_limited(&sig_src, MAX_SIG)
    })
    .ok_or("the update folder stopped answering")?
    .map_err(|e| format!("could not copy the installer: {e}"))?;
    let bytes = fs::read(&local).map_err(|e| format!("could not read the installer: {e}"))?;
    if !sha256_hex(&bytes).eq_ignore_ascii_case(&m.sha256) {
        let _ = fs::remove_file(&local);
        return Err("the installer does not match the update manifest".into());
    }
    if let Err(e) = verify_sig(PUBKEY, &bytes, &String::from_utf8_lossy(&copied)) {
        let _ = fs::remove_file(&local);
        return Err(format!("installer: {e}"));
    }
    authenticode_ok(&local)?;
    Ok(local)
}

/// Windows' own check of the installer's code signature (no network: revocation is
/// checked from the cache only).
#[cfg(windows)]
fn authenticode_ok(path: &Path) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Security::WinTrust::{
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
        WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
        WTD_STATEACTION_VERIFY, WTD_UI_NONE, WinVerifyTrust,
    };
    use windows::core::HSTRING;
    let wide = HSTRING::from(path.as_os_str());
    let mut file = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: windows::core::PCWSTR(wide.as_ptr()),
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: data/file point at live locals; the second call releases the state the
    // first one allocated.
    let status = unsafe {
        let s = WinVerifyTrust(
            HWND::default(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        );
        data.dwStateAction = WTD_STATEACTION_CLOSE;
        WinVerifyTrust(
            HWND::default(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        );
        s
    };
    if status == 0 {
        Ok(())
    } else {
        Err(format!(
            "the installer's code signature is not trusted on this computer (0x{:08X})",
            status as u32
        ))
    }
}

#[cfg(not(windows))]
fn authenticode_ok(_: &Path) -> Result<(), String> {
    Err("updates install on Windows only".into())
}

/// Checks again, copies and checks the installer, starts it in passive mode with
/// /UPDATE (keeps shortcuts and the Default apps registration) and /R (start the app
/// again when done), then closes the app. The frontend has already made sure nothing
/// is unsaved.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, version: String) -> Result<(), FileError> {
    let setup = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let (disabled, source) = policy();
        if disabled {
            return Err("updates are turned off by the firm".into());
        }
        let source = source.ok_or("no update folder is set")?;
        let m = read_manifest(&source)?.ok_or("the update folder can't be reached")?;
        match decide(env!("CARGO_PKG_VERSION"), &m) {
            UpdateState::Available { info } if info.version == version => {}
            _ => return Err("this update is no longer offered".into()),
        }
        fetch_installer(&source, &m)
    })
    .await
    .map_err(|e| FileError::other(e.to_string()))?
    .map_err(FileError::other)?;
    std::process::Command::new(&setup)
        .args(["/P", "/R", "/UPDATE"])
        .spawn()
        .map_err(|e| FileError::other(format!("could not start the installer: {e}")))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering::*;

    fn manifest(version: &str, rollback: bool) -> Manifest {
        Manifest {
            version: version.into(),
            notes: "n".into(),
            pub_date: String::new(),
            file: "PDF Workbench_1.0.0_x64-setup.exe".into(),
            sha256: "0".repeat(64),
            rollback,
        }
    }

    #[test]
    fn versions_compare_like_semver() {
        assert_eq!(compare("1.2.3", "1.2.3"), Some(Equal));
        assert_eq!(compare("1.10.0", "1.9.9"), Some(Greater));
        assert_eq!(compare("v2.0.0", "1.99.99"), Some(Greater));
        assert_eq!(compare("1.0.0-beta.1", "1.0.0"), Some(Less));
        assert_eq!(compare("1.0", "1.0.0"), None);
        assert_eq!(compare("1.0.0.1", "1.0.0"), None);
    }

    #[test]
    fn offers_newer_and_signed_rollbacks_only() {
        assert!(matches!(
            decide("1.0.0", &manifest("1.1.0", false)),
            UpdateState::Available { .. }
        ));
        assert!(matches!(
            decide("1.1.0", &manifest("1.0.0", false)),
            UpdateState::UpToDate { .. }
        ));
        assert!(matches!(
            decide("1.1.0", &manifest("1.0.0", true)),
            UpdateState::Available { .. }
        ));
        // A "rollback" to a newer version is not a rollback: never offered.
        assert!(matches!(
            decide("1.0.0", &manifest("1.1.0", true)),
            UpdateState::UpToDate { .. }
        ));
        assert!(matches!(
            decide("1.0.0", &manifest("1.0.0", false)),
            UpdateState::UpToDate { .. }
        ));
        assert!(matches!(
            decide("1.0.0", &manifest("one", false)),
            UpdateState::Bad { .. }
        ));
    }

    #[test]
    fn installer_names_are_plain() {
        assert!(valid_file_name("PDF Workbench_1.2.0_x64-setup.exe"));
        for bad in [
            r"..\evil-setup.exe",
            r"\\server\x-setup.exe",
            "C:x-setup.exe",
            "x.exe",
            "x-setup.exe.bat",
            ".hidden-setup.exe",
            "",
        ] {
            assert!(!valid_file_name(bad), "{bad}");
        }
    }

    // Key pair and signatures made once with `tauri signer` for these tests only
    // (tests/fixtures/update: see README there). Not the firm's key.
    const TEST_PUB: &str = include_str!("../tests/fixtures/update/test-key.pub");
    const TEST_JSON: &[u8] = include_bytes!("../tests/fixtures/update/latest.json");
    const TEST_SIG: &str = include_str!("../tests/fixtures/update/latest.json.sig");

    #[test]
    fn accepts_a_manifest_signed_with_the_key() {
        let m = check_manifest(TEST_PUB, TEST_JSON, TEST_SIG).expect("valid");
        assert_eq!(m.version, "9.9.9");
        assert!(!m.rollback);
    }

    #[test]
    fn refuses_tampered_or_foreign_manifests() {
        let mut tampered = TEST_JSON.to_vec();
        let i = tampered.iter().position(|&b| b == b'9').unwrap();
        tampered[i] = b'8';
        assert!(check_manifest(TEST_PUB, &tampered, TEST_SIG).is_err());
        assert!(check_manifest(PUBKEY_OTHER, TEST_JSON, TEST_SIG).is_err());
        assert!(check_manifest(TEST_PUB, TEST_JSON, "not a signature").is_err());
        assert!(check_manifest("", TEST_JSON, TEST_SIG).is_err());
    }

    const PUBKEY_OTHER: &str = include_str!("../tests/fixtures/update/other-key.pub");

    #[test]
    fn a_dead_folder_times_out() {
        let r = with_timeout(Duration::from_millis(50), || {
            std::thread::sleep(Duration::from_secs(2));
            1
        });
        assert_eq!(r, None);
    }
}
