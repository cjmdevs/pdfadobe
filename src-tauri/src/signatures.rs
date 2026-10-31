//! Saved visual signatures and initials (Phase 8): PNG images kept per user in the config
//! folder (`signatures\<id>.sig`), each encrypted at rest with Windows DPAPI for the
//! current user. File layout before encryption: `PWSG1`, one kind byte (0 signature,
//! 1 initials), then the PNG. Image contents never reach a log or an error message.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::fileio::{atomic_write, percent_decode};

pub const MAX_SIGNATURE_BYTES: usize = 2 * 1024 * 1024;
const MAX_SIGNATURES: usize = 20;
const MAGIC: &[u8] = b"PWSG1";
/// DPAPI "entropy": data protected by another program for this user does not decrypt
/// as one of ours.
const ENTROPY: &[u8] = b"PDF Workbench saved signature v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Signature,
    Initials,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SignatureInfo {
    pub id: String,
    pub kind: Kind,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("signatures"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn file_of(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.sig"))
}

fn decode(plain: &[u8]) -> Option<(Kind, &[u8])> {
    let rest = plain.strip_prefix(MAGIC)?;
    let (&k, png) = rest.split_first()?;
    let kind = match k {
        0 => Kind::Signature,
        1 => Kind::Initials,
        _ => return None,
    };
    Some((kind, png))
}

/// Reads and decrypts one saved signature. None when it is missing or unreadable (for
/// example protected by another Windows user).
fn read_in(dir: &Path, id: &str) -> Option<(Kind, Vec<u8>)> {
    if !valid_id(id) {
        return None;
    }
    let sealed = fs::read(file_of(dir, id)).ok()?;
    let plain = dpapi::unprotect(&sealed, ENTROPY).ok()?;
    decode(&plain).map(|(k, png)| (k, png.to_vec()))
}

pub fn list_in(dir: &Path) -> Vec<SignatureInfo> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let id = name.strip_suffix(".sig")?.to_string();
            valid_id(&id).then_some(id)
        })
        .collect();
    ids.sort();
    ids.into_iter()
        .filter_map(|id| read_in(dir, &id).map(|(kind, _)| SignatureInfo { id, kind }))
        .collect()
}

static SEQ: AtomicU32 = AtomicU32::new(0);

pub fn add_in(dir: &Path, kind: Kind, png: &[u8]) -> Result<SignatureInfo, String> {
    if png.len() > MAX_SIGNATURE_BYTES {
        return Err("the signature image is larger than 2 MB".into());
    }
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("a saved signature must be a PNG image".into());
    }
    if list_in(dir).len() >= MAX_SIGNATURES {
        return Err(format!(
            "there are already {MAX_SIGNATURES} saved signatures"
        ));
    }
    fs::create_dir_all(dir).map_err(|e| format!("could not create the signatures folder: {e}"))?;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let id = format!("{ms:x}-{:x}", SEQ.fetch_add(1, Ordering::Relaxed));
    let mut plain = Vec::with_capacity(png.len() + MAGIC.len() + 1);
    plain.extend_from_slice(MAGIC);
    plain.push(if kind == Kind::Initials { 1 } else { 0 });
    plain.extend_from_slice(png);
    let sealed = dpapi::protect(&plain, ENTROPY)?;
    atomic_write(&file_of(dir, &id), &sealed)?;
    Ok(SignatureInfo { id, kind })
}

pub fn remove_in(dir: &Path, id: &str) -> Result<(), String> {
    if valid_id(id) {
        let _ = fs::remove_file(file_of(dir, id));
    }
    Ok(())
}

#[tauri::command]
pub fn signatures_list(app: AppHandle) -> Vec<SignatureInfo> {
    dir(&app).map(|d| list_in(&d)).unwrap_or_default()
}

#[tauri::command]
pub fn signature_read(app: AppHandle, id: String) -> Result<Response, String> {
    let (_, png) = read_in(&dir(&app)?, &id).ok_or("this saved signature could not be read")?;
    Ok(Response::new(png))
}

#[derive(Deserialize)]
struct AddHeader {
    kind: Kind,
}

