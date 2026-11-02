//! Create PDF from Word, Excel and PowerPoint files, and Export PDF to Word (backlog B5),
//! by driving the installed desktop Office app through its own COM automation
//! (late-bound IDispatch with named arguments; no type library, no new crate).
//!
//! Safety: the source is copied into a job folder under a short name first (long paths,
//! `\\?\` paths, files open in Office), opened read-only and hidden with macros forced
//! off. One conversion runs at a time. A conversion that takes too long kills the Office
//! process this conversion started, never one the user already had open.
//!
//! Office values (Microsoft Learn, checked 2026-11-02): wdExportFormatPDF 17,
//! wdExportCreateHeadingBookmarks 1, wdAlertsNone 0, wdFormatDocumentDefault 16,
//! wdDoNotSaveChanges 0, msoAutomationSecurityForceDisable 3, msoTrue -1, msoFalse 0,
//! xlTypePDF 0, ppSaveAsPDF 32.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::fileio::FileError;
use crate::qpdf_job::job_dir;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum App {
    Word,
    Excel,
    PowerPoint,
}

impl App {
    fn prog_id(self) -> &'static str {
        match self {
            App::Word => "Word.Application",
            App::Excel => "Excel.Application",
            App::PowerPoint => "PowerPoint.Application",
        }
    }

    fn exe(self) -> &'static str {
        match self {
            App::Word => "WINWORD.EXE",
            App::Excel => "EXCEL.EXE",
            App::PowerPoint => "POWERPNT.EXE",
        }
    }

    fn name(self) -> &'static str {
        match self {
            App::Word => "Word",
            App::Excel => "Excel",
            App::PowerPoint => "PowerPoint",
        }
    }
}

/// Which Office app opens a file, by extension (case-insensitive).
pub fn app_for(path: &Path) -> Option<App> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "doc" | "docx" | "docm" | "dot" | "dotx" | "rtf" | "odt" => Some(App::Word),
        "xls" | "xlsx" | "xlsm" | "xlsb" | "csv" | "ods" => Some(App::Excel),
        "ppt" | "pptx" | "pptm" | "pps" | "ppsx" | "odp" => Some(App::PowerPoint),
        _ => None,
    }
}

/// The program path in a LocalServer32 value: `"C:\..\WINWORD.EXE" /Automation` or
/// `C:\Program Files\..\EXCEL.EXE /automation`.
pub fn exe_from_command(cmd: &str) -> Option<PathBuf> {
    let cmd = cmd.trim();
    if let Some(rest) = cmd.strip_prefix('"') {
        return rest.split('"').next().map(PathBuf::from);
    }
    let lower = cmd.to_ascii_lowercase();
    let end = lower.find(".exe")? + 4;
    Some(PathBuf::from(&cmd[..end]))
}

#[derive(Serialize)]
pub struct OfficeApps {
    word: bool,
    excel: bool,
    powerpoint: bool,
}

/// Which desktop Office apps can be driven. Web-only Office registers no COM server, so
/// it counts as missing.
#[tauri::command]
pub async fn office_apps() -> OfficeApps {
    OfficeApps {
        word: installed(App::Word),
        excel: installed(App::Excel),
        powerpoint: installed(App::PowerPoint),
    }
}

/// An Office file as PDF bytes. The caller writes them beside the source.
#[tauri::command]
pub async fn office_to_pdf(path: String) -> Result<Response, FileError> {
    let src = PathBuf::from(&path);
    let app =
        app_for(&src).ok_or_else(|| FileError::other("not a Word, Excel or PowerPoint file"))?;
    let bytes = fs::read(&src).map_err(|e| crate::fileio::classify("open", &e))?;
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    tauri::async_runtime::spawn_blocking(move || {
        convert(app, Job::ToPdf, &bytes, &ext, Duration::from_secs(180)).map(Response::new)
    })
    .await
    .map_err(|e| FileError::other(e.to_string()))?
}

/// PDF bytes (the request body) as a Word document, through Word's own PDF conversion.
#[tauri::command]
pub async fn pdf_to_word(request: Request<'_>) -> Result<Response, FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        convert(
            App::Word,
            Job::PdfToDocx,
            &bytes,
            "pdf",
            Duration::from_secs(300),
        )
        .map(Response::new)
    })
    .await
    .map_err(|e| FileError::other(e.to_string()))?
}

