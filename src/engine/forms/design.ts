// Prepare Form (Phase 6): add fields and set the properties PDFium cannot. Each call
// returns new bytes (one undoable step in the app). Moving, resizing, deleting, renaming
// and the required / read-only / multiline flags happen live in the viewer through
// EmbedPDF instead.
//
// PDFium creates text, checkbox, radio and dropdown fields; qpdf then fixes what it
// leaves out (docs/forms-spike-report.md): the Print flag, readable radio export values
// instead of UUIDs, max length on the field (Acrobat ignores it on the widget), default
// value, and the Acrobat format scripts for number and date fields. Signature fields
// are written with qpdf alone (PDFium refuses to create them). Node-safe.

import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  PdfStandardFont,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import type { PagesCtx } from "../pages";
import { runToFile } from "../pages/qpdf";
import { PdfObjects, isRef, withKey, type JDict, type JVal } from "../redact/objects";
import { pageWidgets, readFields } from "./fields";
import { terminalFields } from "./reset";

export type NewFieldKind = "text" | "checkbox" | "radio" | "dropdown" | "date" | "signature";

/** A rectangle in PDF user space (points, bottom-left origin). */
export interface PdfRect {
  l: number;
  b: number;
  r: number;
  t: number;
}

export interface NewField {
  kind: NewFieldKind;
  pageIndex: number;
  rect: PdfRect;
  /** Fully qualified name; omitted = "Text1", "Check Box1"... like Acrobat. */
  name?: string;
  /** Radio only: add this button to the existing group with this name. */
  joinGroup?: string;
  /** Text only: several lines (a notes box). */
  multiline?: boolean;
}

/** Size of a field placed with one click, in points (Acrobat's defaults, roughly). */
export const DEFAULT_SIZE: Record<NewFieldKind, { w: number; h: number }> = {
  text: { w: 144, h: 20 },
  checkbox: { w: 14, h: 14 },
  radio: { w: 14, h: 14 },
  dropdown: { w: 120, h: 20 },
  date: { w: 90, h: 20 },
  signature: { w: 180, h: 36 },
};

export const DEFAULT_DATE_PATTERN = "mm/dd/yyyy";

export class FormDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormDesignError";
  }
}

const BASE_NAME: Record<NewFieldKind, string> = {
  text: "Text",
  checkbox: "Check Box",
  radio: "Group",
  dropdown: "Dropdown",
  date: "Date",
  signature: "Signature",
};

const FIELD_TYPE: Record<Exclude<NewFieldKind, "signature">, PDF_FORM_FIELD_TYPE> = {
  text: PDF_FORM_FIELD_TYPE.TEXTFIELD,
  date: PDF_FORM_FIELD_TYPE.TEXTFIELD,
  checkbox: PDF_FORM_FIELD_TYPE.CHECKBOX,
  radio: PDF_FORM_FIELD_TYPE.RADIOBUTTON,
  dropdown: PDF_FORM_FIELD_TYPE.COMBOBOX,
};

const PRINT = 4;

function nextName(kind: NewFieldKind, taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const n = `${BASE_NAME[kind]}${i}`;
    if (!taken.has(n)) return n;
  }
}

