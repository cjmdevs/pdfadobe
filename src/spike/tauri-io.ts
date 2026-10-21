// Native file dialogs + Rust file IO (src-tauri/src/fileio.rs). Spike scope.

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openPdfNative(): Promise<{ path: string; bytes: ArrayBuffer } | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  const bytes = await invoke<ArrayBuffer>("read_pdf", { path });
  return { path, bytes };
}

/** Save As: asks for a target; Rust refuses to overwrite the source and writes atomically. */
export async function savePdfNative(
  bytes: ArrayBuffer,
  sourcePath: string | null,
): Promise<string | null> {
  const suggested = sourcePath
    ? sourcePath.replace(/(\.pdf)?$/i, " (spike).pdf")
    : "spike-output.pdf";
  const target = await save({
    defaultPath: suggested,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!target) return null;
  const headers: Record<string, string> = { "x-target": encodeURIComponent(target) };
  if (sourcePath) headers["x-source"] = encodeURIComponent(sourcePath);
  await invoke("save_pdf_as", new Uint8Array(bytes), { headers });
  return target;
}