#[derive(Clone, Copy)]
enum Job {
    ToPdf,
    PdfToDocx,
}

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn convert(
    app: App,
    job: Job,
    input: &[u8],
    ext: &str,
    limit: Duration,
) -> Result<Vec<u8>, FileError> {
    if !installed(app) {
        return Err(FileError::other(format!(
            "Microsoft {} (desktop) is not installed on this PC",
            app.name()
        )));
    }
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|p| p.into_inner());
    let _prompt = matches!(job, Job::PdfToDocx).then(|| PdfPromptOff::new(WORD_OPTIONS));
    let dir = job_dir("office")?;
    let result = (|| {
        let src = dir.join(format!("input.{ext}"));
        let out = dir.join(match job {
            Job::ToPdf => "output.pdf",
            Job::PdfToDocx => "output.docx",
        });
        fs::write(&src, input)
            .map_err(|e| FileError::other(format!("could not stage the file: {e}")))?;
        run_with_limit(app, limit, {
            let (src, out) = (src.clone(), out.clone());
            move |before| com::run(app, job, &src, &out, &before)
        })?;
        fs::read(&out)
            .map_err(|_| FileError::other(format!("{} did not write the file", app.name())))
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

/// Runs `work` on its own thread. `work` gets the Office process ids that were running
/// before, so it can tell whether it started its own process (and may Quit it). Past
/// `limit`, processes started since are killed and an error returned; a process the
/// user already had open is left alone.
fn run_with_limit(
    app: App,
    limit: Duration,
    work: impl FnOnce(Vec<u32>) -> Result<(), FileError> + Send + 'static,
) -> Result<(), FileError> {
    let before = procs::pids(app.exe());
    let (tx, rx) = std::sync::mpsc::channel();
    let seen = before.clone();
    std::thread::spawn(move || {
        let _ = tx.send(work(seen));
    });
    match rx.recv_timeout(limit) {
        Ok(r) => r,
        Err(_) => {
            let started: Vec<u32> = procs::pids(app.exe())
                .into_iter()
                .filter(|p| !before.contains(p))
                .collect();
            for pid in &started {
                procs::kill(*pid);
            }
            // Give the worker a moment to see the dead process and let go of the files.
            let _ = rx.recv_timeout(Duration::from_secs(10));
            Err(FileError::other(format!(
                "{} did not finish within {} minutes{}",
                app.name(),
                limit.as_secs() / 60,
                if started.is_empty() {
                    " (close any open message in it and try again)"
                } else {
                    " and was closed"
                }
            )))
        }
    }
}

#[cfg(windows)]
fn installed(app: App) -> bool {
    registry::local_server(app.prog_id())
        .and_then(|cmd| exe_from_command(&cmd))
        .is_some_and(|exe| exe.is_file())
}

#[cfg(not(windows))]
fn installed(_app: App) -> bool {
    false
}

#[cfg(windows)]
mod registry {
    use windows::Win32::System::Registry::{
        HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW,
    };
    use windows::core::HSTRING;

    fn default_value(key: &str) -> Option<String> {
        let mut buf = [0u16; 1024];
        let mut size = (buf.len() * 2) as u32;
        // SAFETY: buf and size describe a valid writable buffer; the value name is null
        // (the key's default value).
        let ok = unsafe {
            RegGetValueW(
                HKEY_CLASSES_ROOT,
                &HSTRING::from(key),
                None,
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
        Some(String::from_utf16_lossy(&buf[..len]))
    }

    /// The LocalServer32 command line of a ProgID's COM class.
    pub fn local_server(prog_id: &str) -> Option<String> {
        let clsid = default_value(&format!(r"{prog_id}\CLSID"))?;
        default_value(&format!(r"CLSID\{}\LocalServer32", clsid.trim()))
    }

    /// A per-user DWORD value, if it is there.
    pub fn user_dword(key: &str, name: &str) -> Option<u32> {
        let mut v = 0u32;
        let mut size = 4u32;
        // SAFETY: v and size describe a valid 4-byte buffer.
        let ok = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(key),
                &HSTRING::from(name),
                RRF_RT_REG_DWORD,
                None,
                Some((&mut v as *mut u32).cast()),
                Some(&mut size),
            )
        };
        ok.is_ok().then_some(v)
    }

    /// Sets a per-user DWORD value, creating the key if needed.
    pub fn set_user_dword(key: &str, name: &str, v: u32) -> bool {
        // SAFETY: the data pointer and length describe `v`.
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(key),
                &HSTRING::from(name),
                REG_DWORD.0,
                Some((&v as *const u32).cast()),
                4,
            )
        }
        .is_ok()
    }

    pub fn delete_user_value(key: &str, name: &str) {
        // SAFETY: plain strings in; a missing value is not an error we care about.
        let _ = unsafe {
            RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(name))
        };
    }
}

