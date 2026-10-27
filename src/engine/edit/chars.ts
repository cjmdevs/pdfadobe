// Edit PDF (B3): what PDFium knows about a page's text and ruled lines, in plain data.
// Grouping (`group.ts`) works on this, so it can be tested without PDFium.
//
// Coordinates are PDF user space: points, bottom-left origin.

import type { PdfiumModule } from "../pdfium";

const FPDF_PAGEOBJ_PATH = 2;

/** One character from PDFium's text page. */
export interface PageChar {
  /** Index in the text page (generated spaces included). */
  index: number;
  ch: string;
  /** PDFium inserted it (a space or line break the content stream never drew). */
  generated: boolean;
  /** Origin (baseline start). */
  x: number;
  y: number;
  /** Loose box: the font's full advance and ascent/descent, not the ink. */
  l: number;
  b: number;
  r: number;
  t: number;
  /** Effective size in points: the Tf size scaled by the text and page matrices. */
  size: number;
  /** Base font name as written in the PDF ("ABCDEF+Calibri-Bold", "Helvetica"). */
  font: string;
  /** The text object that draws it (a PDFium handle, valid while the page is loaded). */
  obj: number;
}

export interface HRule {
  l: number;
  r: number;
  y: number;
  /** The path object, when the rule is one (typed rules have none). */
  obj?: number;
}

export interface VRule {
  x: number;
  b: number;
  t: number;
}

export interface Rules {
  h: HRule[];
  v: VRule[];
}

export interface Rect {
  l: number;
  b: number;
  r: number;
  t: number;
}

/** Bounds of a page object (FPDFPageObj_GetBounds), or null. */
export function objBounds(m: PdfiumModule, obj: number): Rect | null {
  const p = m.pdfium.wasmExports.malloc(16);
  try {
    if (!m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)) return null;
    const f = (o: number) => m.pdfium.getValue(p + o, "float");
    return { l: f(0), b: f(4), r: f(8), t: f(12) };
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

/** Every character on a loaded page. `textPage` comes from FPDFText_LoadPage. */
export function pageChars(m: PdfiumModule, textPage: number): PageChar[] {
  const ex = m.pdfium.wasmExports;
  const origin = ex.malloc(16);
  const box = ex.malloc(16);
  const mtx = ex.malloc(24);
  const fontBuf = ex.malloc(256);
  const flags = ex.malloc(4);
  const f32 = (p: number, k: number) => m.pdfium.getValue(p + k * 4, "float");
  try {
    const out: PageChar[] = [];
    const n = m.FPDFText_CountChars(textPage);
    for (let i = 0; i < n; i++) {
      m.FPDFText_GetCharOrigin(textPage, i, origin, origin + 8);
      m.FPDFText_GetLooseCharBox(textPage, i, box);
      const fontLen = m.FPDFText_GetFontInfo(textPage, i, fontBuf, 256, flags);
      // FPDFText_GetFontSize is the Tf size only. Print drivers write "Tf 1" and put the
      // size in the text matrix, so scale by the char's matrix (text matrix x CTM).
      let scale = 1;
      if (m.FPDFText_GetMatrix(textPage, i, mtx)) {
        const a = f32(mtx, 0);
        const b = f32(mtx, 1);
        const c = f32(mtx, 2);
        const d = f32(mtx, 3);
        scale = Math.sqrt(Math.abs(a * d - b * c)) || 1;
      }
      out.push({
        index: i,
        ch: String.fromCodePoint(m.FPDFText_GetUnicode(textPage, i)),
        generated: m.FPDFText_IsGenerated(textPage, i) === 1,
        x: m.pdfium.getValue(origin, "double"),
        y: m.pdfium.getValue(origin + 8, "double"),
        // FS_RECTF order: left, top, right, bottom.
        l: f32(box, 0),
        t: f32(box, 1),
        r: f32(box, 2),
        b: f32(box, 3),
        size: m.FPDFText_GetFontSize(textPage, i) * scale,
        font: fontLen > 0 ? m.pdfium.UTF8ToString(fontBuf) : "",
        obj: m.FPDFText_GetTextObject(textPage, i),
      });
    }
    return out;
  } finally {
    for (const p of [origin, box, mtx, fontBuf, flags]) ex.free(p);
  }
}

/** Thin path objects: horizontal and vertical rules (form boxes, table cells, columns). */
export function pageRules(m: PdfiumModule, page: number): Rules {
  const rules: Rules = { h: [], v: [] };
  const n = m.FPDFPage_CountObjects(page);
  for (let i = 0; i < n; i++) {
    const obj = m.FPDFPage_GetObject(page, i);
    if (m.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_PATH) continue;
    const b = objBounds(m, obj);
    if (!b) continue;
    if (b.t - b.b < 4 && b.r - b.l > 10) rules.h.push({ l: b.l, r: b.r, y: (b.t + b.b) / 2, obj });
    else if (b.r - b.l < 4 && b.t - b.b > 6) rules.v.push({ x: (b.l + b.r) / 2, b: b.b, t: b.t });
  }
  return rules;
}
