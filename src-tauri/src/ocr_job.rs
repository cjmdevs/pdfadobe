//! Tesseract as the OCR engine for the frontend (src/engine/ocr/tesseract.ts).
//!
//! Same framing and job-folder rules as `qpdf_job`: one IPC call per job, a fresh temp
//! folder per job, always deleted afterwards, plain file names only. The header also
//! carries the job `id`, so `ocr_cancel` can kill a job that is still running.
//! Recognised text never reaches a log or a message: only Tesseract's first setup error
//! line (stderr, which never holds page text) is passed on, without folder paths.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::fileio::FileError;
use crate::qpdf_job::{JobHeader, encode_result, job_dir, job_inputs, split_frame};

/// Running jobs by id. `ocr_cancel` kills the child; the waiting job then reports it.
#[derive(Default)]
pub struct OcrJobs(Arc<Mutex<HashMap<u64, Child>>>);

pub fn tesseract_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| plain_path(&d.join("tesseract")))
        .filter(|d| d.join("tesseract.exe").is_file())
}

/// `\\?\C:\x` -> `C:\x` and `\\?\UNC\server\share` -> `\\server\share`. Tesseract and
/// Leptonica cannot open files under a verbatim path (it fails with exit 1), and the
/// installed app's resource folder can come back in that form.
pub fn plain_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

/// Tesseract's first real error line ("Failed loading language 'eng'"), without folder
/// paths. Its stderr carries setup errors only, never recognised text. Leptonica's
/// notes about image formats this build leaves out are skipped.
fn reason(stderr: &str, dir: &Path) -> Option<String> {
    stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .find(|l| {
            !l.contains("function not present")
                && !l.contains("no pix returned")
                && !l.contains("pixa")
                && !l.starts_with("Warning")
                && !l.starts_with("Estimating resolution")
        })
        .map(|l| {
            l.replace(&*dir.to_string_lossy(), "")
                .chars()
                .take(200)
                .collect()
        })
}

#[tauri::command]
pub async fn ocr_run(
    app: AppHandle,
    jobs: tauri::State<'_, OcrJobs>,
    request: Request<'_>,
) -> Result<Response, FileError> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected a raw OCR job".into());
    };
    let dir = tesseract_dir(&app).ok_or(FileError {
        kind: "ocrMissing",
        message: "Tesseract is missing from this installation".into(),
    })?;
    let body = body.clone();
    let running = jobs.0.clone();
    tauri::async_runtime::spawn_blocking(move || run_frame(&dir, &running, &body))
        .await
        .map_err(|e| FileError::other(e.to_string()))?
        .map(Response::new)
}

#[tauri::command]
pub fn ocr_cancel(jobs: tauri::State<'_, OcrJobs>, id: u64) {
    if let Some(child) = jobs.0.lock().unwrap().get_mut(&id) {
        let _ = child.kill();
    }
}

/// Decodes a request frame, runs the job, and encodes the response frame.
pub fn run_frame(
    tess_dir: &Path,
    running: &Mutex<HashMap<u64, Child>>,
    body: &[u8],
) -> Result<Vec<u8>, FileError> {
    let (header, data) = split_frame(body)?;
    check_job(&header)?;
    let inputs = job_inputs(&header, data)?;
    let (stdout, files) = run_job(tess_dir, running, &header, &inputs)?;
    encode_result(stdout, false, files)
}

fn valid_file(n: &str) -> bool {
    n.rsplit_once('.').is_some_and(|(stem, ext)| {
        matches!(ext, "pgm" | "pdf" | "txt" | "tsv" | "osd") && valid_base(stem)
    })
}

