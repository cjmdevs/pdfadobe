// Object-level edits for redaction and Sanitize (Phase 5), through qpdf's JSON v2:
// read every object, change the few that matter, write them back with
// --update-from-json. PDFium cannot edit the AcroForm field tree, XMP or the catalog.
//
// The JSON holds document text (strings, field values): it is never logged.

import { runToFile, type Qpdf } from "../pages/qpdf";
import type { Rect } from "../edit/chars";
import { rectsOverlap } from "./clip";
import type { PageRedaction } from "./apply";

/** A qpdf JSON v2 value: numbers, booleans, null, "/Name", "u:text", "b:hex", "5 0 R", arrays, dicts. */
export type JVal = number | boolean | null | string | JVal[] | { [key: string]: JVal };
export type JDict = { [key: string]: JVal };

interface JObject {
  value?: JVal;
  /** `data`: base64 stream content, only on streams this edit creates or replaces. */
  stream?: { dict: JDict; data?: string };
}

const REF = /^\d+ \d+ R$/;

export function isRef(v: JVal | undefined): v is string {
  return typeof v === "string" && REF.test(v);
}

export function isDict(v: JVal | undefined): v is JDict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The objects of one PDF as qpdf sees them, with pending changes. */
export class PdfObjects {
  private readonly changed = new Map<string, JObject | null>();

  private constructor(
    private readonly header: JVal,
    private readonly objects: Record<string, JObject>,
  ) {}

  static async read(qpdf: Qpdf, bytes: Uint8Array): Promise<PdfObjects> {
    const r = await qpdf.run({
      inputs: { "in0.pdf": bytes },
      args: ["--json=2", "--json-key=qpdf", "--json-stream-data=none", "in0.pdf"],
      outputs: [],
    });
    const parsed = JSON.parse(r.stdout) as { qpdf: [JVal, Record<string, JObject>] };
    return new PdfObjects(parsed.qpdf[0], parsed.qpdf[1]);
  }

  private entry(ref: string): JObject | undefined {
    const key = ref === "trailer" ? "trailer" : `obj:${ref}`;
    if (this.changed.has(key)) return this.changed.get(key) ?? undefined;
    return this.objects[key];
  }

  /** The value an indirect reference points at (a stream's dictionary for streams). */
  get(v: JVal | undefined): JVal | undefined {
    if (!isRef(v)) return v;
    const o = this.entry(v);
    return o?.value ?? o?.stream?.dict;
  }

  dict(v: JVal | undefined): JDict | undefined {
    const d = this.get(v);
    return isDict(d) ? d : undefined;
  }

  get trailer(): JDict {
    return this.dict(this.entry("trailer")?.value) ?? {};
  }

  get catalog(): JDict {
    return this.dict(this.trailer["/Root"]) ?? {};
  }

  get catalogRef(): string {
    const r = this.trailer["/Root"];
    if (!isRef(r)) throw new Error("the document has no catalog");
    return r;
  }

  /** Replaces a non-stream object (or the trailer) with `value`. */
  set(ref: string, value: JVal): void {
    const key = ref === "trailer" ? "trailer" : `obj:${ref}`;
    const cur = this.entry(ref);
    if (cur?.stream) {
      if (!isDict(value)) throw new Error("a stream's dictionary must stay a dictionary");
      this.changed.set(key, { stream: { dict: value } });
    } else this.changed.set(key, { value });
  }

  private nextId = 0;

  /** A fresh object reference for an object this edit adds. */
  newRef(): string {
    if (!this.nextId) {
      const h = isDict(this.header) ? this.header : {};
      const max = typeof h["maxobjectid"] === "number" ? h["maxobjectid"] : 0;
      const used = this.refs().map((r) => Number(r.split(" ")[0]));
      this.nextId = Math.max(max, ...used) + 1;
    }
    return `${this.nextId++} 0 R`;
  }

  /** Writes a stream object (new or replaced) with `data` as its content. */
  setStream(ref: string, dict: JDict, data: Uint8Array): void {
    let bin = "";
    for (const b of data) bin += String.fromCharCode(b);
    this.changed.set(`obj:${ref}`, { stream: { dict, data: btoa(bin) } });
  }

  /** Every object reference. */
  refs(): string[] {
    return Object.keys(this.objects)
      .filter((k) => k.startsWith("obj:"))
      .map((k) => k.slice(4));
  }

  /** Page dictionary references in page order. */
  pages(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (ref: JVal | undefined) => {
      if (!isRef(ref) || seen.has(ref)) return;
      seen.add(ref);
      const d = this.dict(ref);
      if (!d) return;
      if (d["/Type"] === "/Pages" || Array.isArray(this.get(d["/Kids"]))) {
        const kids = this.get(d["/Kids"]);
        if (Array.isArray(kids)) kids.forEach(walk);
      } else out.push(ref);
    };
    walk(this.catalog["/Pages"]);
    return out;
  }