async function apply(ctx: PagesCtx, bytes: Uint8Array, objs: PdfObjects): Promise<Uint8Array> {
  if (!objs.hasChanges) return bytes;
  return runToFile(ctx.qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": new TextEncoder().encode(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

/** Adds one field (or one more button to a radio group). Returns the field's name. */
export async function addField(
  ctx: PagesCtx,
  bytes: Uint8Array,
  spec: NewField,
): Promise<{ bytes: Uint8Array; name: string }> {
  const doc = await ctx.engine
    .openDocumentBuffer({ id: `design-${crypto.randomUUID()}`, content: bytes.slice().buffer })
    .toPromise();
  let out: Uint8Array;
  let name: string;
  const widgetId = crypto.randomUUID();
  try {
    const page = doc.pages[spec.pageIndex];
    if (!page) throw new FormDesignError(`the document has no page ${spec.pageIndex + 1}`);
    const fields = await readFields(ctx.engine, doc);
    const taken = new Set(fields.map((f) => f.name));
    if (spec.joinGroup) {
      const group = fields.find((f) => f.name === spec.joinGroup);
      if (group?.kind !== "radio")
        throw new FormDesignError(`"${spec.joinGroup}" is not a radio group`);
      name = group.name;
    } else {
      name = spec.name?.trim() || nextName(spec.kind, taken);
      if (taken.has(name)) throw new FormDesignError(`a field named "${name}" already exists`);
    }
    if (spec.kind === "signature") {
      out = bytes;
    } else {
      const w = widget(spec, page.size.height, spec.joinGroup ? `${name}#new` : name, widgetId);
      await ctx.engine.createPageAnnotation(doc, page, w).toPromise();
      if (spec.joinGroup) await joinRadioGroup(ctx, doc, name, widgetId);
      out = new Uint8Array(await ctx.engine.saveAsCopy(doc).toPromise());
    }
  } finally {
    await ctx.engine.closeDocument(doc).toPromise();
  }

  const objs = await PdfObjects.read(ctx.qpdf, out);
  if (spec.kind === "signature") addSignature(objs, spec, name);
  else fixNewWidget(objs, spec, name, widgetId);
  return { bytes: await apply(ctx, out, objs), name };
}

function widget(spec: NewField, pageHeight: number, name: string, id: string): PdfWidgetAnnoObject {
  const kind = spec.kind as Exclude<NewFieldKind, "signature">;
  const type = FIELD_TYPE[kind];
  const field =
    type === PDF_FORM_FIELD_TYPE.RADIOBUTTON || type === PDF_FORM_FIELD_TYPE.COMBOBOX
      ? { type, options: [] }
      : { type };
  return {
    type: PdfAnnotationSubtype.WIDGET,
    id,
    pageIndex: spec.pageIndex,
    rect: {
      origin: { x: spec.rect.l, y: pageHeight - spec.rect.t },
      size: { width: spec.rect.r - spec.rect.l, height: spec.rect.t - spec.rect.b },
    },
    field: { flag: PDF_FORM_FIELD_FLAG.NONE, name, alternateName: "", value: "", ...field },
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: kind === "checkbox" || kind === "radio" ? 0 : 10,
    fontColor: "#000000",
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: 1,
  } as unknown as PdfWidgetAnnoObject;
}

/** Moves the new button (created as its own field) into the existing group. */
async function joinRadioGroup(
  ctx: PagesCtx,
  doc: PdfDocumentObject,
  group: string,
  newId: string,
): Promise<void> {
  const fields = await readFields(ctx.engine, doc);
  const target = fields.find((f) => f.name === group)?.widgets[0];
  const source = fields.find((f) => f.widgets.some((w) => w.id === newId))?.widgets[0];
  if (!target || !source) throw new FormDesignError("the new radio button could not be grouped");
  const sp = doc.pages[source.pageIndex];
  const tp = doc.pages[target.pageIndex];
  const sw = sp && (await pageWidgets(ctx.engine, doc, sp.index)).find((w) => w.id === source.id);
  const tw = tp && (await pageWidgets(ctx.engine, doc, tp.index)).find((w) => w.id === target.id);
  if (!sp || !tp || !sw || !tw)
    throw new FormDesignError("the new radio button could not be grouped");
  await ctx.engine.shareWidgetField(doc, sp, sw, tp, tw).toPromise();
}

/** The widget dictionaries with this /NM (PDFium writes it as given). */
function widgetsWithNm(objs: PdfObjects, nm: string): string[] {
  return objs.refs().filter((r) => {
    const d = objs.dict(r);
    return (
      d?.["/Subtype"] === "/Widget" && typeof d["/NM"] === "string" && d["/NM"].slice(2) === nm
    );
  });
}

function fixNewWidget(objs: PdfObjects, spec: NewField, name: string, nm: string): void {
  const [ref] = widgetsWithNm(objs, nm);
  if (!ref) throw new FormDesignError("the new field could not be found after creating it");
  let w = objs.dict(ref) ?? {};
  w = withKey(w, "/F", PRINT);
  objs.set(ref, w);
  const t = terminalFields(objs).get(name);
  if (spec.kind === "radio" && t) {
    // "Choice1", "Choice2"... instead of the widget's UUID.
    const used = new Set(t.widgets.flatMap((k) => stateNames(objs, k)));
    let n = 1;
    while (used.has(`Choice${n}`)) n++;
    renameState(objs, ref, `Choice${n}`);
  }
  if (spec.kind === "date" && t)
    setFormat(objs, t.ref, { kind: "date", pattern: DEFAULT_DATE_PATTERN });
  if (spec.multiline && spec.kind === "text" && t) {
    const fd = objs.dict(t.ref) ?? {};
    const ff = typeof fd["/Ff"] === "number" ? fd["/Ff"] : 0;
    objs.set(t.ref, withKey(fd, "/Ff", ff | PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE));
  }
  // A field created on its own leaves an empty stand-in after joining a group.
  if (spec.joinGroup) dropEmptyFields(objs);
}

function stateNames(objs: PdfObjects, widgetRef: string): string[] {
  const n = objs.dict(objs.dict(objs.dict(widgetRef)?.["/AP"])?.["/N"]);
  return n && !("/BBox" in n)
    ? Object.keys(n)
        .filter((k) => k !== "/Off")
        .map((k) => k.slice(1))
    : [];
}

/** Renames a button widget's "on" state in /AP /N and /D, and /AS when it is on. */
function renameState(objs: PdfObjects, widgetRef: string, to: string): void {
  const w = objs.dict(widgetRef);
  const apAt = w?.["/AP"];
  const ap = objs.dict(apAt);
  if (!w || !ap) return;
  const [from] = stateNames(objs, widgetRef);
  if (!from || from === to) return;
  let next: JDict = ap;
  for (const key of ["/N", "/D"]) {
    const at = ap[key];
    const states = objs.dict(at);
    if (!states || "/BBox" in states) continue;
    const renamed: JDict = {};
    for (const [k, v] of Object.entries(states)) renamed[k === `/${from}` ? `/${to}` : k] = v;
    if (isRef(at)) objs.set(at, renamed);
    else next = withKey(next, key, renamed);
  }
  let nw = objs.dict(widgetRef) ?? w;
  if (isRef(apAt)) objs.set(apAt, next);
  else nw = withKey(nw, "/AP", next);
  if (nw["/AS"] === `/${from}`) nw = withKey(nw, "/AS", `/${to}`);
  objs.set(widgetRef, nw);
}

/** Removes fields that have neither a widget of their own nor kids. */
function dropEmptyFields(objs: PdfObjects): void {
  const formRef = objs.catalog["/AcroForm"];
  const form = objs.dict(formRef);
  const fields = objs.get(form?.["/Fields"]);
  if (!form || !Array.isArray(fields)) return;
  const keep = fields.filter((f) => {
    const d = objs.dict(f);
    const kids = objs.get(d?.["/Kids"]);
    return d?.["/Subtype"] === "/Widget" || (Array.isArray(kids) && kids.length > 0);
  });
  if (keep.length === fields.length) return;
  const at = form["/Fields"];
  if (isRef(at)) objs.set(at, keep);
  else if (isRef(formRef)) objs.set(formRef, withKey(form, "/Fields", keep));
  else
    objs.set(objs.catalogRef, withKey(objs.catalog, "/AcroForm", withKey(form, "/Fields", keep)));
}

function addSignature(objs: PdfObjects, spec: NewField, name: string): void {
  const pageRef = objs.pages()[spec.pageIndex];
  const page = pageRef && objs.dict(pageRef);
  if (!pageRef || !page)
    throw new FormDesignError(`the document has no page ${spec.pageIndex + 1}`);
  const w = spec.rect.r - spec.rect.l;
  const h = spec.rect.t - spec.rect.b;
  // A thin grey border, so the empty field shows where to sign (Acrobat draws its own).
  const ap = objs.newRef();
  objs.setStream(
    ap,
    { "/Type": "/XObject", "/Subtype": "/Form", "/BBox": [0, 0, w, h] },
    new TextEncoder().encode(`0.6 G 1 w 0.5 0.5 ${w - 1} ${h - 1} re S`),
  );
  const ref = objs.newRef();
  objs.set(ref, {
    "/Type": "/Annot",
    "/Subtype": "/Widget",
    "/FT": "/Sig",
    "/T": `u:${name}`,
    "/Rect": [spec.rect.l, spec.rect.b, spec.rect.r, spec.rect.t],
    "/F": PRINT,
    "/P": pageRef,
    "/MK": { "/BC": [0.6, 0.6, 0.6] },
    "/AP": { "/N": ap },
  });
  const annotsAt = page["/Annots"];
  const annots = objs.get(annotsAt);
  const list = Array.isArray(annots) ? [...annots, ref] : [ref];
  if (isRef(annotsAt)) objs.set(annotsAt, list);
  else objs.set(pageRef, withKey(page, "/Annots", list));
  const formRef = objs.catalog["/AcroForm"];
  const form = objs.dict(formRef) ?? {};
  const fields = objs.get(form["/Fields"]);
  const nextForm = withKey(form, "/Fields", Array.isArray(fields) ? [...fields, ref] : [ref]);
  if (isRef(form["/Fields"]))
    objs.set(form["/Fields"], Array.isArray(fields) ? [...fields, ref] : [ref]);
  else if (isRef(formRef)) objs.set(formRef, nextForm);
  else objs.set(objs.catalogRef, withKey(objs.catalog, "/AcroForm", nextForm));
}

// ---- Properties -----------------------------------------------------------------------

export type FieldFormat =
  | { kind: "none" }
  /** Acrobat AFNumber_Format: sep 0 "1,234.56", 1 "1234.56", 2 "1.234,56", 3 "1234,56";
   *  negative 0 "-1", 1 red, 2 "(1)", 3 red "(1)". */
  | {
      kind: "number";
      decimals: number;
      sep: 0 | 1 | 2 | 3;
      negative: 0 | 1 | 2 | 3;
      currency: string;
    }
  | { kind: "date"; pattern: string };

export interface FieldProps {
  /** Text fields: most characters allowed; null = no limit. */
  maxLen: number | null;
  /** What Reset form puts back; null = none. */
  defaultValue: string | null;
  format: FieldFormat;
  /** Radio and checkbox: each widget's export value, in /Kids order. */
  exportValues: string[];
}

const js = (code: string): JDict => ({ "/S": "/JavaScript", "/JS": `u:${code}` });

const jsText = (v: JVal | undefined, objs: PdfObjects): string => {
  const d = objs.dict(v);
  const code = d?.["/JS"];
  return typeof code === "string" ? code.replace(/^u:|^b:/, "") : "";
};

function setFormat(objs: PdfObjects, fieldRef: string, f: FieldFormat): void {
  const d = objs.dict(fieldRef);
  if (!d) return;
  const aa = { ...(objs.dict(d["/AA"]) ?? {}) };
  delete aa["/F"];
  delete aa["/K"];
  if (f.kind === "number") {
    const args = `${f.decimals}, ${f.sep}, ${f.negative}, 0, ${JSON.stringify(f.currency)}, true`;
    aa["/F"] = js(`AFNumber_Format(${args});`);
    aa["/K"] = js(`AFNumber_Keystroke(${args});`);
  } else if (f.kind === "date") {
    aa["/F"] = js(`AFDate_FormatEx(${JSON.stringify(f.pattern)});`);
    aa["/K"] = js(`AFDate_KeystrokeEx(${JSON.stringify(f.pattern)});`);
  }
  objs.set(fieldRef, withKey(d, "/AA", Object.keys(aa).length ? aa : undefined));
}

export function parseFormat(script: string): FieldFormat {
  const n = /AFNumber_Format\(\s*(\d+)\s*,\s*(\d)\s*,\s*(\d)\s*,\s*\d\s*,\s*"([^"]*)"/.exec(script);
  if (n)
    return {
      kind: "number",
      decimals: Number(n[1]),
      sep: Number(n[2]) as 0 | 1 | 2 | 3,
      negative: Number(n[3]) as 0 | 1 | 2 | 3,
      currency: n[4] ?? "",
    };
  const d = /AFDate_FormatEx\(\s*"([^"]*)"/.exec(script);
  if (d) return { kind: "date", pattern: d[1] ?? DEFAULT_DATE_PATTERN };
  return { kind: "none" };
}

