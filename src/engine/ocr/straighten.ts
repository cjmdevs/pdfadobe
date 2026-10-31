// Enhance (Phase 7): Straighten Pages and Turn Pages Upright. Unlike Recognize Text,
// these change how the page looks, losslessly: a straightened page gets a rotation
// around its own content (the scan's image bytes are untouched) and an upside-down or
// sideways page gets a new /Rotate.
import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { rotatePages, type QuarterTurns } from "../pages";
import type { Qpdf } from "../pages/qpdf";
import { wrapContents, type ContentWrap } from "../pages/wrap";
import { estimateSkew, renderGray } from "./image";
import { orientationOf, type OcrControl } from "./index";
import type { Ocr } from "./tesseract";

export interface StraightenReport {
  bytes: Uint8Array;
  /** Pages turned, with the clockwise angle (degrees) as seen on screen. */
  turned: { page: number; degrees: number }[];
}

/** Tilts smaller than this are left alone (they are within a scanner's own accuracy). */
export const MIN_SKEW = 0.2;

/** Straightens tilted pages by turning their content about the page centre. */
export async function straightenPages(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  pages: number[],
): Promise<StraightenReport> {
  const doc = RawDoc.open(m, bytes);
  const wraps: ContentWrap[] = [];
  const turned: StraightenReport["turned"] = [];
  try {
    for (const page of pages) {
      const deg = estimateSkew(renderGray(m, doc, page, 150));
      if (Math.abs(deg) < MIN_SKEW) continue;
      const box = doc.withPage(page, (p) => cropCentre(m, p));
      // A clockwise turn on screen is a clockwise turn in user space too (/Rotate is a
      // turn as well, so the two commute). PDF y goes up: clockwise = [cos -sin sin cos].
      const a = (deg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const e = box.x - cos * box.x - sin * box.y;
      const f = box.y + sin * box.x - cos * box.y;
      const n = (v: number) => Number(v.toFixed(6));
      wraps.push({ page, before: `${[cos, -sin, sin, cos, e, f].map(n).join(" ")} cm`, after: "" });
      turned.push({ page, degrees: deg });
    }
  } finally {
    doc.close();
  }
  return { bytes: await wrapContents(qpdf, bytes, wraps), turned };
}

/** Centre of a page's crop box in user space. */
function cropCentre(m: PdfiumModule, page: number): { x: number; y: number } {
  const mem = m.pdfium.wasmExports.malloc(16);
  try {
    const f = (o: number) => m.pdfium.getValue(mem + o, "float");
    if (!m.FPDFPage_GetCropBox(page, mem, mem + 4, mem + 8, mem + 12)) {
      if (!m.FPDFPage_GetMediaBox(page, mem, mem + 4, mem + 8, mem + 12)) return { x: 306, y: 396 };
    }
    return { x: (f(0) + f(8)) / 2, y: (f(4) + f(12)) / 2 };
  } finally {
    m.pdfium.wasmExports.free(mem);
  }
}

export interface UprightReport {
  bytes: Uint8Array;
  /** Pages given a new /Rotate, with the clockwise turn added. */
  turned: { page: number; degrees: 90 | 180 | 270 }[];
}

/** Turns sideways and upside-down pages upright (Tesseract's orientation detection). */
export async function turnPagesUpright(
  m: PdfiumModule,
  ocr: Ocr,
  bytes: Uint8Array,
  pages: number[],
  control: OcrControl,
): Promise<UprightReport> {
  const doc = RawDoc.open(m, bytes);
  const turned: UprightReport["turned"] = [];
  try {
    for (const page of pages) {
      control.check();
      const q = await orientationOf(ocr, renderGray(m, doc, page, 300), 300, control);
      if (q) turned.push({ page, degrees: q });
    }
  } finally {
    doc.close();
  }
  let out = bytes;
  for (const d of [90, 180, 270] as const) {
    const these = turned.filter((t) => t.degrees === d).map((t) => t.page);
    if (these.length) out = rotatePages(m, out, these, (d / 90) as QuarterTurns);
  }
  return { bytes: out, turned };
}
