//! Certificate signing (Phase 8): lists signing certificates in the current user's
//! Windows certificate store, opens .pfx files in memory, and signs with Windows CNG.
//! The private key never leaves Windows: the frontend builds the CMS and asks for one
//! signature over its signed attributes (SHA-256; RSA PKCS#1 v1.5, or ECDSA r || s).
//!
//! A .pfx is imported with PKCS12_NO_PERSIST_KEY: its key lives only in this process for
//! the length of one call and is never written to the user's key store. Passwords and
//! document data never reach a log or an error message.

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};

use crate::fileio::percent_decode;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    /// SHA-1 thumbprint, hex (how Windows names a certificate).
    pub thumbprint: String,
    pub name: String,
    pub issuer: String,
    /// "2027-10-31"
    pub expires: String,
    /// DER certificates: this one first, then its chain as Windows builds it.
    pub chain: Vec<Vec<u8>>,
}

fn header<T: for<'a> Deserialize<'a>>(request: &Request<'_>, name: &str) -> Result<T, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing {name} header"))?
        .to_str()
        .map_err(|_| format!("{name} header is not ASCII"))?;
    serde_json::from_str(&percent_decode(raw)?).map_err(|_| format!("{name} header is not valid"))
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b),
        _ => Err("expected raw bytes".into()),
    }
}

/// Signing certificates with a private key, valid today, in Personal (CurrentUser\My).
#[tauri::command(async)]
pub fn certs_list() -> Result<Vec<CertInfo>, String> {
    win::list()
}

#[derive(Deserialize)]
struct CertHeader {
    thumbprint: String,
}

/// Body: the bytes to sign. Header `x-cert`: `{thumbprint}`.
#[tauri::command(async)]
pub fn cert_sign(request: Request<'_>) -> Result<Response, String> {
    let h: CertHeader = header(&request, "x-cert")?;
    let data = raw_body(&request)?;
    win::sign_store(&h.thumbprint, data).map(Response::new)
}

#[derive(Deserialize)]
struct PfxHeader {
    password: String,
}

/// Body: the .pfx file. Header `x-pfx`: `{password}`. Returns the signing certificate.
#[tauri::command(async)]
pub fn pfx_open(request: Request<'_>) -> Result<CertInfo, String> {
    let h: PfxHeader = header(&request, "x-pfx")?;
    win::pfx_info(raw_body(&request)?, &h.password)
}

/// Body: 4-byte little-endian .pfx length, the .pfx, then the bytes to sign.
/// Header `x-pfx`: `{password}`.
#[tauri::command(async)]
pub fn pfx_sign(request: Request<'_>) -> Result<Response, String> {
    let h: PfxHeader = header(&request, "x-pfx")?;
    let (pfx, data) = split_pfx_frame(raw_body(&request)?)?;
    win::sign_pfx(pfx, &h.password, data).map(Response::new)
}

pub fn split_pfx_frame(body: &[u8]) -> Result<(&[u8], &[u8]), String> {
    let len: [u8; 4] = body
        .get(..4)
        .and_then(|b| b.try_into().ok())
        .ok_or("truncated request")?;
    let n = u32::from_le_bytes(len) as usize;
    let pfx = body.get(4..4 + n).ok_or("truncated request")?;
    Ok((pfx, &body[4 + n..]))
}

#[cfg(windows)]
mod win {
    use super::CertInfo;
    use windows::Win32::Foundation::{ERROR_INVALID_PASSWORD, FILETIME, GetLastError, SYSTEMTIME};
    use windows::Win32::Security::Cryptography::*;
    use windows::Win32::System::Time::FileTimeToSystemTime;
    use windows::core::{HSTRING, PCWSTR};

