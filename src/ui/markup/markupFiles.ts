// Markup file commands (Phase 3): flatten to a new file, XFDF export/import, comment
// summary. Heavy work runs in the page-engine worker; files are never overwritten.
import type { WorkbenchApi } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import type { FlattenTarget } from "../../engine/flatten";
import { dirName, platform, safeFileName } from "../../platform";

const stem = (name: string) => name.replace(/\.pdf$/i, "");

/** "<name> (<suffix>).pdf" next to the document, or where the user picks for unsaved ones. */
async function writeNext(
  wb: WorkbenchApi,
  documentId: string,
  suffix: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const m = wb.meta[documentId];
  if (!m) return null;
  const name = safeFileName(`${stem(m.name)} (${suffix}).pdf`);
  if (m.source.kind === "path") return platform.writeNewFile(dirName(m.source.path), name, bytes);
  const target = await platform.pickSavePath(name);
  if (!target) return null;
  await platform.saveAs(target, null, bytes);
  return target;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function flattenToNewFile(
  wb: WorkbenchApi,
  documentId: string,
  target: FlattenTarget,
): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  if (!bytes) {
    wb.toast("This document cannot be flattened (it is password-protected).", "error");
    return;
  }
  try {
    const out = await pageOp("flattenMarkup", bytes, target);
    if (out.flattened === 0) {
      wb.toast("There was no markup to flatten.");
      return;
    }
    const path = await writeNext(wb, documentId, "flattened", out.bytes);
    if (!path) return;
    wb.toast(`Flattened ${out.flattened} comment(s) into a new file. The original is unchanged.`);
    await wb.openPaths([path]);
  } catch (e) {
    wb.toast(`Flatten failed: ${message(e)}`, "error");
  }
}

export async function summaryToNewFile(wb: WorkbenchApi, documentId: string): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  const m = wb.meta[documentId];
  if (!bytes || !m) return;
  try {
    const out = await pageOp("summarizeComments", bytes, m.name, navigator.language);
    const path = await writeNext(wb, documentId, "comment summary", out.pdf);
    if (!path) return;
    wb.toast(`Comment summary created (${out.comments} comment(s)).`);
    await wb.openPaths([path]);
  } catch (e) {
    wb.toast(`Comment summary failed: ${message(e)}`, "error");
  }
}

export async function exportXfdfFile(wb: WorkbenchApi, documentId: string): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  const m = wb.meta[documentId];
  if (!bytes || !m) return;
  try {
    const xml = await pageOp("exportXfdf", bytes, m.name);
    const suggested =
      m.source.kind === "path"
        ? `${dirName(m.source.path)}\\${safeFileName(`${stem(m.name)}.xfdf`)}`
        : safeFileName(`${stem(m.name)}.xfdf`);
    const target = await platform.pickSavePath(suggested, "xfdf");
    if (!target) return;
    await platform.saveAs(
      target,
      m.source.kind === "path" ? m.source.path : null,
      new TextEncoder().encode(xml),
    );
    wb.toast("Comments exported.");
  } catch (e) {
    wb.toast(`Export failed: ${message(e)}`, "error");
  }
}

/** Picks an XFDF file and returns its text (null when cancelled). */
export async function pickXfdf(): Promise<string | null> {
  const [file] = await platform.pickFiles({ xfdf: true });
  return file ? new TextDecoder().decode(file.bytes) : null;
}
