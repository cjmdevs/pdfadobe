//! Native printing (Phase 1 decision: option C, see docs/progress.md).
//!
//! The frontend sends a print-ready PDF (EmbedPDF `preparePrintDocument`: annotations
//! flattened, no encryption). On Windows we show the standard Windows print dialog
//! (PrintDlgEx) and draw each page straight onto the printer DC with native PDFium
//! (`FPDF_RenderPage`), the same way Chrome prints PDFs, so text and vectors stay vector.
//! When native printing is unavailable (not Windows, or pdfium.dll missing) the command
//! returns kind "unsupported" and the frontend falls back to the WebView print path.

// layout and options are only consumed by the Windows backend.
#[cfg_attr(not(windows), allow(dead_code))]
pub mod layout;
#[cfg(windows)]
mod win;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, WebviewWindow};

use crate::fileio::FileError;
use layout::Scaling;

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    /// Job name shown in the Windows print queue (the file name, never document text).
    pub title: String,
    #[serde(default)]
    pub scaling: Scaling,
    #[serde(default = "yes")]
    pub auto_rotate: bool,
    /// 0-based page the user is on, for the dialog's "Current page" option.
    #[serde(default)]
    pub current_page: u32,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrintOutcome {
    /// "printed" or "cancelled".
    pub status: &'static str,
    pub pages: u32,
}

/// Body: raw PDF bytes. Header `x-options`: percent-encoded JSON `PrintOptions`.
#[tauri::command]
pub async fn print_pdf(
    app: AppHandle,
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<PrintOutcome, FileError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(FileError::other("expected raw PDF bytes"));
    };
    let raw = request
        .headers()
        .get("x-options")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| FileError::other("missing x-options header"))?;
    let options: PrintOptions = serde_json::from_str(&crate::fileio::percent_decode(raw)?)
        .map_err(|e| FileError::other(format!("bad print options: {e}")))?;
    print_native(&app, &window, bytes.clone(), options).await
}

#[cfg(windows)]
async fn print_native(
    app: &AppHandle,
    window: &WebviewWindow,
    bytes: Vec<u8>,
    options: PrintOptions,
) -> Result<PrintOutcome, FileError> {
    use tauri::Manager;
    let dll = app
        .path()
        .resource_dir()
        .map(|d| d.join("pdfium").join("pdfium.dll"))
        .map_err(|e| FileError::other(e.to_string()))?;
    let hwnd = window
        .hwnd()
        .map_err(|e| FileError::other(e.to_string()))?
        .0 as isize;
    // The dialog is modal to our window; run it (and the spooling) off the async runtime.
    tauri::async_runtime::spawn_blocking(move || win::print(&dll, hwnd, &bytes, &options))
        .await
        .map_err(|e| FileError::other(e.to_string()))?
}

#[cfg(not(windows))]
async fn print_native(
    _app: &AppHandle,
    _window: &WebviewWindow,
    _bytes: Vec<u8>,
    _options: PrintOptions,
) -> Result<PrintOutcome, FileError> {
    Err(FileError {
        kind: "unsupported",
        message: "native printing is Windows-only".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_default_to_acrobat_behaviour() {
        let o: PrintOptions = serde_json::from_str(r#"{"title":"a.pdf"}"#).unwrap();
        assert_eq!(o.scaling, Scaling::ShrinkOversized);
        assert!(o.auto_rotate);
        assert_eq!(o.current_page, 0);
        let o: PrintOptions =
            serde_json::from_str(r#"{"title":"a.pdf","scaling":"actualSize","autoRotate":false}"#)
                .unwrap();
        assert_eq!(o.scaling, Scaling::ActualSize);
        assert!(!o.auto_rotate);
    }
}
