// Form data commands (Phase 6): export to FDF/XFDF/JSON/CSV, import into the open form
// (one undoable step), and fill one new PDF per CSV row. Heavy work runs in the
// page-engine worker. Values never go to a toast or the log; field names may.
import type { WorkbenchApi } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import {
  DEFAULT_XFA_POLICY,
  copyFileName,
  formatOf,
  parseCsv,
  toCsv,
  toFdf,
  toJson,
  toXfdf,
  valuesOf,
  type CsvTable,
  type DataFormat,
  type FillReport,
  type SkipReason,
} from "../../engine/forms";
import { dirName, platform, safeFileName } from "../../platform";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const copies = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;

const REASON: Record<SkipReason, string> = {
  "read-only": "read-only",
  "too-long": "longer than the field allows",
  "not-an-option": "not one of the field's choices",
  "cannot-clear-radio": "a radio group cannot be emptied by import",
  "not-fillable": "not a fillable field",
  failed: "could not be set",
};

/** "3 not filled: a (read-only), b (not one of the field's choices)…" (names only). */
export function describeSkips(r: Pick<FillReport, "skipped" | "unknown">): string {
  const parts: string[] = [];
  if (r.skipped.length) {
    const shown = r.skipped
      .slice(0, 5)
      .map((s) => `${s.name} (${REASON[s.reason]})`)
      .join(", ");
    parts.push(
      `${plural(r.skipped.length, "field")} not filled: ${shown}${r.skipped.length > 5 ? "…" : ""}`,
    );
  }
  if (r.unknown.length)
    parts.push(`${plural(r.unknown.length, "name")} in the file match no field in this form`);
  return parts.join(". ");
}

export async function exportFormData(
  wb: WorkbenchApi,
  documentId: string,
  format: DataFormat,
): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  const m = wb.meta[documentId];
  if (!bytes || !m) return;
  try {
    const fields = await pageOp("formFields", bytes);
    if (!fields.length) {
      wb.toast("This document has no form fields to export.");
      return;
    }
    const raw = format === "fdf" || format === "xfdf";
    const values = valuesOf(fields, raw ? "raw" : "label");
    const buttons = new Set(
      fields.filter((f) => f.kind === "checkbox" || f.kind === "radio").map((f) => f.name),
    );
    const text =
      format === "fdf"
        ? toFdf(values, buttons, m.name)
        : format === "xfdf"
          ? toXfdf(values, m.name)
          : format === "json"
            ? toJson(values, m.name)
            : toCsv(Object.keys(values), [values]);
    const fileName = safeFileName(`${stem(m.name)} data.${format}`);
    const suggested =
      m.source.kind === "path" ? `${dirName(m.source.path)}\\${fileName}` : fileName;
    const kind = format === "xfdf" ? "xfdf" : format;
    const target = await platform.pickSavePath(suggested, kind);
    if (!target) return;
    await platform.saveAs(
      target,
      m.source.kind === "path" ? m.source.path : null,
      new TextEncoder().encode(text),
    );
    wb.toast(`Form data exported (${plural(Object.keys(values).length, "field")}).`);
  } catch (e) {
    wb.toast(`Export failed: ${message(e)}`, "error");
  }
}

export async function importFormData(wb: WorkbenchApi, documentId: string): Promise<void> {
  const [file] = await platform.pickFiles({ formData: true });
  if (!file) return;
  const format = formatOf(file.name);
  if (!format) {
    wb.toast("Pick an FDF, XFDF, JSON or CSV file.", "error");
    return;
  }
  let rows;
  try {
    rows = await pageOp("parseFormData", new Uint8Array(file.bytes), format);
  } catch (e) {
    wb.toast(`Cannot import: ${message(e)}.`, "error");
    return;
  }
  const values = rows[0];
  if (!values || !Object.keys(values).length) {
    wb.toast("The file holds no field values.");
    return;
  }
  let report: FillReport | null = null;
  const ok = await wb.edit(documentId, "Import form data", async (bytes) => {
    const r = await pageOp("fillForm", bytes, values);
    report = r;
    return r.bytes;
  });
  if (!ok || !report) return;
  const r: FillReport = report;
  const more = rows.length > 1 ? ` The CSV has ${rows.length} rows; only the first was used.` : "";
  const skips = describeSkips(r);
  wb.toast(
    `Imported ${plural(r.filled.length, "field")}.${more}${skips ? ` ${skips}.` : ""} Ctrl+Z undoes it.`,
    skips ? "error" : undefined,
  );
}

