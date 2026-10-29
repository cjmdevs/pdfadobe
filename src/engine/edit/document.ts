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
  type CharRun,
  type CharStyle,
  type EditParagraph,
  type FontChoice,
  type ParagraphStyle,
  type RetypesetDeps,
  type RetypesetResult,
} from "./retypeset";
import { nextBoxId, setBoxId, spacingOf } from "./marks";
import { removeBoxText } from "./split";
import { boxesBelow, groupNow, moveBoxText, pushDown } from "./move";
import { findOverflow } from "./retypeset";
import { HANG, numberLists } from "./lists";
import type { TextBox } from "./group";
import type { Rect } from "./chars";
import { arrange, type Arrange } from "./arrange";
import { isolateBox } from "./split";
import { underlinesOf } from "./retypeset";
import {
  addImage,
  cropImage,
  flipped,
  imageFile,
  setPlacement,
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
  /** The paragraph's own font, or (`name`) another font of the box by its PDF name. */
  | { kind: "original"; name?: string }
  | { kind: "standard"; name: string }
  | { kind: "file"; face: IndexedFace; bytes: Uint8Array };

export type PlainStyle = Omit<ParagraphStyle, "font"> & { font: PlainFont };

/** Character formatting that can cross to the worker. */
export type PlainCharStyle = Omit<CharStyle, "font"> & { font: PlainFont };

/** A paragraph with character runs (offsets into `text`) and its own style changes. */
export interface RichText {
  text: string;
  runs: { start: number; end: number; style: Partial<PlainCharStyle> }[];
  style?: Partial<PlainStyle>;
}

/** Collapses white space like a plain paragraph, keeping the runs on their letters. */
export function normalizeRich(p: string | RichText): RichText {
  const src: RichText = typeof p === "string" ? { text: p, runs: [] } : p;
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < src.text.length; i++) {
    at.push(text.length);
    const c = src.text[i] ?? "";
    if (/\s/.test(c)) {
      if (text && !text.endsWith(" ")) text += " ";
    } else text += c;
  }
  at.push(text.length);
  const trimmed = text.replace(/ $/, "");
  const map = (i: number) => Math.min(at[i] ?? trimmed.length, trimmed.length);
  return {
    ...(src.style ? { style: src.style } : {}),
    text: trimmed,
    runs: src.runs
      .map((r) => ({ ...r, start: map(r.start), end: map(r.end) }))
      .filter((r) => r.end > r.start),
  };
}

/**
 * Lists: each list paragraph gets its generated marker (any old one is taken off its
 * text first) on a hanging indent; a paragraph whose list was taken off loses its
 * marker and starts where the marker was. Run offsets follow the text.
 */
export function applyLists(paras: EditParagraph[]): EditParagraph[] {
  const markers = numberLists(paras.map((p) => p.style.list));
  return paras.map((p, i) => {
    const st = p.style;
    const old = st.marker;
    const want = markers[i] ?? null;
    if (st.list === undefined || (!want && !old)) return p;
    // The old marker off the text (with or without its space).
    const cut = old && p.text.startsWith(old.text) ? old.text.length : 0;
    const body = p.text.slice(cut).replace(/^ /, "");
    const removed = p.text.length - body.length;
    const left = st.indent?.left ?? 0;
    const at = old?.at ?? left;
    if (!want) {
      const { marker: _m, list: _l, ...rest } = st;
      void _m;
      void _l;
      // The marker was in the text: the text moves to where the marker was. Otherwise
      // (an editor sends text without markers) it keeps its indent.
      return {
        text: body,
        style: cut ? { ...rest, indent: { ...st.indent, first: at, left: at } } : rest,
        runs: shift(p.runs, -removed),
      };
    }
    const hang = old ? Math.max(4, (st.indent?.first ?? at + HANG) - at) : HANG;
    // A marker the paragraph already showed keeps its font; a new one in a PDF's own
    // (subset) font is drawn in Helvetica, which every reader has.
    const font: FontChoice | undefined =
      old?.text === want || st.font.kind !== "original"
        ? undefined
        : { kind: "standard", name: st.bold ? "Helvetica-Bold" : "Helvetica" };
    return {
      text: `${want} ${body}`,
      style: {
        ...st,
        marker: { text: want, at, ...(font ? { font } : {}) },
        indent: { ...st.indent, first: at + hang, left: old ? left : at + hang },
      },
      runs: shift(p.runs, want.length + 1 - removed),
    };
  });
}

