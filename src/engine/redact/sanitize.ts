// Sanitize Document (Phase 5) and the document-level scrub every Apply does.
//
// Object-level parts work on qpdf JSON (`PdfObjects`); hidden text needs PDFium. The
// final qpdf rewrite (`rewrite` in objects.ts) then drops whatever became unreferenced
// and every earlier revision.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { pageBoxes } from "../pages/geometry";
import { objBounds } from "../edit/chars";
import { rectsOverlap } from "./clip";
import { isDict, isRef, withKey, type JDict, type JVal, type PdfObjects } from "./objects";

export interface SanitizeOptions {
  /** Document properties (/Info) and XMP metadata, everywhere it is attached. */
  metadata: boolean;
  /** Embedded files, file-attachment comments, associated files, portfolios. */
  attachments: boolean;
  /** JavaScript and other actions that run by themselves (open, page, field events). */
  javascript: boolean;
  /** Private application data (/PieceInfo), which holds Acrobat's embedded search index. */
  privateData: boolean;
  /** Invisible text (render mode 3, e.g. an OCR layer) and text outside the page. */
  hiddenText: boolean;
}

export const ALL_SANITIZE: SanitizeOptions = {
  metadata: true,
  attachments: true,
  javascript: true,
  privateData: true,
  hiddenText: true,
};

export interface SanitizeReport {
  metadataRemoved: number;
  attachmentsRemoved: number;
  actionsRemoved: number;
  privateDataRemoved: number;
  hiddenTextRemoved: number;
}

export const EMPTY_SANITIZE_REPORT: SanitizeReport = {
  metadataRemoved: 0,
  attachmentsRemoved: 0,
  actionsRemoved: 0,
  privateDataRemoved: 0,
  hiddenTextRemoved: 0,
};

/** Actions that run without the reader asking, or reach outside the file. */
const RISKY_ACTIONS = new Set([
  "/JavaScript",
  "/Launch",
  "/ImportData",
  "/SubmitForm",
  "/ResetForm",
  "/Rendition",
  "/RichMediaExecute",
  "/Sound",
  "/Movie",
  "/Hide",
]);

function isRiskyAction(objs: PdfObjects, v: JVal | undefined): boolean {
  const seen = new Set<JDict>();
  let a = objs.dict(v);
  // An action chain: any risky step taints the whole chain.
  while (a && !seen.has(a)) {
    seen.add(a);
    if (typeof a["/S"] === "string" && RISKY_ACTIONS.has(a["/S"])) return true;
    const next = objs.get(a["/Next"]);
    if (Array.isArray(next)) return next.some((n) => isRiskyAction(objs, n));
    a = objs.dict(next);
  }
  return false;
}

/** Rewrites every dictionary in the file (objects, stream dictionaries, the trailer). */
function eachDict(objs: PdfObjects, fn: (d: JDict, ref: string) => JDict | null): void {
  for (const ref of [...objs.refs(), "trailer"]) {
    const top = ref === "trailer" ? objs.trailer : objs.get(ref);
    if (top === undefined) continue;
    let changed = false;
    const visit = (v: JVal): JVal => {
      if (Array.isArray(v)) return v.map(visit);
      if (!isDict(v)) return v;
      const inner: JDict = {};
      for (const [k, x] of Object.entries(v)) inner[k] = visit(x);
      const out = fn(inner, ref);
      if (out === null) return inner;
      changed = true;
      return out;
    };
    const next = visit(top);
    if (changed) objs.set(ref, next);
  }
}

function strip(d: JDict, keys: string[]): JDict | null {
  const hit = keys.filter((k) => k in d);
  if (!hit.length) return null;
  return Object.fromEntries(Object.entries(d).filter(([k]) => !hit.includes(k)));
}

