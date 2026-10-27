// Windows app: Rust commands in src-tauri/src (fileio, launch, settings, repair, print,
// docstore, windows).
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { decodeResult, encodeJob } from "../engine/pages/qpdf-wire";
import { QpdfError, type Qpdf } from "../engine/pages/qpdf";
import type { DocInfo, DocStore } from "../app/docstore";
import type { FontIndexCache } from "../engine/edit/fonts";
import {
  PlatformError,
  baseName,
  type AppWindows,
  type CustomStamp,
  type FontFolders,
  type StampLibrary,
  type FileErrorKind,
  type OpenedFile,
  type Platform,
  type PrintRequest,
  type PrintResult,
} from "./types";

/** Rust `FileError` arrives as `{ kind, message }`; anything else becomes "other". */
function toPlatformError(e: unknown): PlatformError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    const { kind, message } = e as { kind: FileErrorKind; message: string };
    return new PlatformError(kind, message);
  }
  return new PlatformError("other", typeof e === "string" ? e : String(e));
}

async function call<T>(
  cmd: string,
  args?: Parameters<typeof invoke>[1],
  options?: Parameters<typeof invoke>[2],
): Promise<T> {
  try {
    return await invoke<T>(cmd, args, options);
  } catch (e) {
    throw toPlatformError(e);
  }
}

async function readPath(path: string): Promise<OpenedFile> {
  const bytes = await call<ArrayBuffer>("read_pdf", { path });
  return { source: { kind: "path", path }, name: baseName(path), bytes };
}

const headers = (h: Record<string, string>) => ({
  headers: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, encodeURIComponent(v)])),
});

const qpdf: Qpdf = {
  async run(job) {
    try {
      const out = await invoke<ArrayBuffer>("qpdf_run", encodeJob(job));
      return decodeResult(new Uint8Array(out));
    } catch (e) {
      const err = toPlatformError(e);
      throw new QpdfError(
        err.kind === "qpdfMissing" ? "qpdf is missing from this installation." : err.message,
      );
    }
  },
};

// Document store in Rust (src-tauri/src/docstore.rs), shared by all windows. Bytes go
// raw; the rest in a percent-encoded JSON header.
const docHeader = (v: object) => ({ headers: { "x-doc": encodeURIComponent(JSON.stringify(v)) } });

const docs: DocStore = {
  create: (id, bytes, init) => call<DocInfo>("doc_create", bytes, docHeader({ id, ...init })),
  info: (id) => call<DocInfo>("doc_info", { id }),
  current: async (id) => new Uint8Array(await call<ArrayBuffer>("doc_current", { id })),
  push: (id, bytes, label) => call<DocInfo>("doc_push", bytes, docHeader({ id, label })),
  undo: (id) => step(id, false),
  redo: (id) => step(id, true),
  markSaved: (id, saved) => call<DocInfo>("doc_mark_saved", { id, saved: saved ?? null }),
  acceptSignature: (id) => call<DocInfo>("doc_accept_signature", { id }),
  clearTrimmed: (id) => call<DocInfo>("doc_clear_trimmed", { id }),
  setMarkupPending: (id, pending) => call<DocInfo>("doc_set_markup_pending", { id, pending }),
  async release(id) {
    await call("doc_release", { id });
  },
  dirty: () => call<DocInfo[]>("doc_dirty"),
  findPath: (path) => call<DocInfo | null>("doc_find_path", { path }),
};

async function step(id: string, redo: boolean) {
  const info = await call<DocInfo | null>("doc_step", { id, redo });
  return info ? { info, bytes: await docs.current(id) } : null;
}

// Events are listened to on this window only: a plain listen() would also receive
// events sent to other windows. Lazy: this module also loads in the browser build.
const thisWindow = () => getCurrentWebviewWindow();

const windows: AppWindows = {
  get label() {
    return thisWindow().label;
  },
  tabDrop: async (ids) => (await call<string | null>("tab_drop", { ids })) !== null,
  async moveToNewWindow(ids) {
    await call<string>("move_to_new_window", { ids });
  },
  takeDocs: () => call<string[]>("take_window_docs"),
  onAdopt: (cb) => thisWindow().listen("adopt-docs", () => cb()),
  focusDoc: (id) => call<boolean>("focus_doc", { id }),
  onFocusDoc: (cb) => thisWindow().listen<string>("focus-doc", (e) => cb(e.payload)),
  onCloseRequested: (cb) =>
    thisWindow().onCloseRequested(async (e) => {
      if (!(await cb())) e.preventDefault();
    }),
  closeWindow: () => thisWindow().destroy(),
  saveDoc: (id) => call<DocInfo>("doc_save", { id }),
  async quit() {
    await call("quit_app");
  },
};

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "tif", "tiff"];