function shift(runs: CharRun[] | undefined, by: number): CharRun[] {
  return (runs ?? [])
    .map((r) => ({ ...r, start: Math.max(0, r.start + by), end: Math.max(0, r.end + by) }))
    .filter((r) => r.end > r.start);
}

/** A run's plain style as an engine style: `original` fonts by name from the box. */
function runStyle(over: Partial<PlainCharStyle>, box: TextBox | null): Partial<CharStyle> {
  const { font, ...rest } = over;
  if (!font) return rest;
  if (font.kind !== "original") return { ...rest, font };
  const c = font.name ? box?.lines.flatMap((l) => l.chars).find((x) => x.font === font.name) : null;
  return c ? { ...rest, font: { kind: "original", obj: c.obj } } : rest;
}

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
  paragraphs: (string | RichText)[],
  deps: RetypesetDeps,
  styles: (Partial<PlainStyle> | undefined)[] = [],
  /** New box width in points (the right-edge handle): the text wraps at it. */
  width?: number,
  opts: {
    /** New left edge (points): the left handle or the X field. */
    left?: number;
    /** Moves the text up (+) or down (-): the top handle. */
    dy?: number;
    /** Push the boxes below in the same column down when the box grows. */
    push?: boolean;
  } = {},
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
        const rich = paragraphs.map(normalizeRich);
        // Everything deleted: the box's text goes (other text drawn with it stays).
        if (rich.every((t) => !t.text)) {
          removeBoxText(m, doc.ptr, page, box, chars).commit();
          return null;
        }
        const found = detectStyle(m, box, rules);
        const paras = rich
          .map(({ text, runs }, i) => {
            const own = found[Math.min(i, found.length - 1)];
            if (!own) throw new Error("box without paragraphs");
            return {
              text,
              style: merge(own, { ...styles[i], ...rich[i]?.style }, box),
              runs: runs.map((r) => ({
                start: r.start,
                end: r.end,
                style: runStyle(r.style, box),
              })),
            };
          })
          // Empty lines between paragraphs are not kept.
          .filter((p) => p.text);
        const listed = applyLists(paras);
        const boxId = box.id ?? nextBoxId(m, page);
        const r = retypeset(
          m,
          doc.ptr,
          page,
          {
            kind: "box",
            box,
            chars,
            rules,
            others: boxes,
            boxId,
            ...(width === undefined ? {} : { width: Math.max(12, width) }),
            ...(opts.left === undefined ? {} : { left: opts.left }),
            ...(opts.dy === undefined ? {} : { dy: opts.dy }),
          },
          listed,
          deps,
        );
        const grew = box.b - r.bounds.b;
        if (!opts.push || grew <= 0.5) return r;
        // Push the column below down by what the box grew, then look again at what the
        // new text runs into.
        const span = { l: Math.min(box.l, r.bounds.l), r: Math.max(box.r, r.bounds.r), b: box.b };
        const below = boxesBelow(span, boxes, box);
        const off = pushDown(m, doc.ptr, page, below, grew);
        const now = groupNow(m, page);
        return {
          ...r,
          pushed: below.length,
          pushedOff: off,
          overflow: findOverflow(
            r.lines,
            box,
            now.boxes.filter((b) => b.id !== boxId),
            now.rules,
          ),
        };
      },
      true,
    );
    return { bytes: doc.save(), result };
  } finally {
    doc.close();
  }
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