/// Word asks "Word will now convert your PDF..." before opening a PDF, even with alerts
/// off, and a hidden Word waits on that message until the time limit. The per-user Word
/// option behind its "Don't show this message again" box is turned on for the export and
/// put back as it was when this is dropped (also after a timeout).
struct PdfPromptOff {
    key: &'static str,
    /// The value before, when this changed it: `Some(None)` means there was none.
    was: Option<Option<u32>>,
}

const WORD_OPTIONS: &str = r"Software\Microsoft\Office\16.0\Word\Options";
const PDF_WARNING: &str = "DisableConvertPdfWarning";

impl PdfPromptOff {
    #[cfg(windows)]
    fn new(key: &'static str) -> Self {
        let before = registry::user_dword(key, PDF_WARNING);
        let was =
            (before != Some(1) && registry::set_user_dword(key, PDF_WARNING, 1)).then_some(before);
        Self { key, was }
    }

    #[cfg(not(windows))]
    fn new(key: &'static str) -> Self {
        Self { key, was: None }
    }
}

impl Drop for PdfPromptOff {
    fn drop(&mut self) {
        #[cfg(windows)]
        match self.was {
            None => {}
            Some(None) => registry::delete_user_value(self.key, PDF_WARNING),
            Some(Some(v)) => {
                registry::set_user_dword(self.key, PDF_WARNING, v);
            }
        }
    }
}

#[cfg(windows)]
mod procs {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_TERMINATE, TerminateProcess};

    /// Process ids running `exe` (file name, case-insensitive).
    pub fn pids(exe: &str) -> Vec<u32> {
        let mut out = Vec::new();
        // SAFETY: the snapshot handle is closed below; entry has dwSize set as required.
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return out;
            };
            let mut e = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            let mut ok = Process32FirstW(snap, &mut e).is_ok();
            while ok {
                let len = e
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(e.szExeFile.len());
                if String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case(exe) {
                    out.push(e.th32ProcessID);
                }
                ok = Process32NextW(snap, &mut e).is_ok();
            }
            let _ = CloseHandle(snap);
        }
        out
    }

    pub fn kill(pid: u32) {
        // SAFETY: the handle is closed after use; a failed open is ignored.
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(h, 1);
                let _ = CloseHandle(h);
            }
        }
    }
}

#[cfg(not(windows))]
mod procs {
    pub fn pids(_exe: &str) -> Vec<u32> {
        Vec::new()
    }
    pub fn kill(_pid: u32) {}
}

#[cfg(windows)]
mod com {
    use super::{App, Job};
    use crate::fileio::FileError;
    use std::mem::ManuallyDrop;
    use std::path::Path;
    use windows::Win32::Foundation::{VARIANT_FALSE, VARIANT_TRUE};
    use windows::Win32::System::Com::{
        CLSCTX, CLSCTX_LOCAL_SERVER, CLSIDFromProgID, COINIT_APARTMENTTHREADED, CoCreateInstance,
        CoInitializeEx, CoUninitialize, DISPATCH_FLAGS, DISPATCH_METHOD, DISPATCH_PROPERTYGET,
        DISPATCH_PROPERTYPUT, DISPPARAMS, EXCEPINFO, IDispatch,
    };
    use windows::Win32::System::Ole::DISPID_PROPERTYPUT;
    use windows::Win32::System::Variant::{
        VARIANT, VT_BOOL, VT_BSTR, VT_DISPATCH, VT_I4, VariantClear,
    };
    use windows::core::{BSTR, GUID, HSTRING, PCWSTR};

