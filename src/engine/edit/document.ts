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
import { nextBoxId, setBoxId } from "./marks";
import { removeBoxText } from "./split";
import type { TextBox } from "./group";
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

/** The page's chars, rules and boxes, as grouping sees them now. */
function groupNow(m: PdfiumModule, page: number) {
  const tp = m.FPDFText_LoadPage(page);
  const chars = pageChars(m, tp);
  m.FPDFText_ClosePage(tp);
  const rules = pageRules(m, page);
  return { chars, rules, boxes: groupChars(chars, rules) };
}

const STALE = "The page changed since this text was selected. Select it again.";
const previewOf = (b: TextBox) => (b.paragraphs[0]?.text ?? "").slice(0, 60);

/**
 * Joins boxes on one page into one paragraph, in the top box's place and style, as
 * wide as all of them together. One undo step.
 */
export function joinBoxes(
  m: PdfiumModule,
  bytes: Uint8Array,
  refs: BoxRef[],
  deps: RetypesetDeps,
): EditOutcome {
  const page = refs[0]?.page ?? 0;
  if (refs.length < 2 || refs.some((r) => r.page !== page))
    throw new EditRefused("Select two or more text boxes on the same page to join them.");
  const doc = RawDoc.open(m, bytes);
  try {
    const result = doc.withPage(
      page,
      (p) => {
        const g = groupNow(m, p);
        const picked = refs.map((r) => {
          const b = g.boxes[r.id];
          if (!b || previewOf(b) !== r.preview) throw new EditRefused(STALE);
          return b;
        });
        picked.sort((a, b) => b.t - a.t || a.l - b.l);
        const [top, ...rest] = picked as [TextBox, ...TextBox[]];
        const text = picked
          .flatMap((b) => b.paragraphs.map((x) => x.text))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const style = detectStyle(m, top, g.rules)[0];
        if (!style) throw new Error("box without paragraphs");
        const width = Math.max(...picked.map((b) => b.r)) - top.l;
        // Lines after the first start at the leftmost box's edge (a split first-line
        // indent comes back whole).
        const indent = {
          first: style.indent?.first ?? 0,
          left: Math.min(...picked.map((b) => b.l)) - top.l,
        };
        const at = { l: top.l, t: top.t, preview: previewOf(top) };
        // The other boxes' text goes first; the top box is found again (a shared text
        // object may have been rewritten).
        for (const b of rest) removeBoxText(m, doc.ptr, p, b, g.chars).commit();
        const h = groupNow(m, p);
        const again = h.boxes.find(
          (b) =>
            previewOf(b) === at.preview && Math.abs(b.l - at.l) < 1 && Math.abs(b.t - at.t) < 1,
        );
        if (!again) throw new EditRefused(STALE);
        return retypeset(
          m,
          doc.ptr,
          p,
          { kind: "box", box: again, chars: h.chars, rules: h.rules, others: h.boxes, width },
          [{ text, style: { ...style, indent, spaceBefore: 0 } }],
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

/** A caret in a box's text: paragraph index and character offset in it. */
export interface Caret {
  paragraph: number;
  offset: number;
}

/**
 * Splits a box at the caret into two boxes: the text before stays, the text after
 * starts a new box on the next line (same left edge, width and style). `paragraphs`
 * is the box's current text (the editor's, which may hold unsaved typing). One undo
 * step; both boxes keep their own id, so they stay apart when the file is reopened.
 */
export function splitBox(
  m: PdfiumModule,
  bytes: Uint8Array,
  ref: BoxRef,
  paragraphs: string[],
  caret: Caret,
  deps: RetypesetDeps,
  styles: (Partial<PlainStyle> | undefined)[] = [],
): EditOutcome {
  const doc = RawDoc.open(m, bytes);
  try {
    const result = doc.withPage(
      ref.page,
      (page) => {
        const g = groupNow(m, page);
        const box = g.boxes[ref.id];
        if (!box || previewOf(box) !== ref.preview) throw new EditRefused(STALE);
        const found = detectStyle(m, box, g.rules);
        const own = (i: number) => {
          const st = found[Math.min(i, found.length - 1)];
          if (!st) throw new Error("box without paragraphs");
          return merge(st, styles[i]);
        };
        const p = caret.paragraph;
        const cut = paragraphs[p] ?? "";
        const head = cut.slice(0, caret.offset).trim();
        const tail = cut.slice(caret.offset).trim();
        const before = [...paragraphs.slice(0, p).map((t, i) => ({ t, i })), { t: head, i: p }];
        const after = [
          { t: tail, i: p },
          ...paragraphs.slice(p + 1).map((t, i) => ({ t, i: i + p + 1 })),
        ];
        const clean = (xs: { t: string; i: number }[]) =>
          xs.map((x) => ({ ...x, t: x.t.replace(/\s+/g, " ").trim() })).filter((x) => x.t);
        const a = clean(before);
        const b = clean(after);
        if (!a.length || !b.length)
          throw new EditRefused("Put the caret inside the text, where the new box should start.");
        const paras = [
          ...a.map((x) => ({ text: x.t, style: own(x.i) })),
          ...b.map((x, k) => {
            const st = own(x.i);
            // Mid-paragraph: the second half starts like a continuation line.
            if (k === 0 && caret.offset > 0) {
              const { marker: _marker, ...rest } = st;
              void _marker;
              const left = st.indent?.left ?? 0;
              return {
                text: x.t,
                style: { ...rest, indent: { first: left, left }, spaceBefore: 0 },
              };
            }
            return { text: x.t, style: st };
          }),
        ];
        const r = retypeset(
          m,
          doc.ptr,
          page,
          { kind: "box", box, chars: g.chars, rules: g.rules, others: g.boxes },
          paras,
          deps,
        );
        // The second half becomes its own box.
        const id = nextBoxId(m, page);
        for (const objs of r.objects.slice(a.length))
          for (const o of objs) setBoxId(m, doc.ptr, o, id);
        return r;
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