  get hasChanges(): boolean {
    return this.changed.size > 0;
  }

  /** The pending changes, for writers other than qpdf (signing appends them itself). */
  changes(): { ref: string; value?: JVal; stream?: { dict: JDict; data: Uint8Array } }[] {
    return [...this.changed].map(([key, o]) => {
      const ref = key === "trailer" ? key : key.slice(4);
      if (!o) return { ref, value: null };
      if (!o.stream) return { ref, value: o.value ?? null };
      const bin = atob(o.stream.data ?? "");
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      return { ref, stream: { dict: o.stream.dict, data } };
    });
  }

  /** The highest object number in use. */
  get maxObjectId(): number {
    const h = isDict(this.header) ? this.header : {};
    const max = typeof h["maxobjectid"] === "number" ? h["maxobjectid"] : 0;
    return Math.max(max, ...this.refs().map((r) => Number(r.split(" ")[0])));
  }

  /** The --update-from-json document for the pending changes. */
  updateJson(): string {
    const body: Record<string, JObject | { value: null }> = {};
    for (const [k, v] of this.changed) body[k] = v ?? { value: null };
    return JSON.stringify({ qpdf: [this.header, body] });
  }
}

export function numbers(v: JVal | undefined): number[] | null {
  return Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : null;
}

function rectOf(objs: PdfObjects, annot: JDict): Rect | null {
  const r = numbers(objs.get(annot["/Rect"]));
  if (!r || r.length !== 4) return null;
  const [x1, y1, x2, y2] = r as [number, number, number, number];
  return { l: Math.min(x1, x2), b: Math.min(y1, y2), r: Math.max(x1, x2), t: Math.max(y1, y2) };
}

/** Writes a new array where `holder[key]` lives: in place, or in the array object it refers to. */
function setArray(
  objs: PdfObjects,
  holderRef: string,
  holder: JDict,
  key: string,
  items: JVal[],
): void {
  const at = holder[key];
  if (isRef(at) && Array.isArray(objs.get(at))) objs.set(at, items);
  else objs.set(holderRef, withKey(holder, key, items.length ? items : undefined));
}

/** A copy of `d` with `key` set, or dropped when `value` is undefined. */
export function withKey(d: JDict, key: string, value: JVal | undefined): JDict {
  const next = Object.fromEntries(Object.entries(d).filter(([k]) => k !== key));
  if (value !== undefined) next[key] = value;
  return next;
}

export interface ObjectsReport {
  annotationsRemoved: number;
  /** Fully qualified names of the form fields removed. Never logged. */
  fieldsRemoved: string[];
}

function fieldName(objs: PdfObjects, ref: string): string {
  const parts: string[] = [];
  let cur: JVal | undefined = ref;
  const seen = new Set<string>();
  while (isRef(cur) && !seen.has(cur)) {
    seen.add(cur);
    const d = objs.dict(cur);
    const t = d?.["/T"];
    if (typeof t === "string") parts.unshift(t.replace(/^[ub]:/, ""));
    cur = d?.["/Parent"];
  }
  return parts.join(".");
}

/**
 * Removes every annotation that touches a redaction box (and every /Redact mark), the
 * popups of removed annotations, and whole form fields with any widget under a box: from
 * every page, from their parent's /Kids or AcroForm /Fields, and from /CO. Removed
 * objects become unreferenced and the final rewrite drops them.
 */