    const ENCODING: CERT_QUERY_ENCODING_TYPE =
        CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0);
    const RSA_OID: &[u8] = b"1.2.840.113549.1.1.1";

    struct Store(HCERTSTORE);
    impl Drop for Store {
        fn drop(&mut self) {
            unsafe {
                let _ = CertCloseStore(Some(self.0), 0);
            }
        }
    }

    struct Cert(*const CERT_CONTEXT);
    impl Drop for Cert {
        fn drop(&mut self) {
            unsafe {
                let _ = CertFreeCertificateContext(Some(self.0));
            }
        }
    }

    fn my_store() -> Result<Store, String> {
        let flags =
            CERT_OPEN_STORE_FLAGS(CERT_SYSTEM_STORE_CURRENT_USER | CERT_STORE_READONLY_FLAG.0);
        let name = HSTRING::from("MY");
        unsafe {
            CertOpenStore(
                CERT_STORE_PROV_SYSTEM_W,
                CERT_QUERY_ENCODING_TYPE(0),
                None,
                flags,
                Some(name.as_ptr() as *const _),
            )
        }
        .map(Store)
        .map_err(|_| "the Windows certificate store could not be opened".into())
    }

    /// Every certificate in `store`, each with its own reference.
    fn certs(store: &Store) -> Vec<Cert> {
        let mut out = Vec::new();
        let mut prev: *mut CERT_CONTEXT = std::ptr::null_mut();
        loop {
            prev = unsafe {
                CertEnumCertificatesInStore(store.0, (!prev.is_null()).then_some(prev as *const _))
            };
            if prev.is_null() {
                break;
            }
            out.push(Cert(unsafe { CertDuplicateCertificateContext(Some(prev)) }));
        }
        out
    }

    fn der(c: &Cert) -> Vec<u8> {
        unsafe { std::slice::from_raw_parts((*c.0).pbCertEncoded, (*c.0).cbCertEncoded as usize) }
            .to_vec()
    }

    fn thumbprint(c: &Cert) -> String {
        let mut buf = [0u8; 20];
        let mut len = buf.len() as u32;
        let ok = unsafe {
            CertGetCertificateContextProperty(
                c.0,
                CERT_HASH_PROP_ID,
                Some(buf.as_mut_ptr() as *mut _),
                &mut len,
            )
        };
        if ok.is_err() {
            return String::new();
        }
        buf[..len as usize]
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect()
    }

    fn name(c: &Cert, issuer: bool) -> String {
        let flags = if issuer { CERT_NAME_ISSUER_FLAG } else { 0 };
        let mut buf = [0u16; 512];
        let n = unsafe {
            CertGetNameStringW(
                c.0,
                CERT_NAME_SIMPLE_DISPLAY_TYPE,
                flags,
                None,
                Some(&mut buf),
            )
        };
        String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)])
    }

    fn expires(c: &Cert) -> String {
        let ft: FILETIME = unsafe { (*(*c.0).pCertInfo).NotAfter };
        let mut st = SYSTEMTIME::default();
        if unsafe { FileTimeToSystemTime(&ft, &mut st) }.is_err() {
            return String::new();
        }
        format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
    }

    fn time_valid(c: &Cert) -> bool {
        unsafe { CertVerifyTimeValidity(None, (*c.0).pCertInfo) == 0 }
    }

    /// Key usage allows signing (or the certificate does not restrict it).
    fn usage_ok(c: &Cert) -> bool {
        let mut usage = [0u8; 2];
        match unsafe { CertGetIntendedKeyUsage(ENCODING, (*c.0).pCertInfo, &mut usage) } {
            Ok(()) => {
                let bits = u32::from(usage[0]);
                bits & (CERT_DIGITAL_SIGNATURE_KEY_USAGE | CERT_NON_REPUDIATION_KEY_USAGE) != 0
            }
            Err(_) => true,
        }
    }

    fn has_key_property(c: &Cert) -> bool {
        let mut len = 0u32;
        unsafe {
            CertGetCertificateContextProperty(c.0, CERT_KEY_PROV_INFO_PROP_ID, None, &mut len)
        }
        .is_ok()
    }

    fn is_rsa(c: &Cert) -> bool {
        let oid = unsafe { (*(*c.0).pCertInfo).SubjectPublicKeyInfo.Algorithm.pszObjId };
        !oid.is_null() && unsafe { oid.as_bytes() } == RSA_OID
    }

    /// This certificate followed by its chain (as far as Windows can build it).
    fn chain(c: &Cert, extra: Option<&Store>) -> Vec<Vec<u8>> {
        let mut out = vec![der(c)];
        let para = CERT_CHAIN_PARA {
            cbSize: std::mem::size_of::<CERT_CHAIN_PARA>() as u32,
            ..Default::default()
        };
        let mut ctx: *mut CERT_CHAIN_CONTEXT = std::ptr::null_mut();
        let built = unsafe {
            CertGetCertificateChain(
                None,
                c.0,
                None,
                extra.map(|s| s.0),
                &para,
                0,
                None,
                &mut ctx,
            )
        };
        if built.is_err() || ctx.is_null() {
            return out;
        }
        unsafe {
            if (*ctx).cChain > 0 {
                let simple = *(*ctx).rgpChain;
                for i in 1..(*simple).cElement.min(6) as usize {
                    let el = *(*simple).rgpElement.add(i);
                    let cc = (*el).pCertContext;
                    out.push(
                        std::slice::from_raw_parts(
                            (*cc).pbCertEncoded,
                            (*cc).cbCertEncoded as usize,
                        )
                        .to_vec(),
                    );
                }
            }
            CertFreeCertificateChain(ctx);
        }
        out
    }

    fn info(c: &Cert, extra: Option<&Store>) -> CertInfo {
        CertInfo {
            thumbprint: thumbprint(c),
            name: name(c, false),
            issuer: name(c, true),
            expires: expires(c),
            chain: chain(c, extra),
        }
    }

    pub fn list() -> Result<Vec<CertInfo>, String> {
        let store = my_store()?;
        Ok(certs(&store)
            .into_iter()
            .filter(|c| has_key_property(c) && time_valid(c) && usage_ok(c))
            .map(|c| info(&c, None))
            .collect())
    }

    struct Key {
        handle: NCRYPT_KEY_HANDLE,
        free: bool,
    }
    impl Drop for Key {
        fn drop(&mut self) {
            if self.free {
                unsafe {
                    let _ = NCryptFreeObject(NCRYPT_HANDLE(self.handle.0));
                }
            }
        }
    }

    fn key(c: &Cert, silent: bool) -> Option<Key> {
        let mut h = HCRYPTPROV_OR_NCRYPT_KEY_HANDLE::default();
        let mut spec = CERT_KEY_SPEC::default();
        let mut free = windows::core::BOOL::default();
        // CACHE: a .pfx key imported without persisting exists only as the handle cached
        // on the certificate (CERT_KEY_CONTEXT_PROP_ID); without the flag it is not found.
        let mut flags = CRYPT_ACQUIRE_ONLY_NCRYPT_KEY_FLAG | CRYPT_ACQUIRE_CACHE_FLAG;
        if silent {
            flags |= CRYPT_ACQUIRE_SILENT_FLAG;
        }
        unsafe {
            CryptAcquireCertificatePrivateKey(
                c.0,
                flags,
                None,
                &mut h,
                Some(&mut spec),
                Some(&mut free),
            )
        }
        .ok()?;
        Some(Key {
            handle: NCRYPT_KEY_HANDLE(h.0),
            free: free.as_bool(),
        })
    }

    fn sign_with(c: &Cert, data: &[u8]) -> Result<Vec<u8>, String> {
        let k = key(c, false).ok_or(
            "Windows could not use this certificate's private key (it may be on a card that is not inserted)",
        )?;
        let mut hash = [0u8; 32];
        unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, data, &mut hash) }
            .ok()
            .map_err(|_| "Windows could not compute the SHA-256 hash")?;
        let pad = BCRYPT_PKCS1_PADDING_INFO {
            pszAlgId: BCRYPT_SHA256_ALGORITHM,
        };
        let (padding, flags) = if is_rsa(c) {
            (
                Some(&pad as *const _ as *const core::ffi::c_void),
                NCRYPT_PAD_PKCS1_FLAG,
            )
        } else {
            (None, NCRYPT_FLAGS(0))
        };
        let mut len = 0u32;
        let fail = |_| "Windows could not sign with this certificate".to_string();
        unsafe { NCryptSignHash(k.handle, padding, &hash, None, &mut len, flags) }.map_err(fail)?;
        let mut sig = vec![0u8; len as usize];
        unsafe { NCryptSignHash(k.handle, padding, &hash, Some(&mut sig), &mut len, flags) }
            .map_err(fail)?;
        sig.truncate(len as usize);
        Ok(sig)
    }

    pub fn sign_store(thumbprint_hex: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let hash: Vec<u8> = (0..thumbprint_hex.len() / 2)
            .filter_map(|i| u8::from_str_radix(thumbprint_hex.get(i * 2..i * 2 + 2)?, 16).ok())
            .collect();
        if hash.len() != 20 {
            return Err("that certificate is not valid".into());
        }
        let store = my_store()?;
        let blob = CRYPT_INTEGER_BLOB {
            cbData: hash.len() as u32,
            pbData: hash.as_ptr() as *mut u8,
        };
        let found = unsafe {
            CertFindCertificateInStore(
                store.0,
                ENCODING,
                0,
                CERT_FIND_HASH,
                Some(&blob as *const _ as *const _),
                None,
            )
        };
        if found.is_null() {
            return Err("that certificate is no longer in the Windows certificate store".into());
        }
        sign_with(&Cert(found), data)
    }

    /// Imports a .pfx into a store that lives only in this process.
    fn import(pfx: &[u8], password: &str) -> Result<Store, String> {
        let blob = CRYPT_INTEGER_BLOB {
            cbData: pfx.len() as u32,
            pbData: pfx.as_ptr() as *mut u8,
        };
        let pw = HSTRING::from(password);
        unsafe {
            PFXImportCertStore(
                &blob,
                PCWSTR(pw.as_ptr()),
                PKCS12_NO_PERSIST_KEY | PKCS12_ALWAYS_CNG_KSP,
            )
        }
        .map(Store)
        .map_err(|_| {
            if unsafe { GetLastError() } == ERROR_INVALID_PASSWORD {
                "The password for this .pfx file is not correct.".into()
            } else {
                "This file could not be read as a .pfx certificate.".into()
            }
        })
    }

    /// The certificate in the .pfx that has its private key.
    fn signer_of(store: &Store) -> Result<Cert, String> {
        certs(store)
            .into_iter()
            .find(|c| key(c, true).is_some())
            .ok_or("This .pfx file has no private key.".into())
    }

    pub fn pfx_info(pfx: &[u8], password: &str) -> Result<CertInfo, String> {
        let store = import(pfx, password)?;
        let c = signer_of(&store)?;
        let mut i = info(&c, Some(&store));
        // Include the .pfx's other certificates when Windows could not chain them.
        for other in certs(&store).iter().map(der) {
            if !i.chain.contains(&other) {
                i.chain.push(other);
            }
        }
        Ok(i)
    }

    pub fn sign_pfx(pfx: &[u8], password: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let store = import(pfx, password)?;
        let c = signer_of(&store)?;
        sign_with(&c, data)
    }
}

