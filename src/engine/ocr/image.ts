// Page images for OCR: an 8-bit grey render, straightened in memory before Tesseract
// reads it. The PDF page itself is never changed by any of this.
import type { PdfiumModule } from "../pdfium";
import { heap, type RawDoc } from "../pages/raw";

export interface Gray {
  width: number;
  height: number;
  /** One byte per pixel, rows top to bottom, 0 = black. */
  data: Uint8Array;
}

/** Renders page `index` as displayed (crop box, /Rotate applied) at `dpi`. */
export function renderGray(m: PdfiumModule, doc: RawDoc, index: number, dpi: number): Gray {
  return doc.withPage(index, (page) => {
    const scale = dpi / 72;
    const width = Math.max(1, Math.round(m.FPDF_GetPageWidthF(page) * scale));
    const height = Math.max(1, Math.round(m.FPDF_GetPageHeightF(page) * scale));
    // Format 1 = FPDFBitmap_Gray: PDFium renders straight to one byte per pixel.
    const bmp = m.FPDFBitmap_CreateEx(width, height, 1, 0, 0);
    if (!bmp) throw new Error(`page ${index + 1} is too large to render for OCR`);
    try {
      m.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
      // 0x01: draw annotations, as the page is seen.
      m.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, 0, 0x01);
      const buf = m.FPDFBitmap_GetBuffer(bmp);
      const stride = m.FPDFBitmap_GetStride(bmp);
      const h = heap(m);
      const data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        data.set(h.subarray(buf + y * stride, buf + y * stride + width), y * width);
      return { width, height, data };
    } finally {
      m.FPDFBitmap_Destroy(bmp);
    }
  });
}

/** Binary PGM (P5), which Leptonica reads without any image library. */
export function toPgm(g: Gray): Uint8Array {
  const head = new TextEncoder().encode(`P5\n${g.width} ${g.height}\n255\n`);
  const out = new Uint8Array(head.length + g.data.length);
  out.set(head);
  out.set(g.data, head.length);
  return out;
}

/** Turns the image clockwise by a multiple of 90 degrees. */
export function rotateQuarter(g: Gray, clockwise: 0 | 90 | 180 | 270): Gray {
  if (clockwise === 0) return g;
  const { width: w, height: h, data } = g;
  const turned = clockwise !== 180;
  const out = new Uint8Array(w * h);
  const ow = turned ? h : w;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [nx, ny] =
        clockwise === 90
          ? [h - 1 - y, x]
          : clockwise === 180
            ? [w - 1 - x, h - 1 - y]
            : [y, w - 1 - x];
      out[ny * ow + nx] = data[y * w + x] ?? 255;
    }
  return { width: ow, height: turned ? w : h, data: out };
}

/**
 * Turns the image clockwise by `degrees` about its centre, keeping its size (corners
 * that leave the frame are dropped, uncovered corners are white). Bilinear.
 */
export function rotateFine(g: Gray, degrees: number): Gray {
  if (degrees === 0) return g;
  const { width: w, height: h, data } = g;
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      // Inverse map: where this output pixel comes from (y grows downwards, so a
      // clockwise turn on screen is a positive angle here).
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[y * w + x] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * w + x0;
      const top = (data[i] ?? 0) * (1 - fx) + (data[i + 1] ?? 0) * fx;
      const bottom = (data[i + w] ?? 0) * (1 - fx) + (data[i + w + 1] ?? 0) * fx;
      out[y * w + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * The clockwise turn (degrees, within ±`range`) that makes text lines horizontal:
 * the angle whose row profile of dark pixels is the most sharply peaked. Works on a
 * reduced copy, so it is quick even at 300 dpi. 0 when the page has too little ink.
 */
export function estimateSkew(g: Gray, range = 10): number {
  const step = Math.max(1, Math.round(Math.max(g.width, g.height) / 800));
  const pts: number[] = [];
  for (let y = 0; y < g.height; y += step)
    for (let x = 0; x < g.width; x += step)
      if ((g.data[y * g.width + x] ?? 255) < 128) pts.push(x, y);
  if (pts.length < 200) return 0;
  const score = (deg: number) => {
    // Dark pixels projected onto the axis perpendicular to lines turned by `deg`.
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const bins = new Map<number, number>();
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.round(((pts[i + 1] ?? 0) * cos - (pts[i] ?? 0) * sin) / step);
      bins.set(r, (bins.get(r) ?? 0) + 1);
    }
    let s = 0;
    for (const v of bins.values()) s += v * v;
    return s;
  };
  let best = 0;
  let bestScore = score(0);
  const search = (from: number, to: number, by: number) => {
    for (let d = from; d <= to + 1e-9; d += by) {
      const s = score(d);
      if (s > bestScore) {
        bestScore = s;
        best = d;
      }
    }
  };
  search(-range, range, 0.5);
  const coarse = best;
  search(coarse - 0.5, coarse + 0.5, 0.1);
  // A line at angle `best` is straightened by turning the image the other way.
  return Math.round(-best * 10) / 10 || 0; // never -0
}
