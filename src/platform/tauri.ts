// Windows app: Rust commands in src-tauri/src (fileio, launch, settings, repair, print).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  PlatformError,
  baseName,
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

export const tauriPlatform: Platform = {
  kind: "tauri",

  async pickFiles() {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "PDF files", extensions: ["pdf"] }],
    });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    // Read one by one so a locked file does not block the others; errors propagate per file.
    const out: OpenedFile[] = [];
    for (const p of paths) out.push(await readPath(p));
    return out;
  },

  readPath,

  takeLaunchPaths: () => call<string[]>("take_launch_paths"),

  async onOpenPaths(cb) {
    return listen<string[]>("open-paths", (e) => cb(e.payload));
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

  async pickSavePath(suggested) {
    return save({ defaultPath: suggested, filters: [{ name: "PDF files", extensions: ["pdf"] }] });
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
