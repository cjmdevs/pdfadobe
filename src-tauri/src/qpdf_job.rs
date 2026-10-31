//! qpdf as the page-assembly engine for the frontend (src/engine/pages/qpdf.ts).
//!
//! One IPC call per job. Request body (raw bytes):
//!   u32 big-endian header length | header JSON | input files, concatenated
//! where the header is `{ "args": [...], "outputs": [...], "inputs": [{ "name", "size" }] }`.
//! Response body, same framing: `{ "stdout", "warnings", "files": [{ "name", "size" }] }`
//! followed by the output files.
//!
//! Every job runs in its own new temp folder, which is always deleted afterwards. File
//! names are plain lowercase names and arguments cannot contain paths, so a job can never
//! read or write anything outside its folder (same rules as `checkJob` in qpdf.ts).
//! Document contents never reach a log.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::fileio::FileError;
use crate::repair::qpdf_path;

#[derive(Debug, Deserialize)]
pub struct JobHeader {
    /// Only OCR jobs carry one (to cancel them); qpdf jobs leave it out.
    #[serde(default)]
    pub id: u64,
    pub args: Vec<String>,
    pub outputs: Vec<String>,
    pub inputs: Vec<FileEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub size: usize,
}

#[derive(Debug, Serialize)]
struct ResultHeader {
    stdout: String,
    warnings: bool,
    files: Vec<FileEntry>,
}

#[tauri::command]
pub async fn qpdf_run(app: AppHandle, request: Request<'_>) -> Result<Response, FileError> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected a raw qpdf job".into());
    };
    let qpdf = qpdf_path(&app);
    let out = run_frame(&qpdf, body)?;
    Ok(Response::new(out))
}

/// Decodes a request frame, runs the job, and encodes the response frame.
pub fn run_frame(qpdf: &Path, body: &[u8]) -> Result<Vec<u8>, FileError> {
    let (header, data): (JobHeader, &[u8]) = split_frame(body)?;
    check_job(&header)?;
    let inputs = job_inputs(&header, data)?;
    let (stdout, warnings, files) = run_job(qpdf, &header.args, &inputs, &header.outputs)?;
    encode_result(stdout, warnings, files)
}

/// Splits a request frame's file bytes by the header's input sizes.
pub(crate) fn job_inputs<'a>(
    header: &'a JobHeader,
    data: &'a [u8],
) -> Result<Vec<(&'a str, &'a [u8])>, FileError> {
    let mut inputs = Vec::new();
    let mut at = 0;
    for f in &header.inputs {
        let end = at + f.size;
        let bytes = data.get(at..end).ok_or("job inputs are truncated")?;
        inputs.push((f.name.as_str(), bytes));
        at = end;
    }
    Ok(inputs)
}

/// Encodes a response frame: header JSON, then the output files.
pub(crate) fn encode_result(
    stdout: String,
    warnings: bool,
    files: Vec<(String, Vec<u8>)>,
) -> Result<Vec<u8>, FileError> {
    let entries = files
        .iter()
        .map(|(name, b)| FileEntry {
            name: name.clone(),
            size: b.len(),
        })
        .collect();
    let head = serde_json::to_vec(&ResultHeader {
        stdout,
        warnings,
        files: entries,
    })
    .map_err(|e| FileError::other(e.to_string()))?;
    let mut out =
        Vec::with_capacity(4 + head.len() + files.iter().map(|f| f.1.len()).sum::<usize>());
    out.extend_from_slice(&(head.len() as u32).to_be_bytes());
    out.extend_from_slice(&head);
    for (_, b) in files {
        out.extend_from_slice(&b);
    }
    Ok(out)
}

