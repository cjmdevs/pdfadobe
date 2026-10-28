// Edit PDF (B3): what the Edit tool outlines on a page: its text boxes and images, as
// plain data (rects in PDF points, bottom-left origin) the UI can draw and hit-test.
// Ids are positions in grouping / drawing order, valid for these exact bytes only: the
// UI asks again after every edit (the tab reloads anyway).

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { pageChars, pageRules, type Rect } from "./chars";
import { groupChars } from "./group";
import { pageImages } from "./images";
import { detectStyle, mainChar, type Rgba } from "./retypeset";
import type { Align } from "./typeset";

export interface EditTextBox {
  kind: "text";
  /** Index in grouping order. */
  id: number;
  rect: Rect;
  /** Each line's rect, for a tighter outline and for hit-testing. */
  lines: Rect[];
  /** Each paragraph's text (hard breaks between them). */
  paragraphs: string[];
  /** Start of the text: identifies the box when it is edited (never logged). */
  preview: string;
  /** First baseline, PDF points. */
  baseline: number;
  /** Style of each paragraph, for the editor and the properties panel. */
  styles: PlainParagraphStyle[];
  /** Every paragraph is one line: the box grows instead of wrapping. */
  grows: boolean;
  /** Box id from our marked content (stable across edits), or null. */
  boxId: number | null;
}

/** A paragraph's style as plain data. */
export interface PlainParagraphStyle {
  /** Base font name as written in the PDF ("ABCDEF+Calibri-Bold", "Helvetica"). */
  fontName: string;
  size: number;
  color: Rgba;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: Align;
  leading: number;
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
      const rules = pageRules(m, page);
      const boxes = groupChars(pageChars(m, textPage), rules);
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
          paragraphs: b.paragraphs.map((p) => p.text),
          preview: (b.paragraphs[0]?.text ?? "").slice(0, 60),
          baseline: b.lines[0]?.y ?? b.b,
          grows: b.paragraphs.every((p) => p.lines.length === 1),
          boxId: b.id,
          styles: detectStyle(m, b, rules).map(({ font: _font, ...s }, i) => {
            void _font;
            const p = b.paragraphs[i];
            return { ...s, fontName: p ? mainChar(p).font : "" };
          }),
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