    /// English names and numbers, whatever the Windows language (Excel cares).
    const LCID_EN_US: u32 = 0x0409;
    const WRONG_PASSWORD: &str = "pdfwb-no-password";

    pub enum Arg<'a> {
        Str(&'a str),
        Int(i32),
        Bool(bool),
    }

    fn variant(a: &Arg) -> VARIANT {
        let mut v = VARIANT::default();
        // SAFETY: we set the tag and the matching union member of a zeroed VARIANT.
        unsafe {
            let inner = &mut *v.Anonymous.Anonymous;
            match a {
                Arg::Str(s) => {
                    inner.vt = VT_BSTR;
                    inner.Anonymous.bstrVal = ManuallyDrop::new(BSTR::from(*s));
                }
                Arg::Int(n) => {
                    inner.vt = VT_I4;
                    inner.Anonymous.lVal = *n;
                }
                Arg::Bool(b) => {
                    inner.vt = VT_BOOL;
                    inner.Anonymous.boolVal = if *b { VARIANT_TRUE } else { VARIANT_FALSE };
                }
            }
        }
        v
    }

    /// An automation object, called by member and argument names.
    pub struct Disp(pub IDispatch);

    impl Disp {
        pub fn create(prog_id: &str, ctx: CLSCTX) -> windows::core::Result<Disp> {
            // SAFETY: plain COM calls on this (STA) thread.
            unsafe {
                let clsid = CLSIDFromProgID(&HSTRING::from(prog_id))?;
                Ok(Disp(CoCreateInstance(&clsid, None, ctx)?))
            }
        }

        fn invoke(
            &self,
            name: &str,
            flags: DISPATCH_FLAGS,
            args: &[(&str, Arg)],
        ) -> Result<VARIANT, String> {
            // A property put passes its value under DISPID_PROPERTYPUT, not by name.
            let put = flags == DISPATCH_PROPERTYPUT;
            let names: Vec<HSTRING> = std::iter::once(name)
                .chain(args.iter().filter(|_| !put).map(|(n, _)| *n))
                .map(HSTRING::from)
                .collect();
            let ptrs: Vec<PCWSTR> = names.iter().map(|h| PCWSTR(h.as_ptr())).collect();
            let mut ids = vec![0i32; ptrs.len()];
            // SAFETY: ptrs and ids have the same length; the strings outlive the call.
            unsafe {
                self.0.GetIDsOfNames(
                    &GUID::zeroed(),
                    ptrs.as_ptr(),
                    ptrs.len() as u32,
                    LCID_EN_US,
                    ids.as_mut_ptr(),
                )
            }
            .map_err(|_| format!("{name}: unknown member or argument name"))?;
            let mut vars: Vec<VARIANT> = args.iter().map(|(_, a)| variant(a)).collect();
            let mut named: Vec<i32> = if put {
                vec![DISPID_PROPERTYPUT]
            } else {
                ids[1..].to_vec()
            };
            let params = DISPPARAMS {
                rgvarg: vars.as_mut_ptr(),
                rgdispidNamedArgs: named.as_mut_ptr(),
                cArgs: vars.len() as u32,
                cNamedArgs: named.len() as u32,
            };
            let mut result = VARIANT::default();
            let mut excep = EXCEPINFO::default();
            // SAFETY: params points at live vectors; result and excep are cleared below.
            let r = unsafe {
                self.0.Invoke(
                    ids[0],
                    &GUID::zeroed(),
                    LCID_EN_US,
                    flags,
                    &params,
                    Some(&mut result),
                    Some(&mut excep),
                    None,
                )
            };
            for v in &mut vars {
                // SAFETY: each VARIANT was built by `variant` and is cleared once.
                let _ = unsafe { VariantClear(v) };
            }
            let description = excep.bstrDescription.to_string();
            // SAFETY: the BSTRs in EXCEPINFO are ours to free.
            unsafe {
                ManuallyDrop::drop(&mut excep.bstrSource);
                ManuallyDrop::drop(&mut excep.bstrDescription);
                ManuallyDrop::drop(&mut excep.bstrHelpFile);
            }
            match r {
                Ok(()) => Ok(result),
                Err(e) => Err(if description.is_empty() {
                    format!("{name} failed ({:#010x})", e.code().0)
                } else {
                    description
                }),
            }
        }

