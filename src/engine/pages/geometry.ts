// Page geometry through PDFium directly: rotation, crop box, page size, blank pages.
// These change page dictionaries only, so bookmarks, fields and annotations keep
// pointing at the same page objects and need no fixing.

import type { PdfiumModule } from "../pdfium";
import { editRaw, readBox, RawDoc, type Box } from "./raw";

export type QuarterTurns = 1 | 2 | 3;

/** Rotates pages clockwise by 90° x `turns`, on top of their current /Rotate. */
export function rotatePages(
  m: PdfiumModule,
  bytes: Uint8Array,
  indices: number[],
  turns: QuarterTurns,
): Uint8Array {
  return editRaw(m, bytes, (doc) => {
    for (const i of indices) {
      doc.withPage(i, (p) => m.FPDFPage_SetRotation(p, (m.FPDFPage_GetRotation(p) + turns) % 4));
    }
  });
}

/** Margins as the user sees the page (after its /Rotate), in points. */
export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Visible margins -> margins on the unrotated page box. `rotation` is in quarter turns. */
export function unrotateMargins(m: Margins, rotation: number): Margins {
  switch (rotation % 4) {
    case 1: // shown turned 90° clockwise: the box's left edge is on top
      return { left: m.top, top: m.right, right: m.bottom, bottom: m.left };
    case 2:
      return { left: m.right, top: m.bottom, right: m.left, bottom: m.top };
    case 3:
      return { left: m.bottom, top: m.left, right: m.top, bottom: m.right };
    default:
      return m;
  }
}

export function pageBoxes(m: PdfiumModule, page: number): { media: Box; crop: Box } {
  const media = readBox(m, (l, b, r, t) => m.FPDFPage_GetMediaBox(page, l, b, r, t));
  if (!media) throw new Error("page has no media box");
  const crop = readBox(m, (l, b, r, t) => m.FPDFPage_GetCropBox(page, l, b, r, t)) ?? media;
  return { media, crop };
}

/** Trims `margins` off the current visible area (the crop box) of each page. */
export function cropPages(
  m: PdfiumModule,
  bytes: Uint8Array,
  indices: number[],
  margins: Margins,
): Uint8Array {
  return editRaw(m, bytes, (doc) => {
    for (const i of indices) {
      doc.withPage(i, (p) => {
        const { crop } = pageBoxes(m, p);
        const mm = unrotateMargins(margins, m.FPDFPage_GetRotation(p));
        const box = {
          left: crop.left + mm.left,
          bottom: crop.bottom + mm.bottom,
          right: crop.right - mm.right,
          top: crop.top - mm.top,
        };
        if (box.right - box.left < 1 || box.top - box.bottom < 1) {
          throw new RangeError(`the margins leave nothing of page ${i + 1}`);
        }
        m.FPDFPage_SetCropBox(p, box.left, box.bottom, box.right, box.top);
      });
    }
  });
}

/**
 * Gives each page a new size (as seen, i.e. after /Rotate) and scales its content and
 * annotations to fit, centred, keeping the aspect ratio. What was outside the crop box
 * stays outside.
 */
export function setPageSize(
  m: PdfiumModule,
  bytes: Uint8Array,
  indices: number[],
  size: { width: number; height: number },
): Uint8Array {
  return editRaw(m, bytes, (doc) => {
    for (const i of indices) {
      doc.withPage(i, (p) => {
        const sideways = m.FPDFPage_GetRotation(p) % 2 === 1;
        const W = sideways ? size.height : size.width;
        const H = sideways ? size.width : size.height;
        const { crop } = pageBoxes(m, p);
        const w = crop.right - crop.left;
        const h = crop.top - crop.bottom;
        const s = Math.min(W / w, H / h);
        const e = (W - w * s) / 2 - crop.left * s;
        const f = (H - h * s) / 2 - crop.bottom * s;
        transformPage(m, p, [s, 0, 0, s, e, f], { left: 0, bottom: 0, right: W, top: H });
        m.FPDFPage_TransformAnnots(p, s, 0, 0, s, e, f);
        for (const set of [
          m.FPDFPage_SetMediaBox,
          m.FPDFPage_SetCropBox,
          m.FPDFPage_SetTrimBox,
          m.FPDFPage_SetBleedBox,
          m.FPDFPage_SetArtBox,
        ]) {
          set(p, 0, 0, W, H);
        }
      });
    }
  });
}

/** Wraps the page content in `cm` with the given matrix and clips to `clip`. */
function transformPage(m: PdfiumModule, page: number, mx: number[], clip: Box): void {
  const ptr = m.pdfium.wasmExports.malloc(40);
  try {
    mx.forEach((v, k) => m.pdfium.setValue(ptr + 4 * k, v, "float"));
    // FS_RECTF is { left, top, right, bottom }.
    [clip.left, clip.top, clip.right, clip.bottom].forEach((v, k) =>
      m.pdfium.setValue(ptr + 24 + 4 * k, v, "float"),
    );
    if (!m.FPDFPage_TransFormWithClip(page, ptr, ptr + 24)) {
      throw new Error("page content could not be scaled");
    }
  } finally {
    m.pdfium.wasmExports.free(ptr);
  }
}

/** Visible size of a page (after /Rotate), in points. */
export function pageSize(
  m: PdfiumModule,
  doc: RawDoc,
  index: number,
): { width: number; height: number } {
  return doc.withPage(index, (p) => {
    const { crop } = pageBoxes(m, p);
    const w = crop.right - crop.left;
    const h = crop.top - crop.bottom;
    return m.FPDFPage_GetRotation(p) % 2 ? { width: h, height: w } : { width: w, height: h };
  });
}

/**
 * Inserts `count` blank pages before page `at`. Default size: the visible size of the
 * neighbouring page (the one before, else the one after), else US Letter.
 */
export function insertBlankPages(
  m: PdfiumModule,
  bytes: Uint8Array,
  at: number,
  count = 1,
  size?: { width: number; height: number },
): Uint8Array {
  return editRaw(m, bytes, (doc) => {
    const n = doc.pageCount;
    const neighbour = at > 0 ? at - 1 : n > 0 ? 0 : -1;
    const s = size ?? (neighbour >= 0 ? pageSize(m, doc, neighbour) : LETTER);
    for (let k = 0; k < count; k++) {
      const page = m.FPDFPage_New(doc.ptr, at + k, s.width, s.height);
      if (!page) throw new Error("PDFium could not add a page");
      m.FPDF_ClosePage(page);
    }
  });
}

export const LETTER = { width: 612, height: 792 };
