// Reset form and Clear fields (Phase 6). Reset puts each field back to its default
// (/DV, inherited like Acrobat does; none = empty), Clear empties it. Both return new
// bytes: the app records them as one undoable step.
//
// Text and choice fields go through PDFium's form-fill path, which redraws their
// appearance. Checkboxes and radio buttons are set in the objects (field /V and each
// widget's /AS) with qpdf: PDFium cannot turn a radio group off, and buttons already
// carry an appearance for every state, so nothing needs redrawing. Read-only fields are
// left alone and reported (the user cannot change them in the viewer either).
// Node-safe.

import type { PdfDocumentObject } from "@embedpdf/models";
import type { PdfiumModule } from "../pdfium";
import type { PagesCtx } from "../pages";
import { editRaw } from "../pages/raw";
import { runToFile } from "../pages/qpdf";
import { PdfObjects, isRef, withKey, type JDict, type JVal } from "../redact/objects";
import { pageWidgets, readFields, type FormField } from "./fields";

export interface ResetRequest {
  /** "default": back to /DV (Reset form). "empty": blank / unchecked (Clear). */
  to: "default" | "empty";
  /** Fully qualified names; omitted = every field. */
  names?: string[];
}

export interface ResetReport {
  bytes: Uint8Array;
  changed: string[];
  /** Read-only fields that were not touched. */
  readOnly: string[];
}

