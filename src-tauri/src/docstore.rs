//! Per-document store shared by all windows (backlog B1). Mirrors `MemoryDocStore` in
//! src/app/docstore.ts: every revision (undo/redo, whole-file snapshots), which one is
//! saved, the file path and name, signature consent, and the window showing it. Windows
//! only show documents, so a tab can move between windows without losing its history.
//!
//! Bytes cross IPC raw: `doc_create`/`doc_push` take the PDF as the request body with a
//! percent-encoded JSON `x-doc` header; `doc_current` returns raw bytes.
//! Document contents never reach a log.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{State, WebviewWindow};

use crate::fileio::{FileError, percent_decode, save_with_backup};

/// Undo history cap per document (same as HISTORY_CAP_BYTES in src/app/history.ts).
pub const HISTORY_CAP_BYTES: usize = 400 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
    pub dirty: bool,
    pub trimmed: bool,
    pub signature_accepted: bool,
    pub window: String,
}

#[derive(Debug, Deserialize)]
pub struct NewDoc {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub saved: bool,
}

#[derive(Debug, Deserialize)]
pub struct Saved {
    pub path: String,
    pub name: String,
}

struct Rev {
    bytes: Arc<Vec<u8>>,
    label: String,
}

struct Entry {
    revs: Vec<Rev>,
    index: usize,
    /// Revision matching the file on disk; None once dropped, or never saved.
    saved: Option<usize>,
    trimmed: bool,
    name: String,
    path: Option<String>,
    signature_accepted: bool,
    window: String,
}

impl Entry {
    fn total(&self) -> usize {
        self.revs.iter().map(|r| r.bytes.len()).sum()
    }
}

pub struct DocStore {
    docs: Mutex<HashMap<String, Entry>>,
    cap: usize,
}

impl Default for DocStore {
    fn default() -> Self {
        Self::with_cap(HISTORY_CAP_BYTES)
    }
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

type R<T> = Result<T, FileError>;

impl DocStore {
    pub fn with_cap(cap: usize) -> Self {
        Self {
            docs: Mutex::new(HashMap::new()),
            cap,
        }
    }

    fn with<T>(&self, id: &str, f: impl FnOnce(&mut Entry) -> T) -> R<T> {
        let mut docs = self.docs.lock().expect("doc store lock");
        let e = docs
            .get_mut(id)
            .ok_or_else(|| FileError::from("this document is no longer open"))?;
        Ok(f(e))
    }

    fn info_of(id: &str, e: &Entry) -> DocInfo {
        DocInfo {
            id: id.to_string(),
            name: e.name.clone(),
            path: e.path.clone(),
            undo_label: (e.index > 0).then(|| e.revs[e.index].label.clone()),
            redo_label: e.revs.get(e.index + 1).map(|r| r.label.clone()),
            dirty: e.saved != Some(e.index),
            trimmed: e.trimmed,
            signature_accepted: e.signature_accepted,
            window: e.window.clone(),
        }
    }

    pub fn create(&self, init: NewDoc, bytes: Vec<u8>, window: &str) -> DocInfo {
        let e = Entry {
            revs: vec![Rev {
                bytes: Arc::new(bytes),
                label: "Open".into(),
            }],
            index: 0,
            saved: init.saved.then_some(0),
            trimmed: false,
            name: init.name,
            path: init.path,
            signature_accepted: false,
            window: window.to_string(),
        };
        let info = Self::info_of(&init.id, &e);
        self.docs.lock().expect("doc store lock").insert(init.id, e);
        info
    }

    pub fn info(&self, id: &str) -> R<DocInfo> {
        self.with(id, |e| Self::info_of(id, e))
    }

    pub fn current(&self, id: &str) -> R<Arc<Vec<u8>>> {
        self.with(id, |e| e.revs[e.index].bytes.clone())
    }

    pub fn push(&self, id: &str, bytes: Vec<u8>, label: String) -> R<DocInfo> {
        let cap = self.cap;
        self.with(id, |e| {
            e.revs.truncate(e.index + 1);
            if e.saved.is_some_and(|s| s > e.index) {
                e.saved = None;
            }
            e.revs.push(Rev {
                bytes: Arc::new(bytes),
                label,
            });
            e.index += 1;
            while e.total() > cap && e.index > 0 {
                e.revs.remove(0);
                e.index -= 1;
                e.saved = e.saved.and_then(|s| s.checked_sub(1));
                e.trimmed = true;
            }
            Self::info_of(id, e)
        })
    }