        pub fn call(&self, name: &str, args: &[(&str, Arg)]) -> Result<(), String> {
            let mut v = self.invoke(name, DISPATCH_METHOD | DISPATCH_PROPERTYGET, args)?;
            // SAFETY: the result VARIANT is ours.
            let _ = unsafe { VariantClear(&mut v) };
            Ok(())
        }

        /// A method or property that returns an object.
        pub fn object(&self, name: &str, args: &[(&str, Arg)]) -> Result<Disp, String> {
            let mut v = self.invoke(name, DISPATCH_METHOD | DISPATCH_PROPERTYGET, args)?;
            // SAFETY: read the tag, clone the interface if it is one, then clear.
            let d = unsafe {
                let inner = &v.Anonymous.Anonymous;
                if inner.vt == VT_DISPATCH {
                    (*inner.Anonymous.pdispVal).clone()
                } else {
                    None
                }
            };
            let _ = unsafe { VariantClear(&mut v) };
            d.map(Disp)
                .ok_or_else(|| format!("{name} returned no object"))
        }

        #[cfg(test)]
        pub fn get_i32(&self, name: &str) -> Result<i32, String> {
            let mut v = self.invoke(name, DISPATCH_PROPERTYGET, &[])?;
            // SAFETY: read the tag and the matching member, then clear.
            let n = unsafe {
                let inner = &v.Anonymous.Anonymous;
                (inner.vt == VT_I4).then(|| inner.Anonymous.lVal)
            };
            let _ = unsafe { VariantClear(&mut v) };
            n.ok_or_else(|| format!("{name} is not a number"))
        }

        pub fn put(&self, name: &str, value: Arg) -> Result<(), String> {
            let mut v = self.invoke(name, DISPATCH_PROPERTYPUT, &[("", value)])?;
            // SAFETY: the result VARIANT is ours.
            let _ = unsafe { VariantClear(&mut v) };
            Ok(())
        }
    }

    /// One conversion on this thread. Office is quit at the end only if a new process
    /// appeared (not in `before`) when it was created: PowerPoint attaches to one the
    /// user has open.
    pub fn run(
        app: App,
        job: Job,
        src: &Path,
        out: &Path,
        before: &[u32],
    ) -> Result<(), FileError> {
        // SAFETY: balanced by CoUninitialize below; this thread does nothing else.
        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if init.is_err() {
            return Err(FileError::other("could not start COM"));
        }
        let result = (|| {
            let office = Disp::create(app.prog_id(), CLSCTX_LOCAL_SERVER)
                .map_err(|_| format!("could not start Microsoft {}", app.name()))?;
            let ours = super::procs::pids(app.exe())
                .iter()
                .any(|p| !before.contains(p));
            let r = work(app, job, &office, src, out);
            if ours {
                let _ = match app {
                    App::Word => office.call("Quit", &[("SaveChanges", Arg::Int(0))]),
                    _ => office.call("Quit", &[]),
                };
            }
            r
        })();
        // SAFETY: matches the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
        result.map_err(|m| FileError::other(format!("{}: {m}", app.name())))
    }