/** Moves a text box by (dx, dy) points as it is (no re-typesetting). One undo step. */
export function moveBox(m: PdfiumModule, bytes: Uint8Array, ref: BoxRef, dx: number, dy: number) {
  const doc = RawDoc.open(m, bytes);
  try {
    doc.withPage(
      ref.page,
      (page) => {
        const g = groupNow(m, page);
        const box = g.boxes[ref.id];
        if (!box || previewOf(box) !== ref.preview) throw new EditRefused(STALE);
        moveBoxText(m, doc.ptr, page, box, g.chars, g.rules, dx, dy);
      },
      true,
    );
    return doc.save();
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
  paragraphs: (string | RichText)[],
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
          const rich = paragraphs[i];
          return merge(st, { ...styles[i], ...(typeof rich === "object" ? rich.style : {}) }, box);
        };
        const src = paragraphs.map((x) => (typeof x === "string" ? { text: x, runs: [] } : x));
        const p = caret.paragraph;
        const cut = src[p] ?? { text: "", runs: [] };
        const o = caret.offset;
        const head: RichText = {
          text: cut.text.slice(0, o),
          runs: cut.runs.map((r) => ({ ...r, end: Math.min(r.end, o) })),
        };
        const tail: RichText = {
          text: cut.text.slice(o),
          runs: cut.runs.map((r) => ({ ...r, start: Math.max(0, r.start - o), end: r.end - o })),
        };
        const part = (x: RichText, i: number) => ({ ...normalizeRich(x), i });
        const a = [...src.slice(0, p).map(part), part(head, p)].filter((x) => x.text);
        const b = [part(tail, p), ...src.slice(p + 1).map((x, k) => part(x, p + 1 + k))].filter(
          (x) => x.text,
        );
        if (!a.length || !b.length)
          throw new EditRefused("Put the caret inside the text, where the new box should start.");
        const engineRuns = (x: RichText) =>
          x.runs.map((r) => ({ start: r.start, end: r.end, style: runStyle(r.style, box) }));
        const paras = applyLists([
          ...a.map((x) => ({ text: x.text, style: own(x.i), runs: engineRuns(x) })),
          ...b.map((x, k) => {
            const st = own(x.i);
            // Mid-paragraph: the second half starts like a continuation line (no marker).
            if (k === 0 && o > 0) {
              const { marker: _marker, list: _list, ...rest } = st;
              void _marker;
              void _list;
              const left = st.indent?.left ?? 0;
              return {
                text: x.text,
                style: { ...rest, indent: { ...st.indent, first: left, left }, spaceBefore: 0 },
                runs: engineRuns(x),
              };
            }
            return { text: x.text, style: st, runs: engineRuns(x) };
          }),
        ]);
        const r = retypeset(
          m,
          doc.ptr,
          page,
          { kind: "box", box, chars: g.chars, rules: g.rules, others: g.boxes },
          paras,
          deps,
        );
        // The second half becomes its own box (its spacing stays on its marks).
        const id = nextBoxId(m, page);
        for (const objs of r.objects.slice(a.length))
          for (const ob of objs) setBoxId(m, doc.ptr, ob, id, spacingOf(m, ob));
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
  paragraphs: (string | RichText)[],
  style: PlainStyle,
  deps: RetypesetDeps,
): EditOutcome {
  const texts = paragraphs.map(normalizeRich).filter((p) => p.text);
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
          applyLists(
            texts.map(({ text, runs, ...rest }) => ({
              text,
              style: { ...style, ...plainOver(rest), font },
              runs: runs.map((r) => ({
                start: r.start,
                end: r.end,
                style: runStyle(r.style, null),
              })),
            })),
          ),
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

function merge(
  own: ParagraphStyle,
  over: Partial<PlainStyle> | undefined,
  box: TextBox | null = null,
): ParagraphStyle {
  if (!over) return own;
  const { font, ...rest } = over;
  const named = font?.kind === "original" ? runStyle({ font }, box).font : undefined;
  return {
    ...own,
    ...rest,
    font: named ?? (!font || font.kind === "original" ? own.font : font),
  };
}

/** A new paragraph's own style changes (its font comes from the box's style). */
function plainOver(rest: { style?: Partial<PlainStyle> }): Omit<Partial<PlainStyle>, "font"> {
  const { font: _f, ...o } = rest.style ?? {};
  void _f;
  return o;
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
  | { kind: "replace"; data: Uint8Array }
  /** Mirror left-right ("h") or top-bottom ("v"). */
  | { kind: "flip"; axis: "h" | "v" }
  /** Keep `part` of the picture (fractions from its bottom-left); the rest is removed. */
  | { kind: "crop"; part: { x0: number; y0: number; x1: number; y1: number } }
  | { kind: "arrange"; how: Arrange };

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
      else if (op.kind === "flip") placeImage(m, page, img.obj, flipped(img.placement, op.axis));
      else if (op.kind === "crop") cropImage(m, page, img.obj, op.part);
      else if (op.kind === "arrange") {
        arrange(m, page, [img.obj], op.how);
        if (!m.FPDFPage_GenerateContent(page))
          throw new Error("PDFium could not regenerate the page");
      } else replaceImage(m, page, img.obj, op.data);
    });
    return doc.save();
  } finally {
    doc.close();
  }
}