const BUTTONS = new Set(["checkbox", "radio"]);
const text = (v: JVal | undefined) => (typeof v === "string" ? v.replace(/^u:|^b:|^\//, "") : null);

export async function resetFields(
  ctx: PagesCtx,
  bytes: Uint8Array,
  req: ResetRequest,
): Promise<ResetReport> {
  const objs = await PdfObjects.read(ctx.qpdf, bytes);
  const terminals = terminalFields(objs);
  const defaults = new Map<string, string | null>();
  for (const [name, t] of terminals) defaults.set(name, req.to === "empty" ? null : t.dv);

  const doc = await ctx.engine
    .openDocumentBuffer({ id: `reset-${crypto.randomUUID()}`, content: bytes.slice().buffer })
    .toPromise();
  let out: Uint8Array;
  const changed: string[] = [];
  const readOnly: string[] = [];
  // Set in the objects: buttons, and choices left with no selection (PDFium cannot
  // deselect a dropdown); the choices' appearances are redrawn afterwards.
  const buttons: FormField[] = [];
  const unselect: FormField[] = [];
  try {
    const wanted = req.names ? new Set(req.names) : null;
    for (const f of await readFields(ctx.engine, doc)) {
      if (wanted && !wanted.has(f.name)) continue;
      if (f.kind === "signature" || f.kind === "button" || f.kind === "unknown") continue;
      if (f.readOnly) {
        readOnly.push(f.name);
        continue;
      }
      const dv = defaults.get(f.name) ?? null;
      if (BUTTONS.has(f.kind)) buttons.push(f);
      else if (f.kind !== "text" && !(dv && f.options.includes(dv))) {
        if (f.value !== "") unselect.push(f);
      } else if (await setTextOrChoice(ctx, doc, f, dv ?? "")) changed.push(f.name);
    }
    out = new Uint8Array(await ctx.engine.saveAsCopy(doc).toPromise());
  } finally {
    await ctx.engine.closeDocument(doc).toPromise();
  }

  if (buttons.length || unselect.length) {
    // Read PDFium's output again: that is what the object edit applies to.
    const after = await PdfObjects.read(ctx.qpdf, out);
    const fields = terminalFields(after);
    for (const f of buttons) {
      const t = fields.get(f.name);
      if (t && setButton(after, t, defaults.get(f.name) ?? null)) changed.push(f.name);
    }
    for (const f of unselect) {
      const t = fields.get(f.name);
      const d = t && after.dict(t.ref);
      if (!t || !d) continue;
      after.set(t.ref, withKey(withKey(d, "/V", undefined), "/I", undefined));
      changed.push(f.name);
    }
    if (after.hasChanges) {
      out = await runToFile(ctx.qpdf, {
        inputs: {
          "in0.pdf": out,
          "edit.json": new TextEncoder().encode(after.updateJson()),
        },
        args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
        outputs: ["out.pdf"],
      });
    }
    if (unselect.length) out = redraw(ctx.module, out, new Set(unselect.map((f) => f.name)));
  }
  return { bytes: out, changed, readOnly };
}

/** Text: `value`. Dropdown/list: the option `value` (one of its options). */
async function setTextOrChoice(
  ctx: PagesCtx,
  doc: PdfDocumentObject,
  f: FormField,
  value: string,
): Promise<boolean> {
  if (f.value === value) return false;
  const first = f.widgets[0];
  const page = first && doc.pages[first.pageIndex];
  const w = page && (await pageWidgets(ctx.engine, doc, page.index)).find((x) => x.id === first.id);
  if (!w) return false;
  const set =
    f.kind === "text"
      ? ({ kind: "text", text: value } as const)
      : ({ kind: "selection", index: f.options.indexOf(value), isSelected: true } as const);
  await ctx.engine.setFormFieldValue(doc, page, w, set).toPromise();
  return true;
}

/**
 * Gives every widget of the named (choice) fields an appearance with no text, straight
 * through PDFium: EmbedPDF's regenerateWidgetAppearances finds widgets by /NM, which
 * most forms lack, and PDFium's generator still draws the old option once /V is gone.
 * So the box, border and arrow are regenerated and the text block (/Tx BMC ... EMC)
 * is emptied.
 */
function redraw(m: PdfiumModule, bytes: Uint8Array, names: Set<string>): Uint8Array {
  return editRaw(m, bytes, (doc) => {
    const info = m.PDFiumExt_OpenFormFillInfo();
    const form = m.PDFiumExt_InitFormFillEnvironment(doc.ptr, info);
    try {
      for (let p = 0; p < doc.pageCount; p++) {
        doc.withPage(p, (page) => {
          m.FORM_OnAfterLoadPage(page, form);
          try {
            for (let i = 0; i < m.FPDFPage_GetAnnotCount(page); i++) {
              const a = m.FPDFPage_GetAnnot(page, i);
              if (!a) continue;
              try {
                if (m.FPDFAnnot_GetSubtype(a) === WIDGET && names.has(fieldName(m, form, a))) {
                  m.EPDFAnnot_GenerateFormFieldAP(a);
                  const ap = normalAppearance(m, a);
                  if (ap !== null) setNormalAppearance(m, a, emptyTextBlock(ap));
                }
              } finally {
                m.FPDFPage_CloseAnnot(a);
              }
            }
          } finally {
            m.FORM_OnBeforeClosePage(page, form);
          }
        });
      }
    } finally {
      m.PDFiumExt_ExitFormFillEnvironment(form);
      m.PDFiumExt_CloseFormFillInfo(info);
    }
  });
}

// FPDF_ANNOT_WIDGET (fpdf_annot.h).
const WIDGET = 20;

// FPDF_ANNOT_APPEARANCEMODE_NORMAL.
const AP_NORMAL = 0;

/** A field appearance with its variable text (between /Tx BMC and EMC) removed. */
export function emptyTextBlock(ap: string): string {
  return ap.replace(/\/Tx BMC[\s\S]*?EMC/, "/Tx BMC\nEMC");
}

function normalAppearance(m: PdfiumModule, annot: number): string | null {
  const n = m.FPDFAnnot_GetAP(annot, AP_NORMAL, 0, 0);
  if (n <= 2) return null;
  const p = m.pdfium.wasmExports.malloc(n);
  try {
    m.FPDFAnnot_GetAP(annot, AP_NORMAL, p, n);
    return m.pdfium.UTF16ToString(p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function setNormalAppearance(m: PdfiumModule, annot: number, ap: string): void {
  const bytes = 2 * (ap.length + 1);
  const p = m.pdfium.wasmExports.malloc(bytes);
  try {
    m.pdfium.stringToUTF16(ap, p, bytes);
    m.FPDFAnnot_SetAP(annot, AP_NORMAL, p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function fieldName(m: PdfiumModule, form: number, annot: number): string {
  const n = m.FPDFAnnot_GetFormFieldName(form, annot, 0, 0);
  if (n <= 2) return "";
  const p = m.pdfium.wasmExports.malloc(n);
  try {
    m.FPDFAnnot_GetFormFieldName(form, annot, p, n);
    return m.pdfium.UTF16ToString(p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

interface Terminal {
  ref: string;
  /** Default value as text (a button's state name), inherited from ancestors. */
  dv: string | null;
  widgets: string[];
}

/** Terminal fields by fully qualified name: the field object and its widget objects. */
function terminalFields(objs: PdfObjects): Map<string, Terminal> {
  const out = new Map<string, Terminal>();
  const form = objs.dict(objs.catalog["/AcroForm"]);
  const seen = new Set<string>();
  const walk = (ref: JVal, prefix: string, dv: string | null) => {
    if (!isRef(ref) || seen.has(ref)) return;
    seen.add(ref);
    const d = objs.dict(ref);
    if (!d) return;
    const t = text(d["/T"]);
    const name = t === null ? prefix : prefix ? `${prefix}.${t}` : t;
    const ownDv = text(d["/DV"]) ?? dv;
    const kids = objs.get(d["/Kids"]);
    const kidFields = Array.isArray(kids)
      ? kids.filter((k) => objs.dict(k)?.["/T"] !== undefined)
      : [];
    if (kidFields.length && Array.isArray(kids)) {
      for (const k of kids) walk(k, name, ownDv);
      return;
    }
    const widgets = Array.isArray(kids) ? kids.filter(isRef) : [ref];
    out.set(name, { ref, dv: ownDv, widgets });
  };
  const fields = objs.get(form?.["/Fields"]);
  if (Array.isArray(fields)) for (const f of fields) walk(f, "", null);
  return out;
}

/** Sets a button field to `state` (a state name) or off; true when something changed. */
function setButton(objs: PdfObjects, t: Terminal, state: string | null): boolean {
  let changed = false;
  const field = objs.dict(t.ref);
  if (!field) return false;
  const v: JVal | undefined = state ? `/${state}` : "/Off";
  if (field["/V"] !== v) {
    objs.set(t.ref, withKey(field, "/V", v));
    changed = true;
  }
  for (const w of t.widgets) {
    const d = w === t.ref ? objs.dict(t.ref) : objs.dict(w);
    if (!d) continue;
    const ap = objs.dict(objs.dict(d["/AP"])?.["/N"]);
    const on = state && ap && `/${state}` in ap ? `/${state}` : "/Off";
    if (d["/AS"] !== on) {
      objs.set(w, withKey(d as JDict, "/AS", on));
      changed = true;
    }
  }
  return changed;
}