/** Picks a CSV for Fill from CSV; null when cancelled or unreadable (already told). */
export async function pickCsvTable(
  wb: WorkbenchApi,
): Promise<{ name: string; table: CsvTable } | null> {
  const [file] = await platform.pickFiles({ csv: true });
  if (!file) return null;
  try {
    return { name: file.name, table: parseCsv(new TextDecoder().decode(file.bytes)) };
  } catch (e) {
    wb.toast(`Cannot read the CSV: ${message(e)}.`, "error");
    return null;
  }
}

export interface BatchProgress {
  done: number;
  total: number;
}

/**
 * One new PDF per row, written into a folder the user picks (never over a file).
 * `nameColumn`: the CSV column that names each file; null = row numbers.
 */
export async function fillCopies(
  wb: WorkbenchApi,
  documentId: string,
  table: CsvTable,
  nameColumn: string | null,
  onProgress: (p: BatchProgress) => void,
  cancelled: () => boolean,
): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  const m = wb.meta[documentId];
  if (!bytes || !m) return;
  const folder = await platform.pickFolder();
  if (!folder) return;
  const total = table.rows.length;
  const col = nameColumn ? table.names.indexOf(nameColumn) : -1;
  let written = 0;
  const skipped = new Map<string, SkipReason>();
  const unknown = new Set<string>();
  try {
    for (let row = 0; row < total; row++) {
      if (cancelled()) break;
      onProgress({ done: row, total });
      const values: Record<string, string> = {};
      table.names.forEach((n, k) => {
        const v = table.rows[row]?.[k] ?? "";
        if (v !== "") values[n] = v;
      });
      const r = await pageOp("fillCopy", bytes, values, DEFAULT_XFA_POLICY);
      for (const s of r.skipped) skipped.set(s.name, s.reason);
      for (const u of r.unknown) unknown.add(u);
      const name = copyFileName(
        stem(m.name),
        row,
        total,
        col >= 0 ? table.rows[row]?.[col] : undefined,
      );
      await platform.writeNewFile(folder, name, r.bytes);
      written++;
    }
  } catch (e) {
    wb.toast(`Fill from CSV stopped after ${copies(written)}: ${message(e)}`, "error");
    return;
  } finally {
    onProgress({ done: total, total });
  }
  const skips = describeSkips({
    skipped: [...skipped].map(([name, reason]) => ({ name, reason })),
    unknown: [...unknown],
  });
  const stopped = written < total ? ` Stopped at your request (${total - written} not made).` : "";
  wb.toast(
    `${copies(written)} filled and written to ${folder}.${stopped}${skips ? ` ${skips}.` : ""} ` +
      `The form itself is unchanged.`,
    skips ? "error" : undefined,
  );
}

/** Flatten form: "<name> (flattened form).pdf" next to the document, opened in a new tab. */
export async function flattenFormToNewFile(wb: WorkbenchApi, documentId: string): Promise<void> {
  const bytes = await wb.docBytes(documentId);
  const m = wb.meta[documentId];
  if (!bytes || !m) {
    wb.toast("This document cannot be flattened (it is password-protected).", "error");
    return;
  }
  try {
    const r = await pageOp("flattenForm", bytes);
    if (r.drawn + r.hidden + r.empty === 0) {
      wb.toast("This document has no form fields to flatten.");
      return;
    }
    const name = safeFileName(`${stem(m.name)} (flattened form).pdf`);
    let path: string | null;
    if (m.source.kind === "path")
      path = await platform.writeNewFile(dirName(m.source.path), name, r.bytes);
    else {
      path = await platform.pickSavePath(name);
      if (path) await platform.saveAs(path, null, r.bytes);
    }
    if (!path) return;
    const hidden = r.hidden ? ` ${plural(r.hidden, "hidden field")} removed without printing.` : "";
    wb.toast(
      `Flattened ${plural(r.drawn, "field")} into a new file.${hidden} The original is unchanged.`,
    );
    await wb.openPaths([path]);
  } catch (e) {
    wb.toast(`Flatten failed: ${message(e)}`, "error");
  }
}