    fn work(app: App, job: Job, office: &Disp, src: &Path, out: &Path) -> Result<(), String> {
        let src = src.to_string_lossy();
        let out = out.to_string_lossy();
        // Macros never run in files we open.
        office.put("AutomationSecurity", Arg::Int(3))?;
        match app {
            App::Word => {
                office.put("Visible", Arg::Bool(false))?;
                office.put("DisplayAlerts", Arg::Int(0))?;
                let doc = office.object("Documents", &[])?.object(
                    "Open",
                    &[
                        ("FileName", Arg::Str(&src)),
                        ("ConfirmConversions", Arg::Bool(false)),
                        ("ReadOnly", Arg::Bool(true)),
                        ("AddToRecentFiles", Arg::Bool(false)),
                        // Protected files fail at once instead of asking for a password.
                        ("PasswordDocument", Arg::Str(WRONG_PASSWORD)),
                        ("Visible", Arg::Bool(false)),
                        ("NoEncodingDialog", Arg::Bool(true)),
                    ],
                )?;
                let r = match job {
                    Job::ToPdf => doc.call(
                        "ExportAsFixedFormat",
                        &[
                            ("OutputFileName", Arg::Str(&out)),
                            ("ExportFormat", Arg::Int(17)),
                            ("OpenAfterExport", Arg::Bool(false)),
                            ("IncludeDocProps", Arg::Bool(true)),
                            ("CreateBookmarks", Arg::Int(1)),
                            ("DocStructureTags", Arg::Bool(true)),
                        ],
                    ),
                    Job::PdfToDocx => doc.call(
                        "SaveAs2",
                        &[("FileName", Arg::Str(&out)), ("FileFormat", Arg::Int(16))],
                    ),
                };
                let _ = doc.call("Close", &[("SaveChanges", Arg::Int(0))]);
                r
            }
            App::Excel => {
                office.put("Visible", Arg::Bool(false))?;
                office.put("DisplayAlerts", Arg::Bool(false))?;
                let _ = office.put("AskToUpdateLinks", Arg::Bool(false));
                let book = office.object("Workbooks", &[])?.object(
                    "Open",
                    &[
                        ("FileName", Arg::Str(&src)),
                        ("UpdateLinks", Arg::Int(0)),
                        ("ReadOnly", Arg::Bool(true)),
                        ("Password", Arg::Str(WRONG_PASSWORD)),
                        ("IgnoreReadOnlyRecommended", Arg::Bool(true)),
                        ("Notify", Arg::Bool(false)),
                        ("AddToMru", Arg::Bool(false)),
                    ],
                )?;
                let r = book.call(
                    "ExportAsFixedFormat",
                    &[
                        ("Type", Arg::Int(0)),
                        ("FileName", Arg::Str(&out)),
                        ("Quality", Arg::Int(0)),
                        ("IncludeDocProperties", Arg::Bool(true)),
                        ("IgnorePrintAreas", Arg::Bool(false)),
                        ("OpenAfterPublish", Arg::Bool(false)),
                    ],
                );
                let _ = book.call("Close", &[("SaveChanges", Arg::Bool(false))]);
                r
            }
            App::PowerPoint => {
                // PowerPoint starts with alerts off and refuses Visible = false; the
                // presentation opens without a window instead.
                let pres = office.object("Presentations", &[])?.object(
                    "Open",
                    &[
                        ("FileName", Arg::Str(&src)),
                        ("ReadOnly", Arg::Int(-1)),
                        ("Untitled", Arg::Int(0)),
                        ("WithWindow", Arg::Int(0)),
                    ],
                )?;
                let r = pres.call(
                    "SaveAs",
                    &[("FileName", Arg::Str(&out)), ("FileFormat", Arg::Int(32))],
                );
                let _ = pres.call("Close", &[]);
                r
            }
        }
    }

    #[cfg(test)]
    pub fn in_sta<T>(f: impl FnOnce() -> T) -> T {
        // SAFETY: balanced below.
        let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        let r = f();
        unsafe { CoUninitialize() };
        r
    }
}

