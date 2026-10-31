// Conversions (Phase 7, no Office formats in v1): PDF pages to PNG or JPEG at a chosen
// resolution, and PDF to plain text. Images to PDF is pages/images.ts (imagesToPdf).
import type { PdfiumModule } from "../pdfium";
import { heap, RawDoc } from "../pages/raw";
import { encodePng } from "../pages/png";
import { encodeJpeg } from "../optimize/jpeg";

export type ImageFormat = "png" | "jpeg";

/** Largest side we render, in pixels (a 600 dpi Legal page is 5100 x 8400). */
const MAX_SIDE = 12_000;

/** One page as a PNG or JPEG file, rendered as seen (crop box, /Rotate, comments). */
export function pageImage(
  m: PdfiumModule,
  bytes: Uint8Array,
  index: number,
  dpi: number,
  format: ImageFormat,
  quality = 85,
): Uint8Array {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(index, (page) => {
      const scale = dpi / 72;
      const width = Math.round(m.FPDF_GetPageWidthF(page) * scale);
      const height = Math.round(m.FPDF_GetPageHeightF(page) * scale);
      if (width < 1 || height < 1 || Math.max(width, height) > MAX_SIDE) {
        throw new RangeError(
          `page ${index + 1} is too large at ${dpi} dpi; choose a lower resolution`,
        );
      }
      const bmp = m.FPDFBitmap_Create(width, height, 0);
      if (!bmp) throw new RangeError(`page ${index + 1} is too large to render`);
      try {
        m.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
        // 0x01: draw annotations, as the page is seen.
        m.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, 0, 0x01);
        const buf = m.FPDFBitmap_GetBuffer(bmp);
        const stride = m.FPDFBitmap_GetStride(bmp);
        const h = heap(m);
        if (format === "png") {
          const rgba = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const s = buf + y * stride + x * 4; // BGRx
              const d = (y * width + x) * 4;
              rgba[d] = h[s + 2] ?? 0;
              rgba[d + 1] = h[s + 1] ?? 0;
              rgba[d + 2] = h[s] ?? 0;
              rgba[d + 3] = 255;
            }
          return encodePng({ width, height, data: rgba });
        }
        const rgb = new Uint8Array(width * height * 3);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const s = buf + y * stride + x * 4;
            const d = (y * width + x) * 3;
            rgb[d] = h[s + 2] ?? 0;
            rgb[d + 1] = h[s + 1] ?? 0;
            rgb[d + 2] = h[s] ?? 0;
          }
        return encodeJpeg(width, height, rgb, 3, quality);
      } finally {
        m.FPDFBitmap_Destroy(bmp);
      }
    });
  } finally {
    doc.close();
  }
}

/** Text of one page in reading order as PDFium extracts it (lines end in CR LF). */
function pageText(m: PdfiumModule, doc: RawDoc, index: number): string {
  return doc.withPage(index, (page) => {
    const tp = m.FPDFText_LoadPage(page);
    if (!tp) return "";
    try {
      const n = m.FPDFText_CountChars(tp);
      if (n <= 0) return "";
      const mem = m.pdfium.wasmExports.malloc((n + 1) * 2);
      try {
        const got = m.FPDFText_GetText(tp, 0, n, mem);
        const units = new Uint16Array(heap(m).buffer, mem, Math.max(0, got - 1)).slice();
        return String.fromCharCode(...units).replace(/\0/g, "");
      } finally {
        m.pdfium.wasmExports.free(mem);
      }
    } finally {
      m.FPDFText_ClosePage(tp);
    }
  });
}

/**
 * The whole document as plain text: pages in order, separated by a form feed (the
 * pdftotext convention; Notepad shows it as a small mark), Windows line endings.
 * Scanned pages without OCR give no text.
 */
export function documentText(m: PdfiumModule, bytes: Uint8Array, pages?: number[]): string {
  const doc = RawDoc.open(m, bytes);
  try {
    const list = pages ?? Array.from({ length: doc.pageCount }, (_, i) => i);
    return list
      .map((i) =>
        pageText(m, doc, i)
          .replace(/\r?\n/g, "\r\n")
          .replace(/[ \t]+\r\n/g, "\r\n")
          .trimEnd(),
      )
      .join("\r\n\f");
  } finally {
    doc.close();
  }
}

/** "Return_Page_003.png": page numbers padded to the length of the page count. */
export function pageFileName(
  stem: string,
  page: number,
  pageCount: number,
  format: ImageFormat,
): string {
  const n = String(page + 1).padStart(String(pageCount).length, "0");
  return `${stem}_Page_${n}.${format === "png" ? "png" : "jpg"}`;
}
