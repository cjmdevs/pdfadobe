// Page clipboard (backlog B8): pages copied or cut in the thumbnails or Organize view, as
// a small PDF, shared by every window of the app so they paste into any tab. Kept in
// memory only (never written to disk, never on the Windows clipboard) and gone when the
// app exits.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::fileio::{FileError, percent_decode};

type R<T> = Result<T, FileError>;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
    /// Number of pages on the clipboard.
    pub count: u32,
    /// Name of the document they came from (shown as "3 pages from X.pdf").
    pub source: String,
}

#[derive(Default)]
pub struct PageClip(Mutex<Option<(ClipInfo, Vec<u8>)>>);

impl PageClip {
    pub fn set(&self, info: ClipInfo, bytes: Vec<u8>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some((info, bytes));
    }
    pub fn info(&self) -> Option<ClipInfo> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|(i, _)| i.clone())
    }
    pub fn bytes(&self) -> Vec<u8> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|(_, b)| b.clone())
            .unwrap_or_default()
    }
}

#[tauri::command]
pub fn page_clip_set(clip: State<'_, PageClip>, request: Request<'_>) -> R<()> {
    let raw = request
        .headers()
        .get("x-clip")
        .ok_or("missing x-clip header")?
        .to_str()
        .map_err(|_| "x-clip header is not ASCII")?;
    let info: ClipInfo = serde_json::from_str(&percent_decode(raw)?)
        .map_err(|e| FileError::from(format!("bad x-clip header: {e}")))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw PDF bytes".into());
    };
    if bytes.is_empty() {
        return Err("no pages to copy".into());
    }
    clip.set(info, bytes.clone());
    Ok(())
}

#[tauri::command]
pub fn page_clip_info(clip: State<'_, PageClip>) -> Option<ClipInfo> {
    clip.info()
}

/// The clipboard's PDF; empty when nothing was copied.
#[tauri::command]
pub fn page_clip_get(clip: State<'_, PageClip>) -> Response {
    Response::new(clip.bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_until_set_then_replaced() {
        let c = PageClip::default();
        assert_eq!(c.info(), None);
        assert!(c.bytes().is_empty());
        let a = ClipInfo {
            count: 2,
            source: "A.pdf".into(),
        };
        c.set(a.clone(), vec![1, 2, 3]);
        assert_eq!(c.info(), Some(a));
        assert_eq!(c.bytes(), vec![1, 2, 3]);
        let b = ClipInfo {
            count: 1,
            source: "B.pdf".into(),
        };
        c.set(b.clone(), vec![9]);
        assert_eq!(c.info(), Some(b));
        assert_eq!(c.bytes(), vec![9]);
    }
}
