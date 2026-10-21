// Everything the UI needs from the host. Two implementations:
// - tauri.ts: the real Windows app (Rust file IO, native dialogs, qpdf, native print).
// - browser.ts: plain browser for dev and Playwright (files via <input>, drag-drop, and a
//   test-only mock file system served at /__mockfs/ that Playwright intercepts).

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
  | "unrepairable"
  | "unsupported"
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
  /** Native open dialog (multi-select). Empty array when cancelled. */
  pickFiles(): Promise<OpenedFile[]>;
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
  /** qpdf-repair `source` into `target` (never the same file). */
  repair(source: string, target: string): Promise<{ hadWarnings: boolean }>;
  /** Native print. Throws PlatformError("unsupported") when only WebView print exists. */
  print(req: PrintRequest): Promise<PrintResult>;
  saveAttachment(name: string, bytes: ArrayBuffer): Promise<string | null>;
  setTitle(title: string): void;
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
