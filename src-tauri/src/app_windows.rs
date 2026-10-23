//! Multiple windows (backlog B1). Every window shows tabs; documents live in the shared
//! `DocStore`, so moving a tab hands over its store id and nothing is reloaded from disk.
//!
//! A move first re-assigns the documents to the target window in the store (so closing
//! the source window cannot release them), queues their ids for that window, then nudges
//! it with `ADOPT_EVENT`; a new window takes its queue when it starts (`take_window_docs`).

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::docstore::DocStore;
use crate::fileio::FileError;

/// Sent to a window that has documents queued for it (no payload).
pub const ADOPT_EVENT: &str = "adopt-docs";
/// Sent to the window showing a document the user tried to open again (payload: store id).
pub const FOCUS_DOC_EVENT: &str = "focus-doc";

#[derive(Default)]
pub struct Windows {
    pending: Mutex<HashMap<String, Vec<String>>>,
    last_focused: Mutex<Option<String>>,
    seq: AtomicU32,
}

impl Windows {
    pub fn focused(&self, label: &str) {
        *self.last_focused.lock().expect("windows lock") = Some(label.to_string());
    }

    pub fn destroyed(&self, label: &str) {
        self.pending.lock().expect("windows lock").remove(label);
        let mut last = self.last_focused.lock().expect("windows lock");
        if last.as_deref() == Some(label) {
            *last = None;
        }
    }

    pub fn last_focused(&self) -> Option<String> {
        self.last_focused.lock().expect("windows lock").clone()
    }
}

/// Where a tab dropped at `point` (screen pixels) goes.
#[derive(Debug, PartialEq)]
pub enum DropTarget {
    /// Back onto its own window: nothing happens.
    Source,
    Window(String),
    New,
}

/// A window's label and outer rectangle (x, y, width, height) in screen pixels.
pub type Rect = (String, i32, i32, u32, u32);

/// `rects` are visible windows, front-most first (the focused one is never a target:
/// it is the source).
pub fn drop_target(rects: &[Rect], point: (f64, f64), source: &str) -> DropTarget {
    let inside = |&(_, x, y, w, h): &Rect| {
        point.0 >= x as f64
            && point.1 >= y as f64
            && point.0 < x as f64 + w as f64
            && point.1 < y as f64 + h as f64
    };
    match rects.iter().find(|r| inside(r)) {
        Some((label, ..)) if label == source => DropTarget::Source,
        Some((label, ..)) => DropTarget::Window(label.clone()),
        None => DropTarget::New,
    }
}

fn rect_of(w: &WebviewWindow) -> Option<Rect> {
    if !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(true) {
        return None;
    }
    let p = w.outer_position().ok()?;
    let s = w.outer_size().ok()?;
    Some((w.label().to_string(), p.x, p.y, s.width, s.height))
}

fn hand_over(
    app: &AppHandle,
    store: &DocStore,
    windows: &Windows,
    ids: &[String],
    target: &str,
) -> Result<(), FileError> {
    for id in ids {
        store.set_window(id, target)?;
    }
    windows
        .pending
        .lock()
        .expect("windows lock")
        .entry(target.to_string())
        .or_default()
        .extend(ids.iter().cloned());
    let _ = app.emit_to(target, ADOPT_EVENT, ());
    Ok(())
}

/// Opens a new, empty window with its top-left corner at `at` (screen pixels).
fn new_window(
    app: &AppHandle,
    windows: &Windows,
    at: PhysicalPosition<i32>,
) -> Result<WebviewWindow, FileError> {
    let label = format!("w-{}", windows.seq.fetch_add(1, Ordering::Relaxed) + 1);
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("PDF Workbench")
        .inner_size(1100.0, 800.0)
        .min_inner_size(640.0, 480.0)
        .visible(false)
        .build()
        .map_err(|e| FileError::from(format!("could not open a new window: {e}")))?;
    let _ = w.set_position(at);
    let _ = w.show();
    let _ = w.set_focus();
    #[cfg(windows)]
    crate::disable_browser_accelerators(&w);
    Ok(w)
}

