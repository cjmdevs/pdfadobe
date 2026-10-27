// Renders a page with the raw PDFium module and compares renders (Edit PDF tests).
import type { PdfiumModule } from "../../src/engine/pdfium";
import { heap, type RawDoc } from "../../src/engine/pages/raw";
import type { Rect } from "../../src/engine/edit";

export interface Render {
  width: number;
  height: number;
  /** RGBA. */
  data: Uint8Array;
  /** Pixels per point. */
  scale: number;
}

export function renderPage(m: PdfiumModule, doc: RawDoc, index = 0, scale = 2): Render {
  return doc.withPage(index, (page) => {
    const width = Math.round(m.FPDF_GetPageWidthF(page) * scale);
    const height = Math.round(m.FPDF_GetPageHeightF(page) * scale);
    const bmp = m.FPDFBitmap_Create(width, height, 1);
    try {
      m.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
      m.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, 0, 0x01);
      const buf = m.FPDFBitmap_GetBuffer(bmp);
      const stride = m.FPDFBitmap_GetStride(bmp);
      const h = heap(m);
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const s = buf + y * stride + x * 4; // BGRA
          const d = (y * width + x) * 4;
          data[d] = h[s + 2]!;
          data[d + 1] = h[s + 1]!;
          data[d + 2] = h[s]!;
          data[d + 3] = 255;
        }
      return { width, height, data, scale };
    } finally {
      m.FPDFBitmap_Destroy(bmp);
    }
  });
}

/** Pixels that differ between two renders outside `keep` (page space). */
export function changedOutside(a: Render, b: Render, keep: Rect): number {
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    const py = (a.height - y) / a.scale;
    for (let x = 0; x < a.width; x++) {
      const px = x / a.scale;
      if (px >= keep.l && px <= keep.r && py >= keep.b && py <= keep.t) continue;
      const i = (y * a.width + x) * 4;
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2]
      )
        n++;
    }
  }
  return n;
}
