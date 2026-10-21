// Phase 0 spike operations on EmbedPDF's PdfiumNative. Throwaway: the real engine API
// is designed in a later phase. Runs in Node (tests) and in the WebView (/spike).
//
// Coordinates: EmbedPDF uses page-space points with a TOP-LEFT origin
// (y grows downward), unlike raw PDF (bottom-left origin).

import {
  MatchFlag,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfDocumentObject,
  type PdfFreeTextAnnoObject,
  type PdfRedactAnnoObject,
  type PdfStampAnnoObject,
  type Rect,
} from "@embedpdf/models";
import type { Engine } from "./pdfium";

export interface TextHit {
  pageIndex: number;
  rects: Rect[];
}

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function page(doc: PdfDocumentObject, pageIndex: number) {
  const p = doc.pages[pageIndex];
  if (!p) throw new RangeError(`page ${pageIndex} out of range`);
  return p;
}

export function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.origin.x));
  const y0 = Math.min(...rects.map((r) => r.origin.y));
  const x1 = Math.max(...rects.map((r) => r.origin.x + r.size.width));
  const y1 = Math.max(...rects.map((r) => r.origin.y + r.size.height));
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/** Grow a rect on all sides (redaction boxes should fully cover glyph ascenders/descenders). */
export function pad(r: Rect, by: number): Rect {
  return {
    origin: { x: r.origin.x - by, y: r.origin.y - by },
    size: { width: r.size.width + 2 * by, height: r.size.height + 2 * by },
  };
}

/** Convert a raw-PDF rect (bottom-left origin) to EmbedPDF page space (top-left origin). */
export function fromPdfRect(
  doc: PdfDocumentObject,
  pageIndex: number,
  r: { x: number; y: number; width: number; height: number },
): Rect {
  const h = page(doc, pageIndex).size.height;
  return { origin: { x: r.x, y: h - r.y - r.height }, size: { width: r.width, height: r.height } };
}

export async function addImageStamp(
  engine: Engine,
  doc: PdfDocumentObject,
  pageIndex: number,
  rect: Rect,
  png: ArrayBuffer,
): Promise<string> {
  const anno: PdfStampAnnoObject = {
    type: PdfAnnotationSubtype.STAMP,
    id: newId("stamp"),
    pageIndex,
    rect,
    flags: ["print"],
    author: "PDF Workbench spike",
    created: new Date(),
  };
  return engine
    .createPageAnnotation(doc, page(doc, pageIndex), anno, { data: png, mimeType: "image/png" })
    .toPromise();
}

export async function addFreeText(
  engine: Engine,
  doc: PdfDocumentObject,
  pageIndex: number,
  rect: Rect,
  text: string,
): Promise<string> {
  const anno: PdfFreeTextAnnoObject = {
    type: PdfAnnotationSubtype.FREETEXT,
    id: newId("freetext"),
    pageIndex,
    rect,
    contents: text,
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: 12,
    fontColor: "#C00000",
    textAlign: PdfTextAlignment.Left,
    verticalAlign: PdfVerticalAlignment.Top,
    opacity: 1,
    flags: ["print"],
    author: "PDF Workbench spike",
    created: new Date(),
  };
  return engine.createPageAnnotation(doc, page(doc, pageIndex), anno).toPromise();
}

/** Find every occurrence of `needle` on every page. */
export async function findText(
  engine: Engine,
  doc: PdfDocumentObject,
  needle: string,
): Promise<TextHit[]> {
  const hits: TextHit[] = [];
  for (const p of doc.pages) {
    const results = await engine.searchInPage(doc, p, needle, MatchFlag.None).toPromise();
    for (const r of results) hits.push({ pageIndex: p.index, rects: r.rects });
  }
  return hits;
}

/** Mark (not yet apply) a redaction: a standard /Redact annotation, visible in Acrobat. */
export async function markRedaction(
  engine: Engine,
  doc: PdfDocumentObject,
  pageIndex: number,
  rects: Rect[],
): Promise<string> {
  const anno: PdfRedactAnnoObject = {
    type: PdfAnnotationSubtype.REDACT,
    id: newId("redact"),
    pageIndex,
    rect: union(rects),
    segmentRects: rects,
    // EmbedPDF 2.15.1 burns the box in using `color`; `overlayColor` is ignored on apply.
    color: "#000000",
    overlayColor: "#000000",
    created: new Date(),
  };
  return engine.createPageAnnotation(doc, page(doc, pageIndex), anno).toPromise();
}

/** Apply every pending /Redact annotation on every page. Returns pages changed. */
export async function applyAllRedactions(
  engine: Engine,
  doc: PdfDocumentObject,
): Promise<number[]> {
  const changed: number[] = [];
  for (const p of doc.pages) {
    if (await engine.applyAllRedactions(doc, p).toPromise()) changed.push(p.index);
  }
  return changed;
}

export async function save(engine: Engine, doc: PdfDocumentObject): Promise<ArrayBuffer> {
  return engine.saveAsCopy(doc).toPromise();
}

export interface RedactionPlan {
  /** Text to find and redact on every page. */
  needle?: string;
  /** Extra area redactions (EmbedPDF page space). */
  areas?: { pageIndex: number; rect: Rect }[];
  /** Points to grow each text hit by (covers ascenders/descenders). Default 1. */
  padding?: number;
}

/** Mark redactions for every hit + extra areas, then apply them all. */
export async function redact(
  engine: Engine,
  doc: PdfDocumentObject,
  plan: RedactionPlan,
): Promise<{ marked: number; pagesChanged: number[] }> {
  let marked = 0;
  if (plan.needle) {
    for (const hit of await findText(engine, doc, plan.needle)) {
      const rects = hit.rects.map((r) => pad(r, plan.padding ?? 1));
      await markRedaction(engine, doc, hit.pageIndex, rects);
      marked++;
    }
  }
  for (const a of plan.areas ?? []) {
    await markRedaction(engine, doc, a.pageIndex, [a.rect]);
    marked++;
  }
  return { marked, pagesChanged: await applyAllRedactions(engine, doc) };
}
