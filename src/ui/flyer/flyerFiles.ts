// Workpaper Tools file commands (Phase 4): Stamp Summary to CSV, workpaper settings
// export/import, and the firm tickmark file. Nothing is overwritten without the user
// picking the path.
import type { WorkbenchApi } from "../../app/workbench";
import { summaryCsv, type SummaryRow } from "../../flyer/items";
import {
  importTickmarks,
  makeWorkpaperFile,
  parseWorkpaperFile,
  type WorkpaperFile,
} from "../../flyer/library";
import { dirName, platform, safeFileName } from "../../platform";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stem = (name: string) => name.replace(/\.pdf$/i, "");

/** Summary rows per open document, kept current by FlyerOverlay. */
export const summarySources = new Map<string, () => SummaryRow[]>();

export const formatWhen = (d: Date) =>
  d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

export async function exportSummaryCsv(wb: WorkbenchApi, documentId: string): Promise<void> {
  const m = wb.meta[documentId];
  const rows = summarySources.get(documentId)?.();
  if (!m || !rows) return;
  const name = safeFileName(`${stem(m.name)} (stamp summary).csv`);
  const suggested = m.source.kind === "path" ? `${dirName(m.source.path)}\\${name}` : name;
  try {
    const target = await platform.pickSavePath(suggested, "csv");
    if (!target) return;
    // BOM: Excel then reads the file as UTF-8.
    const bytes = new TextEncoder().encode("﻿" + summaryCsv(rows, formatWhen));
    await platform.saveAs(target, m.source.kind === "path" ? m.source.path : null, bytes);
    wb.toast(`Stamp Summary exported (${rows.length} item(s)).`);
  } catch (e) {
    wb.toast(`Export failed: ${message(e)}`, "error");
  }
}

/** The user's tickmarks as a workpaper settings file (also how the firm file is made). */
export async function exportWorkpaperSettings(wb: WorkbenchApi): Promise<void> {
  try {
    const target = await platform.pickSavePath("Workpaper settings.json", "json");
    if (!target) return;
    const file = makeWorkpaperFile(wb.settings.tickmarks);
    await platform.saveAs(target, null, new TextEncoder().encode(JSON.stringify(file, null, 2)));
    wb.toast(`Exported ${file.tickmarks.length} tickmark(s).`);
  } catch (e) {
    wb.toast(`Export failed: ${message(e)}`, "error");
  }
}

/** Adds a file's tickmarks to the user's own (same id: replaced). */
export async function importWorkpaperSettings(wb: WorkbenchApi): Promise<void> {
  const [file] = await platform.pickFiles({ json: true });
  if (!file) return;
  try {
    const parsed = parseWorkpaperFile(new TextDecoder().decode(file.bytes));
    wb.updateSettings({ tickmarks: importTickmarks(wb.settings.tickmarks, parsed.tickmarks) });
    wb.toast(`Imported ${parsed.tickmarks.length} tickmark(s).`);
  } catch (e) {
    wb.toast(`Import failed: ${message(e)}`, "error");
  }
}

/** Reads the firm tickmark file (share path). Throws when it cannot be read. */
export async function readFirmTickmarks(path: string): Promise<WorkpaperFile> {
  const file = await platform.readPath(path);
  return parseWorkpaperFile(new TextDecoder().decode(file.bytes));
}
