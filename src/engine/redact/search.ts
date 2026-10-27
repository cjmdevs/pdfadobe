// Search & Redact over a document (Phase 5): page text from PDFium, matched by
// `patterns.ts`, turned into one box per line of each match. Also the whole-page mark.
// Node-safe. Matched text stays in memory for the review panel; never logged.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { pageBoxes } from "../pages/geometry";
import { pageChars, type PageChar, type Rect } from "../edit/chars";
import { findMatches, type SearchSpec, type TextMatch } from "./patterns";

export type MarkSource = TextMatch["source"] | "manual";

/** A redaction waiting for review. Rects are PDF points, bottom-left origin. */
export interface MarkCandidate {
  kind: "text" | "area" | "page";
  pageIndex: number;
  rects: Rect[];
  source: MarkSource;
  /** The text found (search hits only), for the review list. Never logged. */
  text?: string;
}

/** Page text as one string plus, per code unit, the char it came from. */
export function charText(chars: PageChar[]): { text: string; owner: number[] } {
  let text = "";
  const owner: number[] = [];
  chars.forEach((c, i) => {
    text += c.ch;
    for (let k = 0; k < c.ch.length; k++) owner.push(i);
  });
  return { text, owner };
}

/**
 * One box per line for the drawn chars in [start, end): generated spaces and line
 * breaks are not boxed, so a match that wraps gets two tight boxes, not one big one.
 */
export function matchRects(chars: PageChar[], owner: number[], start: number, end: number): Rect[] {
  const picked: PageChar[] = [];
  let last = -1;
  for (let k = start; k < end; k++) {
    const i = owner[k];
    if (i === undefined || i === last) continue;
    last = i;
    const c = chars[i];
    if (c && !c.generated && c.r > c.l && c.t > c.b) picked.push(c);
  }
  const lines: Rect[] = [];
  let cur: (Rect & { y: number; size: number }) | null = null;
  for (const c of picked) {
    if (cur && Math.abs(c.y - cur.y) <= Math.max(1, cur.size * 0.3)) {
      cur.l = Math.min(cur.l, c.l);
      cur.b = Math.min(cur.b, c.b);
      cur.r = Math.max(cur.r, c.r);
      cur.t = Math.max(cur.t, c.t);
      continue;
    }
    if (cur) lines.push({ l: cur.l, b: cur.b, r: cur.r, t: cur.t });
    cur = { l: c.l, b: c.b, r: c.r, t: c.t, y: c.y, size: c.size };
  }
  if (cur) lines.push({ l: cur.l, b: cur.b, r: cur.r, t: cur.t });
  return lines;
}

/** Search hits on every page (or `pages`). Scans need OCR first: they have no text. */
export function searchDocument(
  m: PdfiumModule,
  bytes: Uint8Array,
  spec: SearchSpec,
  pages?: number[],
): MarkCandidate[] {
  const doc = RawDoc.open(m, bytes);
  try {
    const out: MarkCandidate[] = [];
    const list = pages ?? Array.from({ length: doc.pageCount }, (_, i) => i);
    for (const pageIndex of list) {
      doc.withPage(pageIndex, (page) => {
        const textPage = m.FPDFText_LoadPage(page);
        try {
          const chars = pageChars(m, textPage);
          const { text, owner } = charText(chars);
          for (const hit of findMatches(text, spec)) {
            const rects = matchRects(chars, owner, hit.start, hit.end);
            if (!rects.length) continue;
            out.push({
              kind: "text",
              pageIndex,
              rects,
              source: hit.source,
              text: text.slice(hit.start, hit.end),
            });
          }
        } finally {
          m.FPDFText_ClosePage(textPage);
        }
      });
    }
    return out;
  } finally {
    doc.close();
  }
}

/**
 * Whole-page marks. The box is the MediaBox (and the CropBox when it is larger), so
 * content hidden outside the visible area goes too.
 */
export function pageMarks(m: PdfiumModule, bytes: Uint8Array, pages: number[]): MarkCandidate[] {
  const doc = RawDoc.open(m, bytes);
  try {
    return pages.map((pageIndex) =>
      doc.withPage(pageIndex, (page) => {
        const { media, crop } = pageBoxes(m, page);
        const rect: Rect = {
          l: Math.min(media.left, crop.left),
          b: Math.min(media.bottom, crop.bottom),
          r: Math.max(media.right, crop.right),
          t: Math.max(media.top, crop.top),
        };
        return { kind: "page", pageIndex, rects: [rect], source: "manual" } as MarkCandidate;
      }),
    );
  } finally {
    doc.close();
  }
}