pub(crate) fn split_frame(body: &[u8]) -> Result<(JobHeader, &[u8]), FileError> {
    let len = body
        .get(..4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("qpdf job is empty")?;
    let head = body.get(4..4 + len).ok_or("qpdf job header is truncated")?;
    let header: JobHeader =
        serde_json::from_slice(head).map_err(|e| FileError::other(format!("bad qpdf job: {e}")))?;
    Ok((header, &body[4 + len..]))
}

fn valid_name(n: &str) -> bool {
    let Some((stem, ext)) = n.rsplit_once('.') else {
        return false;
    };
    (ext == "pdf" || ext == "json")
        && !stem.is_empty()
        && stem.len() <= 64
        && stem.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && stem
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn has_drive_letter(a: &str) -> bool {
    let b = a.as_bytes();
    let at = |i: usize| b.get(i).copied();
    let drive =
        |i: usize| at(i).is_some_and(|c| c.is_ascii_alphabetic()) && at(i + 1) == Some(b':');
    drive(0) || a.match_indices('=').any(|(i, _)| drive(i + 1))
}

pub fn check_job(h: &JobHeader) -> Result<(), FileError> {
    for n in h
        .inputs
        .iter()
        .map(|f| f.name.as_str())
        .chain(h.outputs.iter().map(String::as_str))
    {
        if !valid_name(n) {
            return Err(FileError::other(format!("invalid job file name: {n}")));
        }
    }
    for a in &h.args {
        if a.starts_with('@') {
            return Err("argument files are not allowed".into());
        }
        if a.contains('/') || a.contains('\\') || a.contains("..") || has_drive_letter(a) {
            return Err(FileError::other(format!("invalid qpdf argument: {a}")));
        }
    }
    Ok(())
}

static JOB_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn job_dir(tool: &str) -> Result<PathBuf, FileError> {
    let d = std::env::temp_dir().join(format!(
        "pdfwb-{tool}-{}-{}",
        std::process::id(),
        JOB_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&d)
        .map_err(|e| FileError::other(format!("could not create a temp folder: {e}")))?;
    Ok(d)
}

type JobOutput = (String, bool, Vec<(String, Vec<u8>)>);

/// Runs qpdf in a fresh folder. Exit 0 and 3 (warnings) succeed; anything else is an error
/// carrying qpdf's first stderr line (object numbers and offsets, never page text).
pub fn run_job(
    qpdf: &Path,
    args: &[String],
    inputs: &[(&str, &[u8])],
    outputs: &[String],
) -> Result<JobOutput, FileError> {
    let dir = job_dir("qpdf")?;
    let result = (|| {
        for (name, bytes) in inputs {
            fs::write(dir.join(name), bytes)
                .map_err(|e| FileError::other(format!("could not stage a qpdf input: {e}")))?;
        }
        let mut cmd = Command::new(qpdf);
        cmd.args(args).current_dir(&dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let out = cmd.output().map_err(|e| FileError {
            kind: "qpdfMissing",
            message: format!("could not run qpdf: {e}"),
        })?;
        let code = out.status.code().unwrap_or(-1);
        if code != 0 && code != 3 {
            let err = String::from_utf8_lossy(&out.stderr);
            let line = err
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("qpdf failed");
            return Err(FileError {
                kind: "qpdfFailed",
                message: line
                    .replace(&dir.to_string_lossy().to_string(), "")
                    .to_string(),
            });
        }
        let mut files = Vec::new();
        for o in outputs {
            if let Ok(b) = fs::read(dir.join(o)) {
                files.push((o.clone(), b));
            }
        }
        Ok((
            String::from_utf8_lossy(&out.stdout).into_owned(),
            code == 3,
            files,
        ))
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Tests that run qpdf take turns, so the leftover-folder count is not racy.
    static QPDF_TESTS: Mutex<()> = Mutex::new(());

    fn test_qpdf() -> Option<PathBuf> {
        let vendor = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/qpdf/qpdf.exe");
        std::env::var_os("QPDF")
            .map(PathBuf::from)
            .into_iter()
            .chain([PathBuf::from("qpdf"), vendor])
            .find(|p| Command::new(p).arg("--version").output().is_ok())
    }

    fn corpus(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/corpus/generated")
            .join(name)
    }

    fn frame(args: &[&str], outputs: &[&str], inputs: &[(&str, &[u8])]) -> Vec<u8> {
        let head = serde_json::json!({
            "args": args,
            "outputs": outputs,
            "inputs": inputs.iter().map(|(n, b)| serde_json::json!({ "name": n, "size": b.len() })).collect::<Vec<_>>(),
        });
        let head = serde_json::to_vec(&head).unwrap();
        let mut out = (head.len() as u32).to_be_bytes().to_vec();
        out.extend(head);
        for (_, b) in inputs {
            out.extend_from_slice(b);
        }
        out
    }

    fn header(args: &[&str], names: &[&str]) -> JobHeader {
        JobHeader {
            id: 0,
            args: args.iter().map(|s| s.to_string()).collect(),
            outputs: vec!["out.pdf".into()],
            inputs: names
                .iter()
                .map(|n| FileEntry {
                    name: n.to_string(),
                    size: 0,
                })
                .collect(),
        }
    }

    #[test]
    fn rejects_paths_and_argfiles() {
        assert!(
            check_job(&header(
                &["in0.pdf", "--rotate=+90:1", "out.pdf"],
                &["in0.pdf"]
            ))
            .is_ok()
        );
        for bad in [
            "C:\\x.pdf",
            "c:x.pdf",
            "..\\x.pdf",
            "/etc/passwd",
            "@args.txt",
            "--update-from-json=D:x.json",
            "\\\\server\\share\\x.pdf",
        ] {
            assert!(check_job(&header(&[bad], &["in0.pdf"])).is_err(), "{bad}");
        }
        for bad in ["IN0.pdf", "a/b.pdf", "x.exe", ".pdf", "-x.pdf"] {
            assert!(check_job(&header(&[], &[bad])).is_err(), "{bad}");
        }
    }

    #[test]
    fn merges_two_files_and_cleans_up() {
        let src = corpus("text-1p.pdf");
        let (Some(qpdf), true) = (test_qpdf(), src.exists()) else {
            eprintln!("skipped: needs qpdf and `npm run corpus`");
            return;
        };
        let _turn = QPDF_TESTS.lock().unwrap();
        let pdf = fs::read(&src).unwrap();
        let body = frame(
            &["--empty", "--pages", "in0.pdf", "in1.pdf", "--", "out.pdf"],
            &["out.pdf"],
            &[("in0.pdf", &pdf), ("in1.pdf", &pdf)],
        );
        let before = leftover_dirs();
        let out = run_frame(&qpdf, &body).unwrap();
        let len = u32::from_be_bytes([out[0], out[1], out[2], out[3]]) as usize;
        let head: serde_json::Value = serde_json::from_slice(&out[4..4 + len]).unwrap();
        assert_eq!(head["files"][0]["name"], "out.pdf");
        let merged = &out[4 + len..];
        assert_eq!(
            merged.len(),
            head["files"][0]["size"].as_u64().unwrap() as usize
        );
        assert!(merged.starts_with(b"%PDF"));
        assert_eq!(leftover_dirs(), before, "job folder must be deleted");
    }

    #[test]
    fn reports_qpdf_errors_without_paths() {
        let Some(qpdf) = test_qpdf() else {
            eprintln!("skipped: needs qpdf");
            return;
        };
        let _turn = QPDF_TESTS.lock().unwrap();
        let body = frame(
            &["in0.pdf", "out.pdf"],
            &["out.pdf"],
            &[("in0.pdf", b"not a pdf")],
        );
        let err = run_frame(&qpdf, &body).unwrap_err();
        assert_eq!(err.kind, "qpdfFailed");
        assert!(!err.message.contains("pdfwb-qpdf-"), "{}", err.message);
    }

    #[test]
    fn rejects_truncated_frames() {
        assert!(run_frame(Path::new("qpdf"), &[0, 0]).is_err());
        assert!(run_frame(Path::new("qpdf"), &[0, 0, 0, 9, b'{']).is_err());
        let body = frame(&["in0.pdf"], &["out.pdf"], &[("in0.pdf", b"abc")]);
        assert!(run_frame(Path::new("qpdf"), &body[..body.len() - 1]).is_err());
    }

    fn leftover_dirs() -> usize {
        let prefix = format!("pdfwb-qpdf-{}-", std::process::id());
        fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&prefix)
            })
            .count()
    }
}