/// A tab drag ended outside its window. Moves the documents to the window under the
/// pointer, or to a new window there. Returns the target window, or None when the tab
/// was dropped back on its own window.
// Async: creating a window from a synchronous command deadlocks on Windows (Tauri docs).
#[tauri::command]
pub async fn tab_drop(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, DocStore>,
    windows: State<'_, Windows>,
    ids: Vec<String>,
) -> Result<Option<String>, FileError> {
    let cursor = app
        .cursor_position()
        .map_err(|e| FileError::from(format!("could not read the pointer position: {e}")))?;
    // The window list has no z-order; prefer the most recently focused window when
    // windows overlap, then the rest.
    let mut rects: Vec<Rect> = app.webview_windows().values().filter_map(rect_of).collect();
    if let Some(last) = windows.last_focused() {
        rects.sort_by_key(|r| r.0 != last);
    }
    let target = match drop_target(&rects, (cursor.x, cursor.y), window.label()) {
        DropTarget::Source => return Ok(None),
        DropTarget::Window(label) => label,
        DropTarget::New => {
            let at = PhysicalPosition::new(cursor.x as i32 - 120, cursor.y as i32 - 16);
            new_window(&app, &windows, at)?.label().to_string()
        }
    };
    hand_over(&app, &store, &windows, &ids, &target)?;
    if let Some(w) = app.get_webview_window(&target) {
        let _ = w.set_focus();
    }
    Ok(Some(target))
}

/// Tab menu > Move to New Window.
#[tauri::command]
pub async fn move_to_new_window(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, DocStore>,
    windows: State<'_, Windows>,
    ids: Vec<String>,
) -> Result<String, FileError> {
    let p = window.outer_position().unwrap_or_default();
    let w = new_window(&app, &windows, PhysicalPosition::new(p.x + 40, p.y + 40))?;
    hand_over(&app, &store, &windows, &ids, w.label())?;
    Ok(w.label().to_string())
}

/// Documents queued for the calling window (at start, and after `ADOPT_EVENT`).
#[tauri::command]
pub fn take_window_docs(window: WebviewWindow, windows: State<'_, Windows>) -> Vec<String> {
    windows
        .pending
        .lock()
        .expect("windows lock")
        .remove(window.label())
        .unwrap_or_default()
}

/// Brings the window showing document `id` to the front and switches it to that tab.
/// False when no window shows it any more.
#[tauri::command]
pub fn focus_doc(app: AppHandle, store: State<'_, DocStore>, id: String) -> bool {
    let Ok(info) = store.info(&id) else {
        return false;
    };
    let Some(w) = app.get_webview_window(&info.window) else {
        return false;
    };
    let _ = w.unminimize();
    let _ = w.set_focus();
    let _ = app.emit_to(info.window.as_str(), FOCUS_DOC_EVENT, id);
    true
}

/// Exit after the quit prompt (Ctrl+Q): closes every window without asking again.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(label: &str, x: i32, y: i32) -> Rect {
        (label.to_string(), x, y, 800, 600)
    }

    #[test]
    fn drop_targets() {
        let rects = [r("w-1", 900, 0), r("main", 0, 0)];
        assert_eq!(
            drop_target(&rects, (100.0, 100.0), "main"),
            DropTarget::Source
        );
        assert_eq!(
            drop_target(&rects, (1000.0, 50.0), "main"),
            DropTarget::Window("w-1".into())
        );
        assert_eq!(drop_target(&rects, (100.0, 700.0), "main"), DropTarget::New);
        // Overlap: the first (front-most) window wins.
        let overlap = [r("w-1", 0, 0), r("main", 0, 0)];
        assert_eq!(
            drop_target(&overlap, (10.0, 10.0), "main"),
            DropTarget::Window("w-1".into())
        );
        // Negative coordinates (a monitor left of the primary one).
        let left = [r("w-2", -1600, 0)];
        assert_eq!(
            drop_target(&left, (-1000.0, 10.0), "main"),
            DropTarget::Window("w-2".into())
        );
    }
}
