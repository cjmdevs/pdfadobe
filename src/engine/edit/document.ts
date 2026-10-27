// Edit PDF (B3): edits as the app runs them, bytes in and bytes out (one undo step
// each). Boxes are found again by id in the same bytes the UI read them from, and the
// first paragraph's start must still match, so a stale request never edits the wrong
// text. Runs in the page worker and in Node.

import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import { pageChars, pageRules } from "./chars";
import type { IndexedFace } from "./fonts";
import { groupChars } from "./group";
import { EditRefused } from "./refusal";
import {
  detectStyle,
  retypeset,
  type FontChoice,
  type ParagraphStyle,
  type RetypesetDeps,
  type RetypesetResult,
} from "./retypeset";
import { removeBoxText } from "./split";
import type { Rect } from "./chars";
import {
  addImage,
  deleteImage,
  pageImages,
  placeImage,
  replaceImage,
  type Placement,
} from "./images";

/** A text box on a page, as editPageInfo listed it. */
export interface BoxRef {
  page: number;
  id: number;
  /** editPageInfo's preview of the box: checked before editing. */
  preview: string;
}

/** A font choice that can cross to the worker (no PDFium handles). */
export type PlainFont =
  /** Keep the paragraph's own font. */
  | { kind: "original" }
  | { kind: "standard"; name: string }
  | { kind: "file"; face: IndexedFace; bytes: Uint8Array };

export type PlainStyle = Omit<ParagraphStyle, "font"> & { font: PlainFont };

export interface EditOutcome {
  bytes: Uint8Array;
  /** Null when the box was emptied (its text removed). */
  result: RetypesetResult | null;
}

/** Retypesets the box's paragraphs. `styles[i]` overrides paragraph i's style. */
export function editBoxText(
  m: PdfiumModule,
  bytes: Uint8Array,
  ref: BoxRef,
  paragraphs: string[],
  deps: RetypesetDeps,
  styles: (Partial<PlainStyle> | undefined)[] = [],
  /** New box width in points (the right-edge handle): the text wraps at it. */
  width?: number,
): EditOutcome {
  const doc = RawDoc.open(m, bytes);
  try {
    const result = doc.withPage(
      ref.page,
      (page) => {
        const tp = m.FPDFText_LoadPage(page);
        const chars = pageChars(m, tp);
        m.FPDFText_ClosePage(tp);
        const rules = pageRules(m, page);
        const boxes = groupChars(chars, rules);
        const box = boxes[ref.id];
        if (!box || (box.paragraphs[0]?.text ?? "").slice(0, 60) !== ref.preview)
          throw new EditRefused("The page changed since this text was selected. Select it again.");
        const texts = paragraphs.map((t) => t.replace(/\s+/g, " ").trim());
        // Everything deleted: the box's text goes (other text drawn with it stays).
        if (texts.every((t) => !t)) {
          removeBoxText(m, doc.ptr, page, box, chars).commit();
          return null;
        }
        const found = detectStyle(m, box, rules);
        const paras = texts
          .map((text, i) => {
            const own = found[Math.min(i, found.length - 1)];
            if (!own) throw new Error("box without paragraphs");
            return { text, style: merge(own, styles[i]) };
          })
          // Empty lines between paragraphs are not kept (one style per paragraph, no
          // paragraph spacing in stage 1).
          .filter((p) => p.text);
        return retypeset(
          m,
          doc.ptr,
          page,
          {
            kind: "box",
            box,
            chars,
            rules,
            others: boxes,
            ...(width === undefined ? {} : { width: Math.max(12, width) }),
          },
          paras,
          deps,
        );
      },
      true,
    );
    return { bytes: doc.save(), result };
  } finally {
    doc.close();
  }
}

/** A new text box: first baseline at (x, y); `width` wraps, null grows. */
export function addTextBox(
  m: PdfiumModule,
  bytes: Uint8Array,
  page: number,
  at: { x: number; y: number; width: number | null },
  paragraphs: string[],
  style: PlainStyle,
  deps: RetypesetDeps,
): EditOutcome {
  const texts = paragraphs.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!texts.length) return { bytes, result: null };
  if (style.font.kind === "original") throw new Error("new text needs a font");
  const font: FontChoice = style.font;
  const doc = RawDoc.open(m, bytes);
  try {
    const result = doc.withPage(
      page,
      (p) => {
        const tp = m.FPDFText_LoadPage(p);
        const chars = pageChars(m, tp);
        m.FPDFText_ClosePage(tp);
        const rules = pageRules(m, p);
        const others = groupChars(chars, rules);
        return retypeset(
          m,
          doc.ptr,
          p,
          { kind: "new", ...at, others, rules },
          texts.map((text) => ({ text, style: { ...style, font } })),
          deps,
        );
      },
      true,
    );
    return { bytes: doc.save(), result };
  } finally {
    doc.close();
  }
}

function merge(own: ParagraphStyle, over: Partial<PlainStyle> | undefined): ParagraphStyle {
  if (!over) return own;
  const { font, ...rest } = over;
  return {
    ...own,
    ...rest,
    font: !font || font.kind === "original" ? own.font : font,
  };
}

/** An image on a page, as editPageInfo listed it (its rect is checked before editing). */
export interface ImageRef {
  page: number;
  id: number;
  rect: Rect;
}

export type ImageEdit =
  | { kind: "place"; placement: Placement }
  | { kind: "delete" }
  /** New picture (JPEG or PNG bytes) in the old place. */
  | { kind: "replace"; data: Uint8Array };

/** Moves / resizes / rotates, deletes or replaces one image. */
export function editImage(
  m: PdfiumModule,
  bytes: Uint8Array,
  ref: ImageRef,
  op: ImageEdit,
): Uint8Array {
  const doc = RawDoc.open(m, bytes);
  try {
    doc.withPage(ref.page, (page) => {
      const img = pageImages(m, page)[ref.id];
      const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
      if (
        !img ||
        !same(img.bounds.l, ref.rect.l) ||
        !same(img.bounds.r, ref.rect.r) ||
        !same(img.bounds.b, ref.rect.b) ||
        !same(img.bounds.t, ref.rect.t)
      )
        throw new EditRefused("The page changed since this image was selected. Select it again.");
      if (op.kind === "place") placeImage(m, page, img.obj, op.placement);
      else if (op.kind === "delete") deleteImage(m, page, img.obj);
      else replaceImage(m, page, img.obj, op.data);
    });
    return doc.save();
  } finally {
    doc.close();
  }
}

/** Adds a JPEG (kept as JPEG) or PNG image at `placement`, on top of the page. */
export function addImageToPage(
  m: PdfiumModule,
  bytes: Uint8Array,
  page: number,
  data: Uint8Array,
  placement: Placement,
): Uint8Array {
  const doc = RawDoc.open(m, bytes);
  try {
    doc.withPage(page, (p) => addImage(m, doc.ptr, p, data, placement));
    return doc.save();
  } finally {
    doc.close();
  }
}
