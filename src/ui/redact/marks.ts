// Redaction marks as /Redact annotations (Phase 5): made from search hits, a drawn box,
// selected text or whole pages; read back for the review panel and for Apply.
//
// EmbedPDF page space has its origin top-left; the engine works in PDF points with the
// origin bottom-left. Like the rest of the app, this assumes the crop box starts at 0,0.
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfRedactAnnoObject,
  type Rect as EpRect,
} from "@embedpdf/models";
import type { Rect as PdfRect } from "../../engine/edit/chars";
import type { MarkCandidate, PageRedaction } from "../../engine/redact";
import { redactMarks, type MarkInfo } from "./redactStore";

type Scope = {
  createAnnotation(pageIndex: number, a: PdfAnnotationObject): unknown;
};

/** Marks are drawn red until applied (the overlay colour is chosen at Apply). */
export const MARK_COLOR = "#d0336c";

export function toEp(r: PdfRect, pageHeight: number): EpRect {
  return { origin: { x: r.l, y: pageHeight - r.t }, size: { width: r.r - r.l, height: r.t - r.b } };
}

export function toPdf(r: EpRect, pageHeight: number): PdfRect {
  return {
    l: r.origin.x,
    r: r.origin.x + r.size.width,
    t: pageHeight - r.origin.y,
    b: pageHeight - r.origin.y - r.size.height,
  };
}

function union(rects: EpRect[]): EpRect {
  const x0 = Math.min(...rects.map((r) => r.origin.x));
  const y0 = Math.min(...rects.map((r) => r.origin.y));
  const x1 = Math.max(...rects.map((r) => r.origin.x + r.size.width));
  const y1 = Math.max(...rects.map((r) => r.origin.y + r.size.height));
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/** Grows a text box 1 pt each way, so ascenders and descenders are inside it. */
export function pad(r: EpRect, by = 1): EpRect {
  return {
    origin: { x: r.origin.x - by, y: r.origin.y - by },
    size: { width: r.size.width + 2 * by, height: r.size.height + 2 * by },
  };
}

/** Creates one /Redact mark; returns its id. */
export function addMark(
  scope: Scope,
  documentId: string,
  pageIndex: number,
  rects: EpRect[],
  info: MarkInfo,
  author: string,
): string {
  const id = crypto.randomUUID();
  const anno: PdfRedactAnnoObject = {
    type: PdfAnnotationSubtype.REDACT,
    id,
    pageIndex,
    rect: union(rects),
    segmentRects: rects,
    color: MARK_COLOR,
    author,
    created: new Date(),
    flags: ["print"],
  };
  scope.createAnnotation(pageIndex, anno);
  redactMarks.setInfo(documentId, id, info);
  return id;
}

/** Search hits and whole-page marks (PDF rects) as /Redact marks. */
export function addCandidates(
  scope: Scope,
  documentId: string,
  pageHeights: number[],
  list: MarkCandidate[],
  author: string,
): string[] {
  return list.map((c) => {
    const h = pageHeights[c.pageIndex] ?? 0;
    const rects = c.rects.map((r) => toEp(r, h)).map((r) => (c.kind === "text" ? pad(r) : r));
    const source = c.kind === "page" ? "page" : c.source;
    return addMark(
      scope,
      documentId,
      c.pageIndex,
      rects,
      c.text ? { source, text: c.text } : { source },
      author,
    );
  });
}

export interface Mark {
  id: string;
  pageIndex: number;
  rects: EpRect[];
}

export function marksOf(objects: PdfAnnotationObject[]): Mark[] {
  return objects
    .filter((a): a is PdfRedactAnnoObject => a.type === PdfAnnotationSubtype.REDACT)
    .map((a) => ({
      id: a.id,
      pageIndex: a.pageIndex,
      rects: a.segmentRects?.length ? a.segmentRects : [a.rect],
    }))
    .sort(
      (a, b) =>
        a.pageIndex - b.pageIndex || (a.rects[0]?.origin.y ?? 0) - (b.rects[0]?.origin.y ?? 0),
    );
}

/** The engine's view of a set of marks. */
export function toRequestMarks(marks: Mark[], pageHeights: number[]): PageRedaction[] {
  return marks.map((m) => ({
    pageIndex: m.pageIndex,
    rects: m.rects.map((r) => toPdf(r, pageHeights[m.pageIndex] ?? 0)),
  }));
}

export const SOURCE_LABELS: Record<MarkInfo["source"], string> = {
  manual: "Drawn box",
  selection: "Selected text",
  page: "Whole page",
  literal: "Search",
  regex: "Your pattern",
  ssn: "SSN",
  itin: "ITIN",
  ein: "EIN",
  routing: "Routing number",
  account: "Account number",
  phone: "Phone",
  email: "Email",
  dob: "Date of birth",
  date: "Date",
};