#[cfg(not(windows))]
mod com {
    use super::{App, Job};
    use crate::fileio::FileError;
    use std::path::Path;
    pub fn run(_: App, _: Job, _: &Path, _: &Path, _: &[u32]) -> Result<(), FileError> {
        Err(FileError::other("Office conversion needs Windows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_office_app_by_extension() {
        assert_eq!(app_for(Path::new(r"C:\a\Return.DOCX")), Some(App::Word));
        assert_eq!(app_for(Path::new("tb.xlsx")), Some(App::Excel));
        assert_eq!(app_for(Path::new("data.csv")), Some(App::Excel));
        assert_eq!(app_for(Path::new("deck.pptx")), Some(App::PowerPoint));
        assert_eq!(app_for(Path::new("scan.pdf")), None);
        assert_eq!(app_for(Path::new("noext")), None);
    }

    #[test]
    fn reads_the_program_from_a_local_server_command() {
        assert_eq!(
            exe_from_command(
                r#""C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE" /Automation"#
            ),
            Some(PathBuf::from(
                r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE"
            ))
        );
        assert_eq!(
            exe_from_command(
                r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE /automation"
            ),
            Some(PathBuf::from(
                r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE"
            ))
        );
        assert_eq!(exe_from_command("no program here"), None);
    }

    #[cfg(windows)]
    #[test]
    fn calls_automation_objects_by_name() {
        use com::{Arg, Disp};
        use windows::Win32::System::Com::CLSCTX_ALL;
        // Scripting.Dictionary ships with Windows: a stand-in for Office's objects.
        com::in_sta(|| {
            let Ok(d) = Disp::create("Scripting.Dictionary", CLSCTX_ALL) else {
                eprintln!("Scripting.Dictionary not available; skipped");
                return;
            };
            d.put("CompareMode", Arg::Int(1)).unwrap();
            d.call("Add", &[("Key", Arg::Str("a")), ("Item", Arg::Int(1))])
                .unwrap();
            d.call("Add", &[("Item", Arg::Bool(true)), ("Key", Arg::Str("b"))])
                .unwrap();
            assert_eq!(d.get_i32("Count").unwrap(), 2);
            assert_eq!(d.get_i32("CompareMode").unwrap(), 1);
            // A duplicate key raises the object's own error text.
            let e = d
                .call("Add", &[("Key", Arg::Str("A")), ("Item", Arg::Int(2))])
                .unwrap_err();
            assert!(!e.is_empty());
            assert!(d.call("NoSuchMethod", &[]).is_err());
        });
    }

    #[cfg(windows)]
    #[test]
    fn a_conversion_past_its_limit_is_reported() {
        // A stand-in worker that never finishes; no Office process is involved, so
        // nothing is killed and the message says so.
        let r = run_with_limit(App::PowerPoint, Duration::from_millis(200), |_| {
            std::thread::sleep(Duration::from_secs(1));
            Ok(())
        });
        let e = r.unwrap_err();
        assert!(e.message.contains("did not finish"), "{}", e.message);
    }

    #[cfg(windows)]
    #[cfg(windows)]
    #[test]
    fn word_pdf_prompt_is_turned_off_then_put_back() {
        // A throwaway key stands in for Word's options.
        const KEY: &str = r"Software\PDFWorkbenchTest\Word\Options";
        let get = || registry::user_dword(KEY, PDF_WARNING);
        registry::delete_user_value(KEY, PDF_WARNING);
        {
            let _off = PdfPromptOff::new(KEY);
            assert_eq!(get(), Some(1));
        }
        assert_eq!(get(), None, "a value that was not there is removed again");

        registry::set_user_dword(KEY, PDF_WARNING, 0);
        drop(PdfPromptOff::new(KEY));
        assert_eq!(get(), Some(0), "the user's own value comes back");

        registry::set_user_dword(KEY, PDF_WARNING, 1);
        drop(PdfPromptOff::new(KEY));
        assert_eq!(get(), Some(1), "already off: left alone");
        let _ = std::process::Command::new("reg")
            .args(["delete", r"HKCU\Software\PDFWorkbenchTest", "/f"])
            .output();
    }

    #[test]
    fn lists_and_kills_processes_by_program_name() {
        let mut child = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        assert!(procs::pids("PING.EXE").contains(&child.id()));
        procs::kill(child.id());
        let status = child.wait().unwrap();
        assert!(!status.success());
    }

    /// Runs only where desktop Word or Excel is installed (not on the build PC).
    #[cfg(windows)]
    #[test]
    fn converts_with_installed_office() {
        let mut ran = false;
        if installed(App::Word) {
            let rtf = br"{\rtf1\ansi Synthetic letter for PDF Workbench.\par}";
            let pdf = convert(App::Word, Job::ToPdf, rtf, "rtf", Duration::from_secs(120)).unwrap();
            assert!(pdf.starts_with(b"%PDF"));
            let docx = convert(
                App::Word,
                Job::PdfToDocx,
                &pdf,
                "pdf",
                Duration::from_secs(120),
            )
            .unwrap();
            assert!(docx.starts_with(b"PK"));
            ran = true;
        }
        if installed(App::Excel) {
            let csv = b"Account,Amount\r\nCash,100\r\n";
            let pdf =
                convert(App::Excel, Job::ToPdf, csv, "csv", Duration::from_secs(120)).unwrap();
            assert!(pdf.starts_with(b"%PDF"));
            ran = true;
        }
        if !ran {
            eprintln!("desktop Office not installed; skipped");
        }
    }
}