export function removeUnderMarks(objs: PdfObjects, marks: PageRedaction[]): ObjectsReport {
  const pages = objs.pages();
  const removed = new Set<string>();
  // Annotations written inline in /Annots (PDFium does this) have no reference.
  const removedInline = new Set<JDict>();
  const fields = new Set<string>();

  // 1. What goes: annotations under a box, and /Redact marks anywhere.
  pages.forEach((pageRef, index) => {
    const page = objs.dict(pageRef);
    const annots = objs.get(page?.["/Annots"]);
    if (!Array.isArray(annots)) return;
    const rects = marks.filter((mk) => mk.pageIndex === index).flatMap((mk) => mk.rects);
    for (const a of annots) {
      const d = objs.dict(a);
      if (!d) continue;
      const rect = rectOf(objs, d);
      const under = rect !== null && rects.some((r) => rectsOverlap(rect, r));
      if (d["/Subtype"] !== "/Redact" && !under) continue;
      if (!isRef(a)) {
        // An inline widget would be its own field with no way to reach it: the
        // annotation going takes its value with it.
        removedInline.add(d);
        continue;
      }
      removed.add(a);
      if (d["/Subtype"] === "/Widget") {
        // The terminal field holds the value: the widget itself when it has a name.
        const field = typeof d["/T"] === "string" || !isRef(d["/Parent"]) ? a : d["/Parent"];
        fields.add(field);
      }
    }
  });

  // 2. Whole fields: every widget of a removed field goes, wherever it is.
  const widgetsOf = (field: string): string[] => {
    const d = objs.dict(field);
    const kids = objs.get(d?.["/Kids"]);
    if (!Array.isArray(kids)) return [field];
    return kids.filter(isRef).flatMap((k) => widgetsOf(k));
  };
  for (const f of fields) for (const w of widgetsOf(f)) removed.add(w);

  // 3. Popups of removed annotations (and annotations whose parent went).
  for (const pageRef of pages) {
    const annots = objs.get(objs.dict(pageRef)?.["/Annots"]);
    if (!Array.isArray(annots)) continue;
    for (const a of annots) {
      const d = objs.dict(a);
      if (!isRef(a) || !d) continue;
      const parent = d["/Parent"];
      if (d["/Subtype"] === "/Popup" && isRef(parent) && removed.has(parent)) removed.add(a);
    }
  }
  for (const a of [...removed]) {
    const popup = objs.dict(a)?.["/Popup"];
    if (isRef(popup)) removed.add(popup);
  }

  // 4. Write the page /Annots arrays.
  let annotationsRemoved = 0;
  for (const pageRef of pages) {
    const page = objs.dict(pageRef);
    if (!page) continue;
    const annots = objs.get(page["/Annots"]);
    if (!Array.isArray(annots)) continue;
    const keep = annots.filter((a) =>
      isRef(a) ? !removed.has(a) : !(isDict(a) && removedInline.has(a)),
    );
    if (keep.length === annots.length) continue;
    annotationsRemoved += annots.length - keep.length;
    setArray(objs, pageRef, page, "/Annots", keep);
  }

  // 5. Detach removed fields from the field tree; a parent left with no kids goes too.
  const acroRef = objs.catalog["/AcroForm"];
  const acro = objs.dict(acroRef);
  const names = [...fields].map((f) => fieldName(objs, f));
  const gone = new Set(fields);
  const detach = (field: string) => {
    const parent = objs.dict(field)?.["/Parent"];
    if (isRef(parent)) {
      const pd = objs.dict(parent);
      const kids = objs.get(pd?.["/Kids"]);
      if (!pd || !Array.isArray(kids)) return;
      const keep = kids.filter((k) => !(isRef(k) && gone.has(k)));
      if (keep.length === kids.length) return;
      setArray(objs, parent, pd, "/Kids", keep);
      if (!keep.length) {
        gone.add(parent);
        detach(parent);
      }
    }
  };
  for (const f of fields) detach(f);
  if (acro) {
    let form: JDict = acro;
    for (const key of ["/Fields", "/CO"]) {
      const list = objs.get(form[key]);
      if (!Array.isArray(list)) continue;
      const keep = list.filter((k) => !(isRef(k) && gone.has(k)));
      if (keep.length === list.length) continue;
      if (isRef(acroRef)) {
        setArray(objs, acroRef, form, key, keep);
        form = objs.dict(acroRef) ?? form;
      } else {
        // The AcroForm dictionary sits directly in the catalog.
        form = isRef(form[key]) ? form : withKey(form, key, keep);
        if (isRef(form[key])) objs.set(form[key], keep);
        objs.set(objs.catalogRef, withKey(objs.catalog, "/AcroForm", form));
      }
    }
  }
  return { annotationsRemoved, fieldsRemoved: names };
}

/**
 * Writes the pending changes and rewrites the whole file: unreferenced objects and
 * earlier revisions are not copied (qpdf writes only what the trailer reaches), unused
 * resources are pruned, streams are compressed. Never an incremental save.
 */
export async function rewrite(
  qpdf: Qpdf,
  bytes: Uint8Array,
  objs?: PdfObjects,
): Promise<Uint8Array> {
  const inputs: Record<string, Uint8Array> = { "in0.pdf": bytes };
  const args = ["in0.pdf"];
  if (objs?.hasChanges) {
    inputs["edit.json"] = new TextEncoder().encode(objs.updateJson());
    args.push("--update-from-json=edit.json");
  }
  args.push(
    "--object-streams=generate",
    "--remove-unreferenced-resources=yes",
    "--compress-streams=y",
    "--recompress-flate",
    "out.pdf",
  );
  return runToFile(qpdf, { inputs, args, outputs: ["out.pdf"] });
}