const stamps: StampLibrary = {
  list: () => call<CustomStamp[]>("stamps_list"),
  read: async (id) => new Uint8Array(await call<ArrayBuffer>("stamp_read", { id })),
  add: (name, bytes) =>
    call<CustomStamp>("stamp_add", bytes, {
      headers: { "x-stamp": encodeURIComponent(JSON.stringify({ name })) },
    }),
  remove: async (id) => {
    await call("stamp_remove", { id });
  },
};

const fonts: FontFolders = {
  list: (firm) => call("fonts_list", { firm }),
  read: async (path) => new Uint8Array(await call<ArrayBuffer>("font_read", { path })),
  loadIndex: () => call<FontIndexCache | null>("font_index_load"),
  saveIndex: async (cache) => {
    await call("font_index_save", { value: cache });
  },
};

export const tauriPlatform: Platform = {
  userDisplayName: () => call<string | null>("user_display_name").catch(() => null),
  kind: "tauri",

  async pickFiles(opts) {
    const picked = await open({
      multiple: !opts?.pictures && !opts?.json,
      directory: false,
      filters: opts?.json
        ? [{ name: "Workpaper settings (JSON)", extensions: ["json"] }]
        : opts?.xfdf
          ? [{ name: "Comments (XFDF)", extensions: ["xfdf"] }]
          : opts?.pictures
            ? [{ name: "Images (JPEG, PNG)", extensions: ["jpg", "jpeg", "png"] }]
            : opts?.images
              ? [
                  { name: "PDF and image files", extensions: ["pdf", ...IMAGE_EXTENSIONS] },
                  { name: "PDF files", extensions: ["pdf"] },
                  { name: "Images", extensions: IMAGE_EXTENSIONS },
                ]
              : [{ name: "PDF files", extensions: ["pdf"] }],
    });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    // Read one by one so a locked file does not block the others; errors propagate per file.
    const out: OpenedFile[] = [];
    for (const p of paths) out.push(await readPath(p));
    return out;
  },

  readPath,

  async pickFolder() {
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  },

  listFolder: (path) => call<string[]>("list_folder", { path }),

  async save(path, bytes) {
    await call("save_pdf", bytes, headers({ "x-target": path }));
  },

  async saveAs(target, source, bytes) {
    await call(
      "save_pdf_as",
      bytes,
      headers(source ? { "x-target": target, "x-source": source } : { "x-target": target }),
    );
  },

  async discardBackup(path) {
    await call("discard_backup", { path });
  },

  writeNewFile: (folder, name, bytes) =>
    call<string>("write_new_file", bytes, headers({ "x-folder": folder, "x-name": name })),

  qpdf,
  docs,
  windows,
  stamps,
  fonts,

  takeLaunchPaths: () => call<string[]>("take_launch_paths"),

  async onOpenPaths(cb) {
    return thisWindow().listen<string[]>("open-paths", (e) => cb(e.payload));
  },

  async onFileDrop(cb) {
    return getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") cb(e.payload.paths);
    });
  },

  loadSettings: () => call<unknown>("get_settings"),

  async saveSettings(value) {
    await call("set_settings", { value });
  },

  async pickSavePath(suggested, kind = "pdf") {
    const filter =
      kind === "xfdf"
        ? { name: "Comments (XFDF)", extensions: ["xfdf"] }
        : kind === "json"
          ? { name: "Workpaper settings (JSON)", extensions: ["json"] }
          : kind === "csv"
            ? { name: "CSV (Excel)", extensions: ["csv"] }
            : { name: "PDF files", extensions: ["pdf"] };
    return save({ defaultPath: suggested, filters: [filter] });
  },

  repair: (source, target) => call<{ hadWarnings: boolean }>("repair_pdf", { source, target }),

  async print(req: PrintRequest): Promise<PrintResult> {
    const options = {
      title: req.title,
      scaling: req.scaling,
      autoRotate: req.autoRotate,
      currentPage: req.currentPage,
    };
    const r = await call<{ status: "printed" | "cancelled"; pages: number }>(
      "print_pdf",
      new Uint8Array(req.bytes),
      { headers: { "x-options": encodeURIComponent(JSON.stringify(options)) } },
    );
    return r.status === "printed" ? { status: "printed", pages: r.pages } : { status: "cancelled" };
  },

  async saveAttachment(name, bytes) {
    const target = await save({ defaultPath: name });
    if (!target) return null;
    await call("save_pdf_as", new Uint8Array(bytes), {
      headers: { "x-target": encodeURIComponent(target) },
    });
    return target;
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },
};