/** Object-level Sanitize. Hidden text is separate (`removeHiddenText`, PDFium). */
export function sanitizeObjects(objs: PdfObjects, opt: SanitizeOptions): SanitizeReport {
  const report = { ...EMPTY_SANITIZE_REPORT };
  const catalogRef = objs.catalogRef;

  if (opt.metadata) {
    if ("/Info" in objs.trailer) {
      objs.set("trailer", withKey(objs.trailer, "/Info", undefined));
      report.metadataRemoved++;
    }
  }

  eachDict(objs, (d) => {
    const keys: string[] = [];
    // XMP can sit on the catalog, pages, images, fonts and form XObjects.
    if (opt.metadata && isRef(d["/Metadata"])) keys.push("/Metadata");
    if (opt.privateData && "/PieceInfo" in d) keys.push("/PieceInfo");
    if (opt.attachments) {
      if ("/AF" in d) keys.push("/AF");
      if ("/Collection" in d) keys.push("/Collection");
    }
    if (opt.javascript) {
      // Event actions (open, close, keystroke, page open...) all live in /AA.
      if ("/AA" in d) keys.push("/AA");
      if ("/OpenAction" in d && isRiskyAction(objs, d["/OpenAction"])) keys.push("/OpenAction");
      if ("/A" in d && isRiskyAction(objs, d["/A"])) keys.push("/A");
    }
    const out = strip(d, keys);
    if (out) {
      for (const k of keys) {
        if (k === "/Metadata") report.metadataRemoved++;
        else if (k === "/PieceInfo") report.privateDataRemoved++;
        else if (k === "/AF" || k === "/Collection") report.attachmentsRemoved++;
        else report.actionsRemoved++;
      }
    }
    return out;
  });

  // Name trees: embedded files and document JavaScript.
  const catalog = objs.dict(catalogRef) ?? {};
  const namesRef = catalog["/Names"];
  const names = objs.dict(namesRef);
  if (names) {
    const drop = [
      ...(opt.attachments && "/EmbeddedFiles" in names ? ["/EmbeddedFiles"] : []),
      ...(opt.javascript && "/JavaScript" in names ? ["/JavaScript"] : []),
    ];
    if (drop.length) {
      const next = strip(names, drop) ?? names;
      if (isRef(namesRef)) objs.set(namesRef, next);
      else objs.set(catalogRef, withKey(objs.dict(catalogRef) ?? {}, "/Names", next));
      if (drop.includes("/EmbeddedFiles")) report.attachmentsRemoved++;
      if (drop.includes("/JavaScript")) report.actionsRemoved++;
    }
  }

  // File-attachment comments carry their file; links and widgets may carry scripts.
  if (opt.attachments) {
    for (const pageRef of objs.pages()) {
      const page = objs.dict(pageRef);
      const annots = objs.get(page?.["/Annots"]);
      if (!page || !Array.isArray(annots)) continue;
      const keep = annots.filter((a) => objs.dict(a)?.["/Subtype"] !== "/FileAttachment");
      if (keep.length === annots.length) continue;
      report.attachmentsRemoved += annots.length - keep.length;
      const at = page["/Annots"];
      if (isRef(at)) objs.set(at, keep);
      else objs.set(pageRef, withKey(page, "/Annots", keep.length ? keep : undefined));
    }
  }

  // XFA forms carry scripts and their own copy of every field value.
  if (opt.javascript) dropXfa(objs);
  return report;
}

/** Removes the XFA form (the AcroForm fields stay). Returns true when there was one. */
export function dropXfa(objs: PdfObjects): boolean {
  const catalogRef = objs.catalogRef;
  const acroRef = objs.dict(catalogRef)?.["/AcroForm"];
  const acro = objs.dict(acroRef);
  if (!acro || !("/XFA" in acro)) return false;
  const next = withKey(acro, "/XFA", undefined);
  if (isRef(acroRef)) objs.set(acroRef, next);
  else objs.set(catalogRef, withKey(objs.dict(catalogRef) ?? {}, "/AcroForm", next));
  return true;
}

/** A qpdf JSON string's text: "u:" is Unicode, "b:" is hex bytes. */
export function jsonText(v: JVal | undefined): string | null {
  if (typeof v !== "string") return null;
  if (v.startsWith("u:")) return v.slice(2);
  if (v.startsWith("b:")) {
    const hex = v.slice(2);
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
    // UTF-16BE with BOM, else PDFDocEncoding (close enough to Latin-1 for matching).
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
      return new TextDecoder("utf-16be").decode(bytes.slice(2));
    return String.fromCharCode(...bytes);
  }
  return null;
}