fn valid_base(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 64
        && n.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn valid_option(flag: &str, value: &str) -> bool {
    match flag {
        "-l" => matches!(value, "eng" | "osd"),
        "-c" => {
            let Some((key, v)) = value.split_once('=') else {
                return false;
            };
            matches!(
                key,
                "textonly_pdf"
                    | "tessedit_create_pdf"
                    | "tessedit_create_txt"
                    | "tessedit_create_tsv"
            ) && matches!(v, "0" | "1")
        }
        "--psm" | "--oem" | "--dpi" => {
            !value.is_empty() && value.len() <= 4 && value.chars().all(|c| c.is_ascii_digit())
        }
        _ => false,
    }
}

/// Same rules as `checkOcrJob` in tesseract.ts: plain job file names, `in out` first,
/// then only allowlisted option pairs. No config files, no paths.
pub fn check_job(h: &JobHeader) -> Result<(), FileError> {
    for n in h
        .inputs
        .iter()
        .map(|f| f.name.as_str())
        .chain(h.outputs.iter().map(String::as_str))
    {
        if !valid_file(n) {
            return Err(FileError::other(format!("invalid job file name: {n}")));
        }
    }
    let (Some(input), Some(base)) = (h.args.first(), h.args.get(1)) else {
        return Err("a job starts with an input file and an output name".into());
    };
    if !valid_file(input) || !valid_base(base) {
        return Err("a job starts with an input file and an output name".into());
    }
    let rest = &h.args[2..];
    for pair in rest.chunks(2) {
        let flag = pair.first().map(String::as_str).unwrap_or("");
        let value = pair.get(1).map(String::as_str).unwrap_or("");
        if !valid_option(flag, value) {
            return Err(FileError::other(format!(
                "invalid tesseract argument: {flag} {value}"
            )));
        }
    }
    Ok(())
}

type JobOutput = (String, Vec<(String, Vec<u8>)>);

fn run_job(
    tess_dir: &Path,
    running: &Mutex<HashMap<u64, Child>>,
    header: &JobHeader,
    inputs: &[(&str, &[u8])],
) -> Result<JobOutput, FileError> {
    let dir = job_dir("ocr")?;
    let result = (|| {
        for (name, bytes) in inputs {
            fs::write(dir.join(name), bytes)
                .map_err(|e| FileError::other(format!("could not stage an OCR input: {e}")))?;
        }
        let mut cmd = Command::new(tess_dir.join("tesseract.exe"));
        cmd.args(&header.args)
            .arg("--tessdata-dir")
            .arg(tess_dir.join("tessdata"))
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| FileError {
            kind: "ocrMissing",
            message: format!("could not run Tesseract: {e}"),
        })?;
        let read_all = |mut pipe: Option<Box<dyn Read + Send>>| {
            std::thread::spawn(move || {
                let mut s = String::new();
                if let Some(p) = pipe.as_mut() {
                    let _ = p.read_to_string(&mut s);
                }
                s
            })
        };
        let reader = read_all(
            child
                .stdout
                .take()
                .map(|p| Box::new(p) as Box<dyn Read + Send>),
        );
        let errors = read_all(
            child
                .stderr
                .take()
                .map(|p| Box::new(p) as Box<dyn Read + Send>),
        );
        running.lock().unwrap().insert(header.id, child);
        // Poll, so ocr_cancel can take the lock and kill the child meanwhile.
        let status = loop {
            let mut map = running.lock().unwrap();
            let Some(c) = map.get_mut(&header.id) else {
                break None;
            };
            match c.try_wait() {
                Ok(Some(s)) => {
                    map.remove(&header.id);
                    break Some(s);
                }
                Ok(None) => {}
                Err(_) => {
                    map.remove(&header.id);
                    break None;
                }
            }
            drop(map);
            std::thread::sleep(Duration::from_millis(20));
        };
        let stdout = reader.join().unwrap_or_default();
        let stderr = errors.join().unwrap_or_default();
        let status = status.ok_or("OCR failed")?;
        if !status.success() {
            // Killed by ocr_cancel (exit code 1 on Windows) or a real failure; the
            // frontend knows which, since it asked for the cancel.
            let why = reason(&stderr, tess_dir)
                .map(|r| format!(": {}", r.replace(&*dir.to_string_lossy(), "")))
                .unwrap_or_default();
            return Err(FileError {
                kind: "ocrFailed",
                message: format!(
                    "Tesseract stopped (exit {}){why}",
                    status.code().unwrap_or(-1)
                ),
            });
        }
        let mut files = Vec::new();
        for o in &header.outputs {
            if let Ok(b) = fs::read(dir.join(o)) {
                files.push((o.clone(), b));
            }
        }
        Ok((stdout, files))
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qpdf_job::FileEntry;

    fn tess() -> Option<PathBuf> {
        let d = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/tesseract");
        d.join("tesseract.exe").is_file().then_some(d)
    }

    fn header(id: u64, args: &[&str], inputs: &[&str], outputs: &[&str]) -> JobHeader {
        JobHeader {
            id,
            args: args.iter().map(|s| s.to_string()).collect(),
            outputs: outputs.iter().map(|s| s.to_string()).collect(),
            inputs: inputs
                .iter()
                .map(|n| FileEntry {
                    name: n.to_string(),
                    size: 0,
                })
                .collect(),
        }
    }

    #[test]
    fn allows_only_plain_names_and_listed_options() {
        let ok = header(
            1,
            &[
                "page.pgm",
                "out",
                "-l",
                "eng",
                "--psm",
                "3",
                "-c",
                "textonly_pdf=1",
            ],
            &["page.pgm"],
            &["out.pdf"],
        );
        assert!(check_job(&ok).is_ok());
        for bad in [
            vec!["page.pgm", "out", "-l", "..\\x"],
            vec!["page.pgm", "out", "--tessdata-dir", "C:\\x"],
            vec!["page.pgm", "out", "-c", "tessedit_write_images=1"],
            vec!["page.pgm", "out", "pdf"],
            vec!["page.pgm", "C:\\out"],
            vec!["..\\page.pgm", "out"],
            vec!["page.pgm"],
        ] {
            let h = header(1, &bad, &["page.pgm"], &["out.pdf"]);
            assert!(check_job(&h).is_err(), "{bad:?}");
        }
        for bad in ["Page.pgm", "a/b.pgm", "x.exe", ".pgm"] {
            assert!(check_job(&header(1, &["page.pgm", "out"], &[bad], &[])).is_err());
        }
    }

    /// A tiny white PGM: Tesseract runs, finds nothing, and writes an empty text file.
    fn blank_pgm() -> Vec<u8> {
        let mut b = b"P5\n200 100\n255\n".to_vec();
        b.extend(std::iter::repeat_n(255u8, 200 * 100));
        b
    }

    #[test]
    fn runs_and_cleans_up() {
        let Some(dir) = tess() else {
            eprintln!("skipped: needs `node scripts/build-tesseract.mjs`");
            return;
        };
        let pgm = blank_pgm();
        let h = header(
            7,
            &[
                "page.pgm",
                "out",
                "-l",
                "eng",
                "-c",
                "tessedit_create_txt=1",
            ],
            &["page.pgm"],
            &["out.txt"],
        );
        let running = Mutex::new(HashMap::new());
        let (_, files) = run_job(&dir, &running, &h, &[("page.pgm", &pgm)]).unwrap();
        assert_eq!(files[0].0, "out.txt");
        assert!(running.lock().unwrap().is_empty());
    }

    #[test]
    fn verbatim_paths_are_made_plain() {
        assert_eq!(
            plain_path(Path::new(
                r"\\?\C:\Users\x\AppData\Local\PDF Workbench\tesseract"
            )),
            PathBuf::from(r"C:\Users\x\AppData\Local\PDF Workbench\tesseract")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share\t")),
            PathBuf::from(r"\\server\share\t")
        );
        assert_eq!(plain_path(Path::new(r"C:\a b")), PathBuf::from(r"C:\a b"));
    }

    #[test]
    fn a_failure_says_why_without_paths() {
        let Some(dir) = tess() else {
            eprintln!("skipped: needs `node scripts/build-tesseract.mjs`");
            return;
        };
        // A copy with no language data: Tesseract cannot load "eng".
        let empty = std::env::temp_dir().join(format!("pdfwb-notess-{}", std::process::id()));
        fs::create_dir_all(empty.join("tessdata")).unwrap();
        fs::copy(dir.join("tesseract.exe"), empty.join("tesseract.exe")).unwrap();
        let h = header(3, &["page.pgm", "out", "-l", "eng"], &["page.pgm"], &[]);
        let running = Mutex::new(HashMap::new());
        let err = run_job(&empty, &running, &h, &[("page.pgm", &blank_pgm())]).unwrap_err();
        let _ = fs::remove_dir_all(&empty);
        assert!(err.message.contains("eng"), "{}", err.message);
        assert!(!err.message.contains("pdfwb-notess"), "{}", err.message);
    }

    /// The installed app's folder can come back as \\?\C:\...: still runs.
    #[test]
    fn runs_from_a_verbatim_folder() {
        let Some(dir) = tess() else {
            eprintln!("skipped: needs `node scripts/build-tesseract.mjs`");
            return;
        };
        let verbatim = PathBuf::from(format!(r"\\?\{}", dir.display()));
        let h = header(
            4,
            &[
                "page.pgm",
                "out",
                "-l",
                "eng",
                "-c",
                "tessedit_create_txt=1",
            ],
            &["page.pgm"],
            &["out.txt"],
        );
        let running = Mutex::new(HashMap::new());
        let r = run_job(
            &plain_path(&verbatim),
            &running,
            &h,
            &[("page.pgm", &blank_pgm())],
        );
        assert!(r.is_ok(), "{:?}", r.err().map(|e| e.message));
    }

    #[test]
    fn cancel_kills_a_running_job() {
        let Some(dir) = tess() else {
            eprintln!("skipped: needs `node scripts/build-tesseract.mjs`");
            return;
        };
        // A large blank page keeps Tesseract busy long enough to be cancelled.
        let mut pgm = b"P5\n6000 8000\n255\n".to_vec();
        pgm.extend(std::iter::repeat_n(255u8, 6000 * 8000));
        let h = header(9, &["page.pgm", "out", "-l", "eng"], &["page.pgm"], &[]);
        let running: Arc<Mutex<HashMap<u64, Child>>> = Arc::new(Mutex::new(HashMap::new()));
        let r2 = running.clone();
        let killer = std::thread::spawn(move || {
            for _ in 0..500 {
                if let Some(c) = r2.lock().unwrap().get_mut(&9) {
                    let _ = c.kill();
                    return true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            false
        });
        let res = run_job(&dir, &running, &h, &[("page.pgm", &pgm)]);
        assert!(killer.join().unwrap(), "job never showed up as running");
        assert_eq!(res.unwrap_err().kind, "ocrFailed");
        assert!(running.lock().unwrap().is_empty());
    }
}