/// PNG bytes as the raw body, `{kind}` as a percent-encoded JSON `x-signature` header.
#[tauri::command]
pub fn signature_add(app: AppHandle, request: Request<'_>) -> Result<SignatureInfo, String> {
    let raw = request
        .headers()
        .get("x-signature")
        .ok_or("missing x-signature header")?
        .to_str()
        .map_err(|_| "x-signature header is not ASCII")?;
    let h: AddHeader = serde_json::from_str(&percent_decode(raw)?).map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    add_in(&dir(&app)?, h.kind, bytes)
}

#[tauri::command]
pub fn signature_remove(app: AppHandle, id: String) -> Result<(), String> {
    remove_in(&dir(&app)?, &id)
}

/// DPAPI for the current Windows user (CryptProtectData / CryptUnprotectData).
pub mod dpapi {
    #[cfg(windows)]
    pub fn protect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        run(data, entropy, true).map_err(|_| "Windows could not encrypt the signature".into())
    }

    #[cfg(windows)]
    pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        run(data, entropy, false).map_err(|_| "Windows could not decrypt the signature".into())
    }

    #[cfg(windows)]
    fn run(data: &[u8], entropy: &[u8], seal: bool) -> windows::core::Result<Vec<u8>> {
        use windows::Win32::Foundation::{HLOCAL, LocalFree};
        use windows::Win32::Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        };
        use windows::core::PCWSTR;
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let extra = CRYPT_INTEGER_BLOB {
            cbData: entropy.len() as u32,
            pbData: entropy.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            if seal {
                CryptProtectData(
                    &input,
                    PCWSTR::null(),
                    Some(&extra),
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out,
                )?;
            } else {
                CryptUnprotectData(
                    &input,
                    None,
                    Some(&extra),
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out,
                )?;
            }
            let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(Some(HLOCAL(out.pbData as _)));
            Ok(bytes)
        }
    }

    #[cfg(not(windows))]
    pub fn protect(_: &[u8], _: &[u8]) -> Result<Vec<u8>, String> {
        Err("saved signatures need Windows".into())
    }

    #[cfg(not(windows))]
    pub fn unprotect(_: &[u8], _: &[u8]) -> Result<Vec<u8>, String> {
        Err("saved signatures need Windows".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn png(marker: &[u8]) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
        v.extend_from_slice(marker);
        v
    }

    #[test]
    fn saved_signatures_are_encrypted_at_rest() {
        let d = std::env::temp_dir().join(format!("pdfwb-sigs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        assert!(list_in(&d).is_empty());
        let marker = b"SYNTHETIC-SIGNATURE-PIXELS-0123456789";
        let a = add_in(&d, Kind::Signature, &png(marker)).unwrap();
        let b = add_in(&d, Kind::Initials, &png(b"initials")).unwrap();
        // The file on disk holds neither the PNG header nor the image bytes.
        let raw = fs::read(file_of(&d, &a.id)).unwrap();
        assert!(!raw.windows(marker.len()).any(|w| w == marker));
        assert!(!raw.windows(4).any(|w| w == b"\x89PNG"));
        assert_eq!(list_in(&d), vec![a.clone(), b.clone()]);
        assert_eq!(read_in(&d, &a.id).unwrap(), (Kind::Signature, png(marker)));
        // Other DPAPI data for this user does not decrypt as a signature.
        let foreign = dpapi::protect(b"PWSG1\0x", b"other").unwrap();
        fs::write(d.join("ffff-1.sig"), foreign).unwrap();
        assert_eq!(list_in(&d).len(), 2);
        remove_in(&d, &a.id).unwrap();
        assert_eq!(list_in(&d), vec![b]);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn refuses_non_png_large_and_unsafe_ids() {
        let d = std::env::temp_dir().join(format!("pdfwb-sigs-bad-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        assert!(add_in(&d, Kind::Signature, b"%PDF-1.7").is_err());
        let big = png(&vec![0u8; MAX_SIGNATURE_BYTES]);
        let e = add_in(&d, Kind::Signature, &big).unwrap_err();
        assert!(!e.contains("PNG\r"));
        assert!(read_in(&d, "..\\..\\x").is_none());
        let _ = fs::remove_dir_all(d);
    }
}