/** Comparison form: case and whitespace do not count. */
export function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * What every Apply does beyond the boxes: XMP goes (it repeats document properties
 * and cannot be checked entry by entry), /Info entries holding a redacted string go,
 * page thumbnails go (they show the page before redaction), the XFA form goes (its own
 * copy of field values), and tagged-PDF text (/ActualText, /Alt, /E) holding a redacted
 * string goes.
 */
export function scrubAfterRedaction(objs: PdfObjects, secrets: string[]): number {
  const keys = secrets.map(norm).filter((s) => s.length >= 4);
  const holds = (v: JVal | undefined) => {
    const t = jsonText(v);
    return t !== null && keys.some((k) => norm(t).includes(k));
  };
  let n = 0;
  const infoRef = objs.trailer["/Info"];
  const info = objs.dict(infoRef);
  if (info && isRef(infoRef)) {
    const keep = Object.fromEntries(Object.entries(info).filter(([, v]) => !holds(v)));
    if (Object.keys(keep).length !== Object.keys(info).length) {
      n += Object.keys(info).length - Object.keys(keep).length;
      objs.set(infoRef, keep);
    }
  }
  eachDict(objs, (d) => {
    const drop: string[] = [];
    if (isRef(d["/Metadata"])) drop.push("/Metadata");
    if (d["/Type"] === "/Page" && "/Thumb" in d) drop.push("/Thumb");
    // /T is a structure element's title or a comment's author; a form field's /T is
    // its name, which the form needs (fields under a box are removed whole anyway).
    const isField = "/FT" in d || d["/Subtype"] === "/Widget";
    for (const k of ["/ActualText", "/Alt", "/E", ...(isField ? [] : ["/T"])]) {
      if (holds(d[k])) drop.push(k);
    }
    n += drop.length;
    return strip(d, drop);
  });
  if (dropXfa(objs)) n++;
  return n;
}

const OBJ_TEXT = 1;
const OBJ_FORM = 5;
const RENDER_INVISIBLE = 3;

/** Removes invisible text and text entirely outside the page's visible area. */
export function removeHiddenText(
  m: PdfiumModule,
  bytes: Uint8Array,
): { bytes: Uint8Array; removed: number } {
  const doc = RawDoc.open(m, bytes);
  let removed = 0;
  try {
    for (let i = 0; i < doc.pageCount; i++) {
      doc.withPage(
        i,
        (page) => {
          const { media, crop } = pageBoxes(m, page);
          const visible = {
            l: Math.max(media.left, crop.left),
            b: Math.max(media.bottom, crop.bottom),
            r: Math.min(media.right, crop.right),
            t: Math.min(media.top, crop.top),
          };
          const visit = (form: number, depth: number) => {
            const n = form ? m.FPDFFormObj_CountObjects(form) : m.FPDFPage_CountObjects(page);
            for (let k = n - 1; k >= 0; k--) {
              const obj = form ? m.FPDFFormObj_GetObject(form, k) : m.FPDFPage_GetObject(page, k);
              const type = m.FPDFPageObj_GetType(obj);
              if (type === OBJ_FORM && depth < 32) visit(obj, depth + 1);
              if (type !== OBJ_TEXT) continue;
              const invisible = m.FPDFTextObj_GetTextRenderMode(obj) === RENDER_INVISIBLE;
              // Bounds inside forms are in the form's space; only page-level text is
              // checked against the page box.
              const b = form ? null : objBounds(m, obj);
              const offPage = b !== null && !rectsOverlap(b, visible);
              if (!invisible && !offPage) continue;
              const ok = form
                ? m.FPDFFormObj_RemoveObject(form, obj)
                : m.FPDFPage_RemoveObject(page, obj);
              if (!ok) throw new Error("PDFium could not remove hidden text");
              m.FPDFPageObj_Destroy(obj);
              removed++;
            }
          };
          visit(0, 0);
        },
        true,
      );
    }
    return { bytes: removed ? doc.save() : bytes, removed };
  } finally {
    doc.close();
  }
}
