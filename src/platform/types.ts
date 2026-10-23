// Everything the UI needs from the host. Two implementations:
// - tauri.ts: the real Windows app (Rust file IO, native dialogs, qpdf, native print).
// - browser.ts: plain browser for dev and Playwright (files via <input>, drag-drop, and a
//   test-only mock file system served at /__mockfs/ that Playwright intercepts).

import type { Qpdf } from "../engine/pages/qpdf";
import type { DocInfo, DocStore } from "../app/docstore";

/** Where an open document came from. Only `path` sources go in Recent Files. */
export type FileSource = { kind: "path"; path: string } | { kind: "memory"; name: string };

export interface OpenedFile {
  source: FileSource;
  name: string;
  bytes: ArrayBuffer;
}

/** Stable reasons for a failed read; drives the message the user sees. */
export type FileErrorKind =
  | "locked"
  | "network"
  | "notFound"
  | "accessDenied"
  | "isDirectory"
  | "qpdfMissing"
  | "qpdfFailed"
  | "unrepairable"
  | "unsupported"
  /** Saved, but the file did not read back as written; `<name>.bak` was kept. */
  | "unverified"
  | "other";

export class PlatformError extends Error {
  readonly kind: FileErrorKind;
  constructor(kind: FileErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "PlatformError";
  }
}

export type Scaling = "fit" | "shrinkOversized" | "actualSize";

export interface PrintRequest {
  /** Print-ready PDF (annotations flattened, unencrypted). */
  bytes: ArrayBuffer;
  /** Job name for the print queue: the file name, never document text. */
  title: string;
  scaling: Scaling;
  autoRotate: boolean;
  currentPage: number;
}

export type PrintResult = { status: "printed"; pages: number } | { status: "cancelled" };

export interface Platform {
  readonly kind: "tauri" | "browser";
  /** Native open dialog (multi-select). Empty array when cancelled. `images` also offers JPG/PNG/TIFF. */
  pickFiles(opts?: { images?: boolean }): Promise<OpenedFile[]>;
  /** Folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** PDFs and images directly in a folder (not subfolders), in natural name order. */
  listFolder(path: string): Promise<string[]>;
  readPath(path: string): Promise<OpenedFile>;
  /** Paths passed on the command line at first launch (Explorer "Open with"). */
  takeLaunchPaths(): Promise<string[]>;
  /** Paths from a second launch or a native drag-drop. Returns an unsubscribe. */
  onOpenPaths(cb: (paths: string[]) => void): Promise<() => void>;
  /** Native drag-drop of files from Explorer (Tauri). Browser drops use DOM events. */
  onFileDrop(cb: (paths: string[]) => void): Promise<() => void>;
  loadSettings(): Promise<unknown>;
  saveSettings(value: unknown): Promise<void>;
  /** Save dialog; null when cancelled. */
  pickSavePath(suggested: string): Promise<string | null>;
  /** Save over an opened file: temp file, previous version copied to `<path>.bak`, atomic
   * replace, then read back; the `.bak` is deleted when the file matches. */
  save(path: string, bytes: Uint8Array): Promise<void>;
  /** Save As to a new path. Refuses `source` (the original is never overwritten). */
  saveAs(target: string, source: string | null, bytes: Uint8Array): Promise<void>;
  /** Removes `<path>.bak` once the saved file has opened successfully. */
  discardBackup(path: string): Promise<void>;
  /** Writes `name` into `folder`, adding " (2)", " (3)"... instead of overwriting. Returns the path. */
  writeNewFile(folder: string, name: string, bytes: Uint8Array): Promise<string>;
  /** qpdf for page operations (src/engine/pages). */
  qpdf: Qpdf;
  /** Per-document state shared by all windows (backlog B1). */
  docs: DocStore;
  /** Several windows; null where there is only one (browser). */
  windows: AppWindows | null;
  /** The user's custom stamp images (Phase 3). */
  stamps: StampLibrary;
  /** qpdf-repair `source` into `target` (never the same file). */
  repair(source: string, target: string): Promise<{ hadWarnings: boolean }>;
  /** Native print. Throws PlatformError("unsupported") when only WebView print exists. */
  print(req: PrintRequest): Promise<PrintResult>;
  saveAttachment(name: string, bytes: ArrayBuffer): Promise<string | null>;
  setTitle(title: string): void;
}

export interface CustomStamp {
  id: string;
  name: string;
  mime: "image/png" | "image/jpeg";
}

/** Custom stamp images, per user (Windows: config folder; browser: this session). */
export interface StampLibrary {
  list(): Promise<CustomStamp[]>;
  read(id: string): Promise<Uint8Array>;
  /** PNG or JPEG only, up to 5 MB. */
  add(name: string, bytes: Uint8Array): Promise<CustomStamp>;
  remove(id: string): Promise<void>;
}

/** Several app windows (backlog B1). Documents move by store id (platform.docs). */
export interface AppWindows {
  /** This window's label: "main" for the first window. */
  readonly label: string;
  /** A tab drag ended outside this window. True when the documents moved to another
   * window (the one under the pointer, or a new one there). */
  tabDrop(storeIds: string[]): Promise<boolean>;
  moveToNewWindow(storeIds: string[]): Promise<void>;
  /** Store ids handed to this window (at start, and after `onAdopt`). */
  takeDocs(): Promise<string[]>;
  onAdopt(cb: () => void): Promise<() => void>;
  /** Shows the window that has this document; false if no window has it. */
  focusDoc(storeId: string): Promise<boolean>;
  onFocusDoc(cb: (storeId: string) => void): Promise<() => void>;
  /** Close button. `cb` returns false to keep the window open. */
  onCloseRequested(cb: () => Promise<boolean>): Promise<() => void>;
  closeWindow(): Promise<void>;
  /** Saves a document shown in another window over its file (quit prompt). */
  saveDoc(storeId: string): Promise<DocInfo>;
  /** Exits the app (after the quit prompt). */
  quit(): Promise<void>;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** "C:\Clients\a.pdf" -> "C:\Clients\a (repaired).pdf". */
export function suffixedPath(path: string, suffix: string): string {
  const m = /^(.*?)(\.pdf)?$/i.exec(path);
  return `${m?.[1] ?? path} (${suffix}).pdf`;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Characters Windows forbids in file names, replaced so bookmark titles can name files. */
export function safeFileName(name: string): string {
  const clean = Array.from(name, (c) => (c < " " || '<>:"/\\|?*'.includes(c) ? "_" : c))
    .join("")
    .replace(/[. ]+$/, "")
    .trim();
  return clean.slice(0, 120) || "Untitled";
}