export async function readFieldProps(
  ctx: PagesCtx,
  bytes: Uint8Array,
  name: string,
): Promise<FieldProps> {
  const objs = await PdfObjects.read(ctx.qpdf, bytes);
  const t = terminalFields(objs).get(name);
  const d = t && objs.dict(t.ref);
  if (!t || !d) throw new FormDesignError(`there is no field named "${name}"`);
  const maxLen = [d, ...t.widgets.map((w) => objs.dict(w) ?? {})]
    .map((x) => x["/MaxLen"])
    .find((v) => typeof v === "number");
  return {
    maxLen: typeof maxLen === "number" ? maxLen : null,
    defaultValue: t.dv,
    format: parseFormat(jsText(objs.dict(d["/AA"])?.["/F"], objs)),
    exportValues: t.widgets.map((w) => stateNames(objs, w)[0] ?? ""),
  };
}

/** Sets the given properties of one field; properties left out are not touched. */
export async function setFieldProps(
  ctx: PagesCtx,
  bytes: Uint8Array,
  name: string,
  props: Partial<FieldProps>,
): Promise<Uint8Array> {
  const objs = await PdfObjects.read(ctx.qpdf, bytes);
  const t = terminalFields(objs).get(name);
  if (!t || !objs.dict(t.ref)) throw new FormDesignError(`there is no field named "${name}"`);
  if (props.maxLen !== undefined) {
    // On the field, where Acrobat reads it, and mirrored on each widget kid, where
    // EmbedPDF reads it (an extra key there is ignored by other viewers).
    const v = props.maxLen && props.maxLen > 0 ? props.maxLen : undefined;
    for (const w of new Set([t.ref, ...t.widgets])) {
      const wd = objs.dict(w);
      if (wd) objs.set(w, withKey(wd, "/MaxLen", v));
    }
  }
  if (props.defaultValue !== undefined) {
    const fd = objs.dict(t.ref) ?? {};
    const isButton = fd["/FT"] === "/Btn" || objs.dict(fd["/Parent"])?.["/FT"] === "/Btn";
    const v =
      props.defaultValue === null || props.defaultValue === ""
        ? undefined
        : isButton
          ? `/${props.defaultValue}`
          : `u:${props.defaultValue}`;
    objs.set(t.ref, withKey(fd, "/DV", v));
  }
  if (props.format) setFormat(objs, t.ref, props.format);
  if (props.exportValues) {
    const values = props.exportValues.map((v) => v.trim());
    if (values.some((v) => !v)) throw new FormDesignError("an export value cannot be empty");
    t.widgets.forEach((w, i) => {
      const v = values[i];
      if (v) renameState(objs, w, v.replace(/[\s/()<>[\]{}%#]/g, "_"));
    });
    // The field's value follows its on button.
    const fd = objs.dict(t.ref) ?? {};
    const on = t.widgets.map((w) => objs.dict(w)?.["/AS"]).find((s) => s && s !== "/Off");
    objs.set(t.ref, withKey(fd, "/V", on ?? "/Off"));
  }
  return apply(ctx, bytes, objs);
}

/**
 * Removes fields whose widgets were deleted in the viewer: PDFium takes a deleted widget
 * off its page but leaves it in the field tree (docs/spike-report.md). Kids that are on
 * no page go, then fields left with no kids. `removed` counts the widgets that went.
 */
export async function removeOrphanFields(
  ctx: PagesCtx,
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; removed: number }> {
  const objs = await PdfObjects.read(ctx.qpdf, bytes);
  const onPages = new Set<string>();
  for (const p of objs.pages()) {
    const annots = objs.get(objs.dict(p)?.["/Annots"]);
    if (Array.isArray(annots)) for (const a of annots) if (isRef(a)) onPages.add(a);
  }
  let removed = 0;
  /** Drops the parts of `ref`'s subtree on no page; false when nothing of it is left. */
  const prune = (ref: JVal, depth: number): boolean => {
    if (!isRef(ref) || depth > 64) return true;
    const d = objs.dict(ref);
    if (!d) return false;
    const kids = objs.get(d["/Kids"]);
    if (!Array.isArray(kids) || !kids.length) {
      const keep = d["/Subtype"] !== "/Widget" || onPages.has(ref);
      if (!keep) removed++;
      return keep;
    }
    const keepKids = kids.filter((k) => prune(k, depth + 1));
    if (keepKids.length !== kids.length) {
      const at = d["/Kids"];
      if (isRef(at)) objs.set(at, keepKids);
      else objs.set(ref, withKey(d, "/Kids", keepKids.length ? keepKids : undefined));
    }
    return keepKids.length > 0;
  };
  const formRef = objs.catalog["/AcroForm"];
  const form = objs.dict(formRef);
  const fields = objs.get(form?.["/Fields"]);
  if (!form || !Array.isArray(fields)) return { bytes, removed: 0 };
  const keep = fields.filter((f) => prune(f, 0));
  if (keep.length !== fields.length) {
    const at = form["/Fields"];
    if (isRef(at)) objs.set(at, keep);
    else if (isRef(formRef)) objs.set(formRef, withKey(form, "/Fields", keep));
    else
      objs.set(objs.catalogRef, withKey(objs.catalog, "/AcroForm", withKey(form, "/Fields", keep)));
  }
  return { bytes: await apply(ctx, bytes, objs), removed };
}

/** Adds every field in `specs`, in order (Detect fields). One step for the app. */
export async function addFields(
  ctx: PagesCtx,
  bytes: Uint8Array,
  specs: NewField[],
): Promise<{ bytes: Uint8Array; names: string[] }> {
  let out = bytes;
  const names: string[] = [];
  for (const spec of specs) {
    const r = await addField(ctx, out, spec);
    out = r.bytes;
    names.push(r.name);
  }
  return { bytes: out, names };
}
