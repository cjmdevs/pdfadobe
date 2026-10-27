// Edit PDF (B3): what the Edit tool outlines on a page: its text boxes and images, as
// plain data (rects in PDF points, bottom-left origin) the UI can draw and hit-test.
// Ids are positions in grouping / drawing order, valid for these exact bytes only: the
// UI asks again after every edit (the tab reloads anyway).

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { pageChars, pageRules, type Rect } from "./chars";
import { groupChars } from "./group";
import { pageImages } from "./images";

export interface EditTextBox {
  kind: "text";
  /** Index in grouping order. */
  id: number;
  rect: Rect;
  /** Each line's rect, for a tighter outline and for hit-testing. */
  lines: Rect[];
  paragraphs: number;
  /** Start of the text, for accessible names (never logged). */
  preview: string;
}

export interface EditImage {
  kind: "image";
  /** Index among the page's images, in drawing order. */
  id: number;
  rect: Rect;
  placement: { cx: number; cy: number; width: number; height: number; rotation: number };
}

export interface EditPageInfo {
  width: number;
  height: number;
  boxes: EditTextBox[];
  images: EditImage[];
}

const pad = (r: Rect, d: number): Rect => ({ l: r.l - d, r: r.r + d, b: r.b - d, t: r.t + d });

export function editPageInfo(m: PdfiumModule, bytes: Uint8Array, pageIndex: number): EditPageInfo {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(pageIndex, (page) => {
      const textPage = m.FPDFText_LoadPage(page);
      const boxes = groupChars(pageChars(m, textPage), pageRules(m, page));
      m.FPDFText_ClosePage(textPage);
      return {
        width: m.FPDF_GetPageWidthF(page),
        height: m.FPDF_GetPageHeightF(page),
        boxes: boxes.map((b, id) => ({
          kind: "text" as const,
          id,
          // A point of air around the glyphs, like Acrobat's box outline.
          rect: pad(b, 1),
          lines: b.lines.map((l) => ({ l: l.l, r: l.r, b: l.b, t: l.t })),
          paragraphs: b.paragraphs.length,
          preview: (b.paragraphs[0]?.text ?? "").slice(0, 60),
        })),
        images: pageImages(m, page).map((img, id) => ({
          kind: "image" as const,
          id,
          rect: img.bounds,
          placement: img.placement,
        })),
      };
    });
  } finally {
    doc.close();
  }
}

/** The topmost item under a point (page points): images drawn later win, text over images. */
export function hitTest(info: EditPageInfo, x: number, y: number): EditTextBox | EditImage | null {
  const inside = (r: Rect) => x >= r.l && x <= r.r && y >= r.b && y <= r.t;
  const box = info.boxes.find((b) => inside(b.rect));
  if (box) return box;
  for (let i = info.images.length - 1; i >= 0; i--) {
    const img = info.images[i];
    if (img && inside(img.rect)) return img;
  }
  return null;
}
