// Fill AcroForm fields by name (Phase 6): data import, fill-from-CSV and the MCP server.
// Goes through PDFium's form-fill path (focus, type, leave), the same path a user takes
// in the viewer, so appearances are regenerated the way PDFium draws them. A value that
// does not fit a field is skipped and reported, never changed to fit. Node-safe.

import type { PdfDocumentObject, PdfWidgetAnnoObject } from "@embedpdf/models";
import type { Engine } from "../pdfium";
import { pageWidgets, readFields, type FormField } from "./fields";

export type FieldValues = Record<string, string>;

export type SkipReason =
  "read-only" | "too-long" | "not-an-option" | "cannot-clear-radio" | "not-fillable" | "failed";

export interface FillReport {
  filled: string[];
  /** Field names with why they were left alone. Never holds the values. */
  skipped: { name: string; reason: SkipReason }[];
  /** Names in the data that the form does not have. */
  unknown: string[];
}

const ON = new Set(["yes", "true", "1", "x", "on", "checked"]);
const OFF = new Set(["", "off", "no", "false", "0", "unchecked"]);

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

/** Fills `values` into an open document. Fields not named in `values` are not touched. */
export async function fillOpenDocument(
  engine: Engine,
  doc: PdfDocumentObject,
  values: FieldValues,
): Promise<FillReport> {
  const fields = new Map((await readFields(engine, doc)).map((f) => [f.name, f]));
  const report: FillReport = { filled: [], skipped: [], unknown: [] };
  const widgetCache = new Map<number, PdfWidgetAnnoObject[]>();
  const widget = async (pageIndex: number, id: string) => {
    let list = widgetCache.get(pageIndex);
    if (!list) widgetCache.set(pageIndex, (list = await pageWidgets(engine, doc, pageIndex)));
    return list.find((w) => w.id === id);
  };

  for (const [name, raw] of Object.entries(values)) {
    const f = fields.get(name);
    if (!f) {
      report.unknown.push(name);
      continue;
    }
    const value = raw ?? "";
    const skip = (reason: SkipReason) => report.skipped.push({ name, reason });
    if (f.readOnly) {
      skip("read-only");
      continue;
    }
    const plan = planFill(f, value);
    if ("skip" in plan) {
      skip(plan.skip);
      continue;
    }
    if (plan.noop) {
      report.filled.push(name);
      continue;
    }
    const target = f.widgets[plan.widget];
    const page = target && doc.pages[target.pageIndex];
    const w = page && (await widget(page.index, target.id));
    if (!w) {
      skip("failed");
      continue;
    }
    try {
      await engine.setFormFieldValue(doc, page, w, plan.set).toPromise();
      widgetCache.delete(page.index);
      report.filled.push(name);
    } catch {
      skip("failed");
    }
  }
  return report;
}

type FormValue =
  | { kind: "text"; text: string }
  | { kind: "checked"; checked: boolean }
  | { kind: "selection"; index: number; isSelected: boolean };

type Plan =
  { skip: SkipReason } | { noop: true } | { noop?: false; widget: number; set: FormValue };

/** What to do for one field and value; exported for unit tests. */
export function planFill(f: FormField, value: string): Plan {
  switch (f.kind) {
    case "text":
      if (f.maxLen && [...value].length > f.maxLen) return { skip: "too-long" };
      if (value === f.value) return { noop: true };
      return { widget: 0, set: { kind: "text", text: value } };
    case "checkbox": {
      const v = value.trim().toLowerCase();
      const on = ON.has(v) || f.options.some((o) => same(o, value.trim()));
      if (!on && !OFF.has(v)) return { skip: "not-an-option" };
      if (on === (f.value !== "Off")) return { noop: true };
      return { widget: 0, set: { kind: "checked", checked: on } };
    }
    case "radio": {
      const v = value.trim();
      if (OFF.has(v.toLowerCase()) && !f.options.some((o) => same(o, v))) {
        return f.value === "Off" ? { noop: true } : { skip: "cannot-clear-radio" };
      }
      const i = f.widgets.findIndex(
        (w) =>
          (w.label !== undefined && same(w.label, v)) ||
          (w.exportValue !== undefined && same(w.exportValue, v)),
      );
      if (i < 0) return { skip: "not-an-option" };
      if (same(f.value, v)) return { noop: true };
      return { widget: i, set: { kind: "checked", checked: true } };
    }
    case "dropdown":
    case "list": {
      const i = f.options.findIndex((o) => same(o, value.trim()));
      if (i < 0) return { skip: "not-an-option" };
      if (same(f.value, f.options[i] ?? "")) return { noop: true };
      return { widget: 0, set: { kind: "selection", index: i, isSelected: true } };
    }
    default:
      return { skip: "not-fillable" };
  }
}

/** Copy of `bytes` with `values` filled in. */
export async function fillForm(
  engine: Engine,
  bytes: Uint8Array,
  values: FieldValues,
): Promise<FillReport & { bytes: Uint8Array }> {
  const doc = await engine
    .openDocumentBuffer({ id: `fill-${crypto.randomUUID()}`, content: bytes.slice().buffer })
    .toPromise();
  try {
    const report = await fillOpenDocument(engine, doc, values);
    return { ...report, bytes: new Uint8Array(await engine.saveAsCopy(doc).toPromise()) };
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}

/** Field names and values of `bytes` (buttons as on-state name or "Off"). */
export async function formValues(engine: Engine, bytes: Uint8Array): Promise<FieldValues> {
  const doc = await engine
    .openDocumentBuffer({ id: `values-${crypto.randomUUID()}`, content: bytes.slice().buffer })
    .toPromise();
  try {
    const out: FieldValues = {};
    for (const f of await readFields(engine, doc)) {
      if (f.kind !== "signature" && f.kind !== "button") out[f.name] = f.value;
    }
    return out;
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}