    pub fn step(&self, id: &str, redo: bool) -> R<Option<DocInfo>> {
        self.with(id, |e| {
            if redo {
                if e.index + 1 >= e.revs.len() {
                    return None;
                }
                e.index += 1;
            } else {
                if e.index == 0 {
                    return None;
                }
                e.index -= 1;
            }
            Some(Self::info_of(id, e))
        })
    }

    pub fn mark_saved(&self, id: &str, saved: Option<Saved>) -> R<DocInfo> {
        self.with(id, |e| {
            e.saved = Some(e.index);
            if let Some(s) = saved {
                e.path = Some(s.path);
                e.name = s.name;
            }
            Self::info_of(id, e)
        })
    }

    pub fn accept_signature(&self, id: &str) -> R<DocInfo> {
        self.with(id, |e| {
            e.signature_accepted = true;
            Self::info_of(id, e)
        })
    }

    pub fn clear_trimmed(&self, id: &str) -> R<DocInfo> {
        self.with(id, |e| {
            e.trimmed = false;
            Self::info_of(id, e)
        })
    }

    pub fn release(&self, id: &str) {
        self.docs.lock().expect("doc store lock").remove(id);
    }

    /// A window closed (or crashed): forget the documents it still showed.
    pub fn release_window(&self, window: &str) {
        self.docs
            .lock()
            .expect("doc store lock")
            .retain(|_, e| e.window != window);
    }

    pub fn set_window(&self, id: &str, window: &str) -> R<()> {
        self.with(id, |e| e.window = window.to_string())
    }

    pub fn dirty(&self) -> Vec<DocInfo> {
        let docs = self.docs.lock().expect("doc store lock");
        let mut out: Vec<DocInfo> = docs
            .iter()
            .filter(|(_, e)| e.saved != Some(e.index))
            .map(|(id, e)| Self::info_of(id, e))
            .collect();
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }

    pub fn find_path(&self, path: &str) -> Option<DocInfo> {
        let docs = self.docs.lock().expect("doc store lock");
        docs.iter()
            .find(|(_, e)| e.path.as_deref().is_some_and(|p| same_path(p, path)))
            .map(|(id, e)| Self::info_of(id, e))
    }

    /// Saves the current revision over the document's file (quit prompt, "Save all",
    /// for documents shown in another window). Same rules as `save_pdf`.
    pub fn save(&self, id: &str) -> R<DocInfo> {
        let (path, bytes) = self.with(id, |e| (e.path.clone(), e.revs[e.index].bytes.clone()))?;
        let path = path.ok_or("this document has never been saved; use Save As")?;
        save_with_backup(Path::new(&path), &bytes)?;
        self.mark_saved(id, None)
    }
}

fn doc_header<T: for<'de> Deserialize<'de>>(request: &Request<'_>) -> R<T> {
    let raw = request
        .headers()
        .get("x-doc")
        .ok_or("missing x-doc header")?
        .to_str()
        .map_err(|_| "x-doc header is not ASCII")?;
    let json = percent_decode(raw)?;
    serde_json::from_str(&json).map_err(|e| FileError::from(format!("bad x-doc header: {e}")))
}

fn raw_body(request: &Request<'_>) -> R<Vec<u8>> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("expected raw PDF bytes".into()),
    }
}

#[derive(Deserialize)]
struct PushHeader {
    id: String,
    label: String,
}

#[tauri::command]
pub fn doc_create(
    window: WebviewWindow,
    store: State<'_, DocStore>,
    request: Request<'_>,
) -> R<DocInfo> {
    let init: NewDoc = doc_header(&request)?;
    Ok(store.create(init, raw_body(&request)?, window.label()))
}

#[tauri::command]
pub fn doc_push(store: State<'_, DocStore>, request: Request<'_>) -> R<DocInfo> {
    let h: PushHeader = doc_header(&request)?;
    store.push(&h.id, raw_body(&request)?, h.label)
}

#[tauri::command]
pub fn doc_info(store: State<'_, DocStore>, id: String) -> R<DocInfo> {
    store.info(&id)
}

#[tauri::command]
pub fn doc_current(store: State<'_, DocStore>, id: String) -> R<Response> {
    Ok(Response::new(store.current(&id)?.as_ref().clone()))
}

#[tauri::command]
pub fn doc_step(store: State<'_, DocStore>, id: String, redo: bool) -> R<Option<DocInfo>> {
    store.step(&id, redo)
}

#[tauri::command]
pub fn doc_mark_saved(store: State<'_, DocStore>, id: String, saved: Option<Saved>) -> R<DocInfo> {
    store.mark_saved(&id, saved)
}

#[tauri::command]
pub fn doc_accept_signature(store: State<'_, DocStore>, id: String) -> R<DocInfo> {
    store.accept_signature(&id)
}

