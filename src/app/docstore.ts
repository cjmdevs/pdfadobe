// Per-document store (backlog B1). A document's state that must outlive a window lives
// here, keyed by a store id that stays the same across edits and windows: every revision
// (undo/redo), which one is saved, its file path and name, and whether the user accepted
// breaking its signature. Windows only show documents.
//
// Two implementations behind one interface:
// - Windows app: Rust (src-tauri/src/docstore.rs), shared by all windows.
// - Browser / tests: MemoryDocStore below (one window).

import { EditHistory, HISTORY_CAP_BYTES } from "./history";

export interface DocInfo {
  id: string;
  name: string;
  /** File path, or null for documents never saved (Combine result, extracted pages). */
  path: string | null;
  undoLabel: string | null;
  redoLabel: string | null;
  dirty: boolean;
  /** Oldest undo steps were dropped to stay under the memory cap (reported once). */
  trimmed: boolean;
  /** The user agreed that page changes may break this document's digital signature. */
  signatureAccepted: boolean;
  /** Window showing it (the app's window label); "main" in the browser. */
  window: string;
}

export interface NewDoc {
  name: string;
  path: string | null;
  /** False for new, never-saved documents (they start dirty). */
  saved: boolean;
}

export interface DocStore {
  create(id: string, bytes: Uint8Array, init: NewDoc): Promise<DocInfo>;
  info(id: string): Promise<DocInfo>;
  /** Current bytes (a window adopting the document fetches them). */
  current(id: string): Promise<Uint8Array>;
  push(id: string, bytes: Uint8Array, label: string): Promise<DocInfo>;
  undo(id: string): Promise<{ bytes: Uint8Array; info: DocInfo } | null>;
  redo(id: string): Promise<{ bytes: Uint8Array; info: DocInfo } | null>;
  /** After a successful save; Save As also changes path and name. */
  markSaved(id: string, saved?: { path: string; name: string }): Promise<DocInfo>;
  acceptSignature(id: string): Promise<DocInfo>;
  clearTrimmed(id: string): Promise<DocInfo>;
  /** The document's tab closed for good (not moved to another window). */
  release(id: string): Promise<void>;
  /** Unsaved documents in every window (quit prompt). */
  dirty(): Promise<DocInfo[]>;
  /** An open document with this path (same file opened twice), in any window. */
  findPath(path: string): Promise<DocInfo | null>;
}

const samePath = (a: string, b: string) =>
  a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

interface Entry {
  history: EditHistory;
  name: string;
  path: string | null;
  signatureAccepted: boolean;
  window: string;
}

/** In-memory store for the browser platform and unit tests (single window). */
export class MemoryDocStore implements DocStore {
  private docs = new Map<string, Entry>();
  constructor(private readonly capBytes = HISTORY_CAP_BYTES) {}

  private get(id: string): Entry {
    const e = this.docs.get(id);
    if (!e) throw new Error(`document ${id} is not open`);
    return e;
  }

  private infoOf(id: string, e: Entry): DocInfo {
    const h = e.history;
    return {
      id,
      name: e.name,
      path: e.path,
      undoLabel: h.undoLabel,
      redoLabel: h.redoLabel,
      dirty: h.dirty,
      trimmed: h.trimmed,
      signatureAccepted: e.signatureAccepted,
      window: e.window,
    };
  }

  async create(id: string, bytes: Uint8Array, init: NewDoc) {
    const e: Entry = {
      history: new EditHistory(bytes, this.capBytes, init.saved),
      name: init.name,
      path: init.path,
      signatureAccepted: false,
      window: "main",
    };
    this.docs.set(id, e);
    return this.infoOf(id, e);
  }

  async info(id: string) {
    return this.infoOf(id, this.get(id));
  }

  async current(id: string) {
    return this.get(id).history.current;
  }

  async push(id: string, bytes: Uint8Array, label: string) {
    const e = this.get(id);
    e.history.push(bytes, label);
    return this.infoOf(id, e);
  }

  async undo(id: string) {
    const e = this.get(id);
    const bytes = e.history.undo();
    return bytes ? { bytes, info: this.infoOf(id, e) } : null;
  }

  async redo(id: string) {
    const e = this.get(id);
    const bytes = e.history.redo();
    return bytes ? { bytes, info: this.infoOf(id, e) } : null;
  }

  async markSaved(id: string, saved?: { path: string; name: string }) {
    const e = this.get(id);
    e.history.markSaved();
    if (saved) {
      e.path = saved.path;
      e.name = saved.name;
    }
    return this.infoOf(id, e);
  }

  async acceptSignature(id: string) {
    const e = this.get(id);
    e.signatureAccepted = true;
    return this.infoOf(id, e);
  }

  async clearTrimmed(id: string) {
    const e = this.get(id);
    e.history.trimmed = false;
    return this.infoOf(id, e);
  }

  /** The browser's stand-in for other windows (e2e) moves documents with this. */
  setWindow(id: string, window: string) {
    this.get(id).window = window;
  }

  async release(id: string) {
    this.docs.delete(id);
  }

  async dirty() {
    return [...this.docs].filter(([, e]) => e.history.dirty).map(([id, e]) => this.infoOf(id, e));
  }

  async findPath(path: string) {
    for (const [id, e] of this.docs)
      if (e.path && samePath(e.path, path)) return this.infoOf(id, e);
    return null;
  }
}