#[cfg(not(windows))]
mod win {
    use super::CertInfo;
    const NO: &str = "certificate signing needs Windows";
    pub fn list() -> Result<Vec<CertInfo>, String> {
        Err(NO.into())
    }
    pub fn sign_store(_: &str, _: &[u8]) -> Result<Vec<u8>, String> {
        Err(NO.into())
    }
    pub fn pfx_info(_: &[u8], _: &str) -> Result<CertInfo, String> {
        Err(NO.into())
    }
    pub fn sign_pfx(_: &[u8], _: &str, _: &[u8]) -> Result<Vec<u8>, String> {
        Err(NO.into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    /// A throwaway RSA or EC .pfx made by OpenSSL (Git for Windows ships it).
    fn make_pfx(dir: &Path, ec: bool) -> Option<Vec<u8>> {
        let key = if ec { "ec" } else { "rsa:2048" };
        let mut req = Command::new("openssl");
        req.current_dir(dir).args([
            "req",
            "-x509",
            "-nodes",
            "-days",
            "2",
            "-subj",
            "/CN=PDF Workbench Rust Test",
        ]);
        if ec {
            req.args(["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256"]);
        } else {
            req.args(["-newkey", key]);
        }
        let ok = req
            .args(["-keyout", "k.pem", "-out", "c.pem"])
            .output()
            .ok()?
            .status
            .success();
        if !ok {
            return None;
        }
        Command::new("openssl")
            .current_dir(dir)
            .args(["pkey", "-in", "k.pem", "-pubout", "-out", "pub.pem"])
            .output()
            .ok()?;
        let ok = Command::new("openssl")
            .current_dir(dir)
            .args([
                "pkcs12",
                "-export",
                "-inkey",
                "k.pem",
                "-in",
                "c.pem",
                "-out",
                "t.pfx",
                "-passout",
                "pass:test-pw",
            ])
            .output()
            .ok()?
            .status
            .success();
        ok.then(|| std::fs::read(dir.join("t.pfx")).ok()).flatten()
    }

    fn verify(dir: &Path, data: &[u8], sig: &[u8], ec: bool) -> bool {
        std::fs::write(dir.join("data.bin"), data).unwrap();
        // OpenSSL expects DER for ECDSA; CNG gives r || s.
        let sig = if ec { ecdsa_der(sig) } else { sig.to_vec() };
        std::fs::write(dir.join("sig.bin"), sig).unwrap();
        Command::new("openssl")
            .current_dir(dir)
            .args([
                "dgst",
                "-sha256",
                "-verify",
                "pub.pem",
                "-signature",
                "sig.bin",
                "data.bin",
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn ecdsa_der(raw: &[u8]) -> Vec<u8> {
        let int = |b: &[u8]| {
            let mut v: Vec<u8> = b.iter().copied().skip_while(|&x| x == 0).collect();
            if v.first().is_none_or(|&x| x & 0x80 != 0) {
                v.insert(0, 0);
            }
            let mut out = vec![0x02, v.len() as u8];
            out.extend(v);
            out
        };
        let (r, s) = raw.split_at(raw.len() / 2);
        let body = [int(r), int(s)].concat();
        let mut out = vec![0x30, body.len() as u8];
        out.extend(body);
        out
    }

    #[test]
    fn pfx_open_and_sign_rsa_and_ec() {
        for ec in [false, true] {
            let dir = std::env::temp_dir().join(format!("pdfwb-pfx-{}-{ec}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let Some(pfx) = make_pfx(&dir, ec) else {
                eprintln!("skipped: needs openssl");
                return;
            };
            let info = win::pfx_info(&pfx, "test-pw").unwrap();
            assert_eq!(info.name, "PDF Workbench Rust Test");
            assert_eq!(info.thumbprint.len(), 40);
            assert!(!info.chain.is_empty());
            let wrong = win::pfx_info(&pfx, "nope").unwrap_err();
            assert!(wrong.contains("not correct"), "{wrong}");
            assert!(!wrong.contains("nope"));
            let data = b"signed attributes (synthetic)";
            let sig = win::sign_pfx(&pfx, "test-pw", data).unwrap();
            assert!(
                verify(&dir, data, &sig, ec),
                "openssl rejected the signature (ec={ec})"
            );
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn listing_the_store_works() {
        // Content depends on the PC; it must not fail.
        win::list().unwrap();
    }

    #[test]
    fn pfx_frames_split() {
        let mut body = 3u32.to_le_bytes().to_vec();
        body.extend(b"pfxdata");
        assert_eq!(split_pfx_frame(&body).unwrap(), (&b"pfx"[..], &b"data"[..]));
        assert!(split_pfx_frame(&[9, 0, 0, 0, 1]).is_err());
    }
}