#[tauri::command]
pub fn doc_clear_trimmed(store: State<'_, DocStore>, id: String) -> R<DocInfo> {
    store.clear_trimmed(&id)
}

#[tauri::command]
pub fn doc_release(store: State<'_, DocStore>, id: String) {
    store.release(&id);
}

#[tauri::command]
pub fn doc_dirty(store: State<'_, DocStore>) -> Vec<DocInfo> {
    store.dirty()
}

#[tauri::command]
pub fn doc_find_path(store: State<'_, DocStore>, path: String) -> Option<DocInfo> {
    store.find_path(&path)
}

#[tauri::command]
pub fn doc_save(store: State<'_, DocStore>, id: String) -> R<DocInfo> {
    store.save(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(store: &DocStore, id: &str, bytes: &[u8], path: Option<&str>) -> DocInfo {
        store.create(
            NewDoc {
                id: id.into(),
                name: format!("{id}.pdf"),
                path: path.map(String::from),
                saved: path.is_some(),
            },
            bytes.to_vec(),
            "main",
        )
    }

    #[test]
    fn undo_redo_and_dirty_follow_the_saved_revision() {
        let s = DocStore::default();
        assert!(!new(&s, "a", b"v0", Some("C:\\x\\a.pdf")).dirty);
        let i = s.push("a", b"v1".to_vec(), "Rotate".into()).unwrap();
        assert!(i.dirty);
        assert_eq!(i.undo_label.as_deref(), Some("Rotate"));
        let i = s.step("a", false).unwrap().unwrap();
        assert!(!i.dirty);
        assert_eq!(i.redo_label.as_deref(), Some("Rotate"));
        assert_eq!(s.current("a").unwrap().as_slice(), b"v0");
        assert!(s.step("a", false).unwrap().is_none());
        s.step("a", true).unwrap().unwrap();
        assert_eq!(s.current("a").unwrap().as_slice(), b"v1");
        assert!(!s.mark_saved("a", None).unwrap().dirty);
        // A new edit after undo drops the redo branch.
        s.step("a", false).unwrap();
        let i = s.push("a", b"v2".to_vec(), "Delete".into()).unwrap();
        assert!(i.dirty);
        assert!(i.redo_label.is_none());
    }

    #[test]
    fn new_documents_start_unsaved_and_save_as_sets_the_path() {
        let s = DocStore::default();
        assert!(new(&s, "n", b"x", None).dirty);
        assert!(s.save("n").is_err());
        let i = s
            .mark_saved(
                "n",
                Some(Saved {
                    path: "D:\\out\\n.pdf".into(),
                    name: "n.pdf".into(),
                }),
            )
            .unwrap();
        assert!(!i.dirty);
        assert_eq!(i.path.as_deref(), Some("D:\\out\\n.pdf"));
    }

    #[test]
    fn oldest_steps_drop_past_the_cap() {
        let s = DocStore::with_cap(10);
        new(&s, "a", b"0123", Some("a"));
        s.push("a", b"4567".to_vec(), "one".into()).unwrap();
        let i = s.push("a", b"89ab".to_vec(), "two".into()).unwrap();
        assert!(i.trimmed);
        assert!(i.dirty, "the saved revision was dropped");
        s.step("a", false).unwrap().unwrap();
        assert!(s.step("a", false).unwrap().is_none());
        assert!(!s.clear_trimmed("a").unwrap().trimmed);
    }

    #[test]
    fn finds_paths_case_and_slash_insensitively_and_releases_windows() {
        let s = DocStore::default();
        new(&s, "a", b"x", Some(r"\\server\share\Client\A.pdf"));
        new(&s, "b", b"y", None);
        assert_eq!(
            s.find_path("//SERVER/share/client/a.PDF").map(|i| i.id),
            Some("a".to_string())
        );
        s.set_window("b", "w-1").unwrap();
        assert_eq!(s.dirty().len(), 1);
        s.release_window("w-1");
        assert!(s.info("b").is_err());
        assert!(s.info("a").is_ok());
    }

    #[test]
    fn save_writes_the_current_revision_with_a_backup() {
        let dir = std::env::temp_dir().join(format!("pdfwb-docstore-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.pdf");
        std::fs::write(&file, b"old").unwrap();
        let s = DocStore::default();
        new(&s, "a", b"old", Some(file.to_str().unwrap()));
        s.push("a", b"new".to_vec(), "Edit".into()).unwrap();
        assert!(!s.save("a").unwrap().dirty);
        assert_eq!(std::fs::read(&file).unwrap(), b"new");
        assert_eq!(std::fs::read(dir.join("doc.pdf.bak")).unwrap(), b"old");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