/** An image's picture as a file (a JPEG as stored, else a PNG), for another program. */
export function exportImage(m: PdfiumModule, bytes: Uint8Array, ref: ImageRef) {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(ref.page, (page) => {
      const img = findImage(m, page, ref);
      return imageFile(m, img.obj);
    });
  } finally {
    doc.close();
  }
}

function findImage(m: PdfiumModule, page: number, ref: ImageRef) {
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
  return img;
}

/** Moves a text box in the drawing order (its shared text objects are split first). */
export function arrangeBox(m: PdfiumModule, bytes: Uint8Array, ref: BoxRef, how: Arrange) {
  const doc = RawDoc.open(m, bytes);
  try {
    doc.withPage(
      ref.page,
      (page) => {
        const g = groupNow(m, page);
        const box = g.boxes[ref.id];
        if (!box || previewOf(box) !== ref.preview) throw new EditRefused(STALE);
        const { objects, removal } = isolateBox(m, doc.ptr, page, box, g.chars);
        removal.commit();
        const lines = underlinesOf(box, g.rules).flatMap((h) =>
          h.obj === undefined ? [] : [h.obj],
        );
        arrange(m, page, [...objects, ...lines], how);
      },
      true,
    );
    return doc.save();
  } finally {
    doc.close();
  }
}

/** Something on the page that can be aligned. */
export type AlignItem = { kind: "text"; ref: BoxRef } | { kind: "image"; ref: ImageRef };
export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Aligns objects with each other (Acrobat's Align Objects): to the leftmost left edge,
 * the rightmost right edge, the topmost top, the lowest bottom, or the middle of them
 * all. Text moves as it is (no re-typesetting). One undo step.
 */
export function alignObjects(
  m: PdfiumModule,
  bytes: Uint8Array,
  page: number,
  items: AlignItem[],
  how: AlignHow,
): Uint8Array {
  const doc = RawDoc.open(m, bytes);
  try {
    doc.withPage(
      page,
      (p) => {
        const g = groupNow(m, p);
        const found = items.map((it) => {
          if (it.kind === "image") {
            const img = findImage(m, p, it.ref);
            return { kind: "image" as const, rect: img.bounds, img };
          }
          const box = g.boxes[it.ref.id];
          if (!box || previewOf(box) !== it.ref.preview) throw new EditRefused(STALE);
          return { kind: "text" as const, rect: { l: box.l, r: box.r, b: box.b, t: box.t }, box };
        });
        const l = Math.min(...found.map((f) => f.rect.l));
        const r = Math.max(...found.map((f) => f.rect.r));
        const b = Math.min(...found.map((f) => f.rect.b));
        const t = Math.max(...found.map((f) => f.rect.t));
        const shift = (x: Rect) =>
          how === "left"
            ? { dx: l - x.l, dy: 0 }
            : how === "right"
              ? { dx: r - x.r, dy: 0 }
              : how === "center"
                ? { dx: (l + r) / 2 - (x.l + x.r) / 2, dy: 0 }
                : how === "top"
                  ? { dx: 0, dy: t - x.t }
                  : how === "bottom"
                    ? { dx: 0, dy: b - x.b }
                    : { dx: 0, dy: (b + t) / 2 - (x.b + x.t) / 2 };
        // Images first (their handles stay valid); then each text box, found again
        // (moving one can rewrite text objects it shared with another).
        for (const f of found)
          if (f.kind === "image") {
            const { dx, dy } = shift(f.rect);
            const pl = f.img.placement;
            setPlacement(m, f.img.obj, { ...pl, cx: pl.cx + dx, cy: pl.cy + dy });
          }
        for (const f of found) {
          if (f.kind !== "text") continue;
          const { dx, dy } = shift(f.rect);
          if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
          const now = groupNow(m, p);
          const at = now.boxes.find(
            (x) =>
              previewOf(x) === previewOf(f.box) &&
              Math.abs(x.l - f.box.l) < 0.5 &&
              Math.abs(x.t - f.box.t) < 0.5,
          );
          if (at) moveBoxText(m, doc.ptr, p, at, now.chars, now.rules, dx, dy);
        }
      },
      true,
    );
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
