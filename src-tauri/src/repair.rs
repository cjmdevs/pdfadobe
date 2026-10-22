//! "Repair a copy" for damaged PDFs: qpdf rewrites the file (reconstructing the
//! cross-reference table) into a NEW file. The original is never touched.
//!
//! qpdf is bundled on Windows under `<resources>/qpdf/qpdf.exe` (see
//! scripts/fetch-win-binaries.mjs); elsewhere, and in dev, it is taken from PATH.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::fileio::{FileError, same_file, temp_sibling};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    /// qpdf exit code 3: it repaired something and warned about it.
    pub had_warnings: bool,
}

#[tauri::command]
pub async fn repair_pdf(
    app: AppHandle,
    source: String,
    target: String,
) -> Result<RepairResult, FileError> {
    let qpdf = qpdf_path(&app);
    repair(&qpdf, Path::new(&source), Path::new(&target))
}

pub fn qpdf_path(app: &AppHandle) -> PathBuf {
    let exe = if cfg!(windows) { "qpdf.exe" } else { "qpdf" };
    app.path()
        .resource_dir()
        .map(|d| d.join("qpdf").join(exe))
        .ok()
        .filter(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(exe))
}

pub fn repair(qpdf: &Path, source: &Path, target: &Path) -> Result<RepairResult, FileError> {
    if same_file(source, target) || source == target {
        return Err(FileError::other(
            "choose a new file name; the original is never overwritten",
        ));
    }
    let tmp = temp_sibling(target)?;
    let mut cmd = Command::new(qpdf);
    // --warning-exit-0 is not used: we want to know whether repairs happened.
    cmd.arg(source).arg(&tmp);
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
    let result = match code {
        0 | 3 => std::fs::rename(&tmp, target)
            .map(|_| RepairResult {
                had_warnings: code == 3,
            })
            .map_err(|e| FileError::other(format!("could not write the repaired copy: {e}"))),
        // qpdf's stderr names objects and offsets, not page text; it goes to the UI only.
        _ => Err(FileError {
            kind: "unrepairable",
            message: first_line(&String::from_utf8_lossy(&out.stderr)),
        }),
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn first_line(s: &str) -> String {
    s.lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("qpdf could not repair the file")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn corpus(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/corpus/generated")
            .join(name)
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdfwb-repair-{tag}-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// qpdf for tests: $QPDF, PATH, or the copy fetched into src-tauri/vendor (Windows).
    fn test_qpdf() -> Option<PathBuf> {
        let vendor = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/qpdf/qpdf.exe");
        std::env::var_os("QPDF")
            .map(PathBuf::from)
            .into_iter()
            .chain([PathBuf::from("qpdf"), vendor])
            .find(|p| Command::new(p).arg("--version").output().is_ok())
    }

    #[test]
    fn repairs_damaged_xref_into_a_new_file() {
        let src = corpus("damaged-xref.pdf");
        let (Some(qpdf), true) = (test_qpdf(), src.exists()) else {
            eprintln!("skipped: needs qpdf and `npm run corpus`");
            return;
        };
        let d = tmpdir("ok");
        let target = d.join("repaired.pdf");
        let before = fs::read(&src).unwrap();
        let r = repair(&qpdf, &src, &target).unwrap();
        assert!(r.had_warnings);
        assert_eq!(
            fs::read(&src).unwrap(),
            before,
            "original must be untouched"
        );
        let check = Command::new(&qpdf)
            .arg("--check")
            .arg(&target)
            .status()
            .unwrap();
        assert_eq!(check.code(), Some(0));
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn reports_unrepairable_files_and_leaves_no_output() {
        let src = corpus("corrupt.pdf");
        let (Some(qpdf), true) = (test_qpdf(), src.exists()) else {
            eprintln!("skipped: needs qpdf and `npm run corpus`");
            return;
        };
        let d = tmpdir("bad");
        let target = d.join("out.pdf");
        let err = repair(&qpdf, &src, &target).unwrap_err();
        assert_eq!(err.kind, "unrepairable");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 0);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn refuses_to_write_over_the_source() {
        let src = corpus("damaged-xref.pdf");
        assert!(repair(Path::new("qpdf"), &src, &src).is_err());
    }

    #[test]
    fn reports_missing_qpdf() {
        let d = tmpdir("missing");
        let err = repair(&d.join("no-such-qpdf"), &d.join("a.pdf"), &d.join("b.pdf")).unwrap_err();
        assert_eq!(err.kind, "qpdfMissing");
        fs::remove_dir_all(d).unwrap();
    }
}
