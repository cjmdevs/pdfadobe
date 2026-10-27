// Edit PDF (B3): replace a text box's paragraphs with re-typeset text, or add a new
// text box. One style per paragraph (font, size, colour, bold, italic, underline,
// alignment, line spacing). New text is real text: searchable, selectable, and our
// own grouping finds it again as one box.
//
// Fonts:
//   original  the PDF's own font object (no new font; refused if a letter is missing)
//   standard  one of the standard 14 (not embedded, like most tax software output)
//   file      a font file from the index: fsType checked, subset with HarfBuzz to the
//             letters used, named "ABCDEF+Name", embedded as a CID TrueType font
//
// Every letter is read back after writing (FPDFText_SetText reports success for
// letters a font lacks and writes .notdef boxes). Nothing on the page changes unless
// the whole edit reads back; otherwise EditRefused is thrown with the page restored.

import type { PdfiumModule } from "../pdfium";
import { objBounds, type PageChar, type Rect, type Rules } from "./chars";
import type { IndexedFace } from "./fonts";
import { FaceMetrics, withPostScriptName } from "./fonts/sfnt";
import type { Subsetter } from "./fonts/subset";
import type { Paragraph, TextBox } from "./group";
import { heap } from "../pages/raw";
import { EditRefused } from "./refusal";
import { removeBoxText, type Removal } from "./split";
import { layoutParagraph, type Align, type PlacedLine } from "./typeset";

const FPDF_FONT_TRUETYPE = 2;
const FPDF_TEXTRENDERMODE_FILL_STROKE = 2;
const FPDF_FILLMODE_WINDING = 2;
/** Fake italic: 12 degree slant. */
const OBLIQUE = Math.tan((12 * Math.PI) / 180);
/** Fake bold: outline stroked at this fraction of the size. */
const FAKE_BOLD = 0.03;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type FontChoice =
  /** The PDF's own font: the font of text object `obj` on this page. */
  | { kind: "original"; obj: number }
  /** A standard 14 font by name ("Helvetica-Bold"), not embedded. */
  | { kind: "standard"; name: string }
  /** A face from the font index and its file's bytes. */
  | { kind: "file"; face: IndexedFace; bytes: Uint8Array };

export interface ParagraphStyle {
  font: FontChoice;
  /** Points. */
  size: number;
  color: Rgba;
  /** Bold / italic wanted; drawn fake when the chosen font isn't bold / italic. */
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: Align;
  /** Baseline to baseline, points. */
  leading: number;
}

export interface EditParagraph {
  text: string;
  style: ParagraphStyle;
}

export type EditTarget =
  /** Replace a grouped box (from `groupPage` on this page). */
  | {
      kind: "box";
      box: TextBox;
      chars: PageChar[];
      rules: Rules;
      others: TextBox[];
      /** New width (points from the box's left edge): the text wraps at it. */
      width?: number;
    }
  /** Add a new box: first baseline at (x, y); `width` wraps, null grows. */
  | { kind: "new"; x: number; y: number; width: number | null; others: TextBox[]; rules: Rules };

export interface WrittenFont {
  name: string;
  kind: FontChoice["kind"];
  embedded: "subset" | "whole" | "none" | "unchanged";
}

export interface Overflow {
  /** What the new text runs into. */
  kind: "text" | "rule";
  rect: Rect;
  /** Start of the other box's text (for the warning). */
  text?: string;
}

export interface RetypesetResult {
  /** Where each line landed. */
  lines: Rect[];
  bounds: Rect;
  fonts: WrittenFont[];
  fakeBold: boolean;
  fakeItalic: boolean;
  /** Text or rules the new text runs into (not pushed down: the user resizes). */
  overflow: Overflow[];
}

export interface RetypesetDeps {
  subset: Subsetter;
}

/** Replaces the target's text with `paragraphs` and regenerates the page content. */
export function retypeset(
  m: PdfiumModule,
  doc: number,
  page: number,
  target: EditTarget,
  paragraphs: EditParagraph[],
  deps: RetypesetDeps,
): RetypesetResult {
  if (!paragraphs.length) throw new Error("nothing to write");
  const fonts = new FontLoader(m, doc, page, deps, paragraphs);

  // Layout first (refusals here leave the page untouched).
  const box = target.kind === "box" ? target.box : null;
  const left = box ? (box.lines[0]?.chars[0]?.x ?? box.l) : target.kind === "new" ? target.x : 0;
  const newWidth = target.kind === "box" ? target.width : undefined;
  const right =
    box !== null
      ? newWidth !== undefined
        ? left + newWidth
        : box.r
      : target.kind === "new" && target.width !== null
        ? target.x + target.width
        : left;
  // A box of one-line paragraphs (labels, cells, amounts, address blocks) grows
  // instead of wrapping; new text wraps only when given a width.
  // A width the user set always wraps.
  const wrap = box
    ? newWidth !== undefined || box.paragraphs.some((p) => p.lines.length > 1)
    : target.kind === "new" && target.width !== null;
  let baseline = box ? (box.lines[0]?.y ?? 0) : target.kind === "new" ? target.y : 0;
  const placed: { para: EditParagraph; lines: PlacedLine[]; font: LoadedFont }[] = [];
  for (const para of paragraphs) {
    const font = fonts.get(para.style.font);
    const lines = layoutParagraph(
      para.text,
      { l: left, r: right, wrap },
      para.style.align,
      baseline,
      para.style.leading,
      (s) => font.width(s, para.style.size),
    );
    placed.push({ para, lines, font });
    baseline -= lines.length * para.style.leading;
  }

  const removal: Removal | null =
    box && target.kind === "box" ? removeBoxText(m, doc, page, box, target.chars) : null;
  const created: number[] = [];
  try {
    let fakeBold = false;
    let fakeItalic = false;
    for (const { para, lines, font } of placed) {
      const s = para.style;
      const boldFake = s.bold && !font.bold;
      const italicFake = s.italic && !font.italic;
      fakeBold ||= boldFake;
      fakeItalic ||= italicFake;
      for (const line of lines) {
        for (const run of line.runs) {
          if (!run.text) continue;
          // No space glyph: each word on its own, at the spaced position.
          const pieces = font.noSpace ? run.text.split(" ") : [run.text];
          let x = run.x;
          for (const piece of pieces) {
            if (piece)
              created.push(
                placeText(m, doc, page, font.handle, piece, x, run.y, s, boldFake, italicFake),
              );
            x += font.width(piece, s.size) + font.spaceWidth * s.size;
          }
        }
        if (s.underline && line.text) {
          const pos = font.underline.position * s.size;
          const thick = Math.max(0.5, font.underline.thickness * s.size);
          created.push(
            placeRect(m, page, line.x, line.y + pos - thick / 2, line.width, thick, s.color),
          );
        }
      }
    }
    // Read every letter back before anything is final.
    const want = placed.flatMap((p) => p.lines.flatMap((l) => l.runs.map((r) => r.text))).join("");
    const got = readBack(m, page, created);
    // U+0000 / U+FFFD: a glyph written without a character (a .notdef box).
    if (
      got.includes(String.fromCharCode(0)) ||
      got.includes(String.fromCharCode(0xfffd)) ||
      got.replace(/\s+/g, "") !== want.replace(/\s+/g, "")
    ) {
      const have = new Set([...got]);
      const missing = [...new Set([...want.replace(/\s+/g, "")])].filter((c) => !have.has(c));
      throw new EditRefused(
        `These letters can't be shown in the chosen font: ${missing.join(" ") || "(some letters)"}`,
        missing,
      );
    }
    removal?.commit();
    if (box && target.kind === "box") removeUnderlines(m, page, box, target.rules);
    if (!m.FPDFPage_GenerateContent(page)) throw new Error("PDFium could not regenerate the page");

    const lineRects = placed.flatMap(({ para, lines }) =>
      lines.filter((l) => l.text).map((l) => textRect(l.x, l.y, l.width, para.style.size)),
    );
    const others = target.others.filter((o) => o !== box);
    return {
      lines: lineRects,
      bounds: union(lineRects),
      fonts: fonts.written(),
      fakeBold,
      fakeItalic,
      overflow: findOverflow(lineRects, box, others, target.rules),
    };
  } catch (e) {
    for (const o of created) {
      if (m.FPDFPage_RemoveObject(page, o)) m.FPDFPageObj_Destroy(o);
    }
    removal?.rollback();
    throw e;
  }
}

interface LoadedFont {
  handle: number;
  name: string;
  bold: boolean;
  italic: boolean;
  /** Fractions of the size; position negative below the baseline. */
  underline: { position: number; thickness: number };
  width(text: string, size: number): number;
  /**
   * The font has no space character (PDF subsets keep only the letters used): words
   * are written one per run, spaced by `spaceWidth` (fraction of the size), so no
   * .notdef box is written for a space.
   */
  noSpace: boolean;
  spaceWidth: number;
}

/** Loads each chosen font once per edit, checking permission and letters first. */
class FontLoader {
  private readonly loaded = new Map<string, LoadedFont & { report: WrittenFont }>();

  constructor(
    private readonly m: PdfiumModule,
    private readonly doc: number,
    private readonly page: number,
    private readonly deps: RetypesetDeps,
    private readonly paragraphs: EditParagraph[],
  ) {}

  get(choice: FontChoice): LoadedFont {
    const key = keyOf(choice);
    let f = this.loaded.get(key);
    if (!f) {
      const text = this.paragraphs
        .filter((p) => keyOf(p.style.font) === key)
        .map((p) => p.text)
        .join("");
      f = this.load(choice, text);
      this.loaded.set(key, f);
    }
    return f;
  }

  written(): WrittenFont[] {
    return [...this.loaded.values()].map((f) => f.report);
  }

  private load(choice: FontChoice, text: string): LoadedFont & { report: WrittenFont } {
    const m = this.m;
    if (choice.kind === "file") {
      const face = choice.face;
      if (!face.embedding.allowed)
        throw new EditRefused(face.embedding.note ?? "This font can't be embedded.");
      if (face.cff)
        throw new EditRefused(
          "This font has PostScript outlines, which can't be embedded yet. Choose a TrueType font.",
        );
      const full = new FaceMetrics(choice.bytes, face.index);
      const missing = full.missing(text);
      if (missing.length)
        throw new EditRefused(`${face.fullName} has no ${missing.join(" ")}.`, missing);
      // fsType bit 8 forbids subsetting: then the whole file is embedded.
      const program = face.embedding.subsetAllowed
        ? this.deps.subset(choice.bytes, face.index, text)
        : choice.bytes;
      const name = face.embedding.subsetAllowed
        ? `${subsetTag(program)}+${face.postscript || face.family.replace(/\s+/g, "")}`
        : face.postscript || face.family.replace(/\s+/g, "");
      const named = withPostScriptName(program, name, face.family);
      const handle = withBytes(m, named, (p) =>
        m.FPDFText_LoadFont(this.doc, p, named.byteLength, FPDF_FONT_TRUETYPE, true),
      );
      if (!handle) throw new EditRefused(`PDFium could not load ${face.fullName}.`);
      const metrics = new FaceMetrics(named);
      return {
        handle,
        name,
        bold: face.weight >= 600,
        italic: face.italic,
        underline: {
          position: face.underlinePosition / face.unitsPerEm,
          thickness: face.underlineThickness / face.unitsPerEm,
        },
        width: (s, size) => metrics.width(s, size),
        noSpace: false,
        spaceWidth: metrics.width(" ", 1),
        report: {
          name,
          kind: "file",
          embedded: face.embedding.subsetAllowed ? "subset" : "whole",
        },
      };
    }
    const handle =
      choice.kind === "standard"
        ? m.FPDFText_LoadStandardFont(this.doc, choice.name)
        : m.FPDFTextObj_GetFont(choice.obj);
    if (!handle) throw new EditRefused("The font could not be loaded.");
    const name = baseFontName(m, handle);
    const missing = missingLetters(m, this.doc, this.page, handle, text);
    if (missing.length)
      throw new EditRefused(
        `${name.replace(/^[A-Z]{6}\+/, "")} in this document has no ${missing.join(" ")}. Choose another font.`,
        missing,
      );
    const style = name.replace(/^[A-Z]{6}\+/, "").toLowerCase();
    const measure = pdfiumMeasurer(m, this.doc, handle);
    const letter = text.replace(/\s+/g, "").charAt(0);
    const noSpace =
      /\s/.test(text) && !!letter && !hasSpace(m, this.doc, this.page, handle, letter);
    // Without a space glyph, a word gap of a quarter em (close to most text fonts').
    const spaceWidth = noSpace ? 0.25 : measure(" ", 1);
    return {
      handle,
      name,
      bold: /bold|black|heavy|semibold|demi/.test(style) || m.FPDFFont_GetWeight(handle) >= 600,
      italic: /italic|oblique/.test(style),
      underline: { position: -0.1, thickness: 0.05 },
      noSpace,
      spaceWidth,
      width: noSpace
        ? (s, size) => {
            const words = s.split(" ");
            return (
              words.reduce((a, w) => a + (w ? measure(w, size) : 0), 0) +
              (words.length - 1) * spaceWidth * size
            );
          }
        : measure,
      report: {
        name,
        kind: choice.kind,
        embedded: choice.kind === "standard" ? "none" : "unchanged",
      },
    };
  }
}

function keyOf(f: FontChoice): string {
  return f.kind === "file"
    ? `file:${f.face.path}#${f.face.index}`
    : f.kind === "standard"
      ? `std:${f.name}`
      : `orig:${f.obj}`;
}

/** Six capital letters from the subset's bytes: stable for the same subset. */
function subsetTag(bytes: Uint8Array): string {
  let h = 2166136261;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  let tag = "";
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26);
  }
  return tag;
}

function withBytes<T>(m: PdfiumModule, bytes: Uint8Array, fn: (p: number) => T): T {
  const p = m.pdfium.wasmExports.malloc(bytes.byteLength);
  try {
    heap(m).set(bytes, p);
    return fn(p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function setText(m: PdfiumModule, obj: number, text: string): boolean {
  const bytes = (text.length + 1) * 2;
  const p = m.pdfium.wasmExports.malloc(bytes);
  try {
    m.pdfium.stringToUTF16(text, p, bytes);
    return m.FPDFText_SetText(obj, p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function textOf(m: PdfiumModule, textPage: number, obj: number): string {
  const n = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
  if (n <= 2) return "";
  const p = m.pdfium.wasmExports.malloc(n);
  try {
    m.FPDFTextObj_GetText(obj, textPage, p, n);
    return m.pdfium.UTF16ToString(p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function readBack(m: PdfiumModule, page: number, objs: number[]): string {
  const tp = m.FPDFText_LoadPage(page);
  try {
    return objs.map((o) => (m.FPDFPageObj_GetType(o) === 1 ? textOf(m, tp, o) : "")).join("");
  } finally {
    m.FPDFText_ClosePage(tp);
  }
}

/** Whether a PDF font maps the space character: "a a" written and read back exactly. */
function hasSpace(
  m: PdfiumModule,
  doc: number,
  page: number,
  font: number,
  letter: string,
): boolean {
  return missingLetters(m, doc, page, font, `${letter} ${letter}`, true).length === 0;
}

/** Letters of `text` a PDF font can't show, found by writing each one and reading it back. */
function missingLetters(
  m: PdfiumModule,
  doc: number,
  page: number,
  font: number,
  text: string,
  whole = false,
): string[] {
  const missing: string[] = [];
  // `whole`: the text as one run (to check a space between letters); else letter by letter.
  for (const c of whole ? [text] : new Set([...text])) {
    if (!whole && /\s/.test(c)) continue;
    const obj = m.FPDFPageObj_CreateTextObj(doc, font, 10);
    setText(m, obj, c);
    // Far off the page, so it can't sit on an identical glyph (PDFium would drop it).
    m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, -20000, -20000);
    m.FPDFPage_InsertObject(page, obj);
    const tp = m.FPDFText_LoadPage(page);
    const got = textOf(m, tp, obj);
    m.FPDFText_ClosePage(tp);
    m.FPDFPage_RemoveObject(page, obj);
    m.FPDFPageObj_Destroy(obj);
    if (got !== c) missing.push(c);
  }
  return missing;
}

/**
 * Advance width of a string in a PDF font, measured through PDFium: with the origin at
 * 0, right(s + "x") - right("x") is the advance of s.
 */
function pdfiumMeasurer(
  m: PdfiumModule,
  doc: number,
  font: number,
): (s: string, size: number) => number {
  const right = (s: string) => {
    const obj = m.FPDFPageObj_CreateTextObj(doc, font, 1000);
    setText(m, obj, s);
    const r = objBounds(m, obj)?.r ?? 0;
    m.FPDFPageObj_Destroy(obj);
    return r;
  };
  const ref = "x";
  const base = right(ref);
  const cache = new Map<string, number>();
  return (s, size) => {
    let w = cache.get(s);
    if (w === undefined) {
      w = right(s + ref) - base;
      cache.set(s, w);
    }
    return (w * size) / 1000;
  };
}

function baseFontName(m: PdfiumModule, font: number): string {
  const n = m.FPDFFont_GetBaseFontName(font, 0, 0);
  if (n <= 1) return "";
  const p = m.pdfium.wasmExports.malloc(n);
  try {
    m.FPDFFont_GetBaseFontName(font, p, n);
    return m.pdfium.UTF8ToString(p);
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

function placeText(
  m: PdfiumModule,
  doc: number,
  page: number,
  font: number,
  text: string,
  x: number,
  y: number,
  s: ParagraphStyle,
  fakeBold: boolean,
  fakeItalic: boolean,
): number {
  const obj = m.FPDFPageObj_CreateTextObj(doc, font, s.size);
  if (!obj || !setText(m, obj, text)) {
    if (obj) m.FPDFPageObj_Destroy(obj);
    throw new Error("PDFium could not write the text");
  }
  const { r, g, b, a } = s.color;
  m.FPDFPageObj_SetFillColor(obj, r, g, b, a);
  if (fakeBold) {
    m.FPDFTextObj_SetTextRenderMode(obj, FPDF_TEXTRENDERMODE_FILL_STROKE);
    m.FPDFPageObj_SetStrokeColor(obj, r, g, b, a);
    m.FPDFPageObj_SetStrokeWidth(obj, s.size * FAKE_BOLD);
  }
  m.FPDFPageObj_Transform(obj, 1, 0, fakeItalic ? OBLIQUE : 0, 1, x, y);
  m.FPDFPage_InsertObject(page, obj);
  return obj;
}

function placeRect(
  m: PdfiumModule,
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
  c: Rgba,
): number {
  const obj = m.FPDFPageObj_CreateNewRect(x, y, w, h);
  m.FPDFPageObj_SetFillColor(obj, c.r, c.g, c.b, c.a);
  m.FPDFPath_SetDrawMode(obj, FPDF_FILLMODE_WINDING, false);
  m.FPDFPage_InsertObject(page, obj);
  return obj;
}

/** Underline rules drawn under the box's lines (an earlier underlined edit). */
export function underlinesOf(box: TextBox, rules: Rules): Rules["h"] {
  return rules.h.filter((h) =>
    box.lines.some(
      (l) =>
        h.y < l.y &&
        h.y > l.y - 0.3 * l.size &&
        h.l < l.l + 0.5 * l.size &&
        h.r > l.r - 0.5 * l.size,
    ),
  );
}

function removeUnderlines(m: PdfiumModule, page: number, box: TextBox, rules: Rules): void {
  for (const h of underlinesOf(box, rules)) {
    if (h.obj !== undefined && m.FPDFPage_RemoveObject(page, h.obj)) m.FPDFPageObj_Destroy(h.obj);
  }
}

/** A line's area from its baseline: descender 0.25 em, ascender 0.75 em. */
function textRect(x: number, y: number, w: number, size: number): Rect {
  return { l: x, r: x + w, b: y - 0.25 * size, t: y + 0.75 * size };
}

function union(rects: Rect[]): Rect {
  return {
    l: Math.min(...rects.map((r) => r.l)),
    r: Math.max(...rects.map((r) => r.r)),
    b: Math.min(...rects.map((r) => r.b)),
    t: Math.max(...rects.map((r) => r.t)),
  };
}

const hits = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.b < b.t && a.t > b.b;

/**
 * Other boxes' lines and rules the new lines run into. Rules the original box already
 * crossed (cell borders it sat on, its own underline) don't count. Lines are compared
 * by baseline geometry, not loose boxes, so a tall font's ascent isn't a clash.
 */
export function findOverflow(
  lines: Rect[],
  box: TextBox | null,
  others: TextBox[],
  rules: Rules,
): Overflow[] {
  const out: Overflow[] = [];
  for (const o of others) {
    const rect = o.lines
      .map((l) => textRect(l.l, l.y, l.r - l.l, l.size))
      .find((r) => lines.some((n) => hits(n, r)));
    if (rect) out.push({ kind: "text", rect, text: o.paragraphs[0]?.text.slice(0, 40) ?? "" });
  }
  const before = box ? box.lines.map((l) => textRect(l.l, l.y, l.r - l.l, l.size)) : [];
  const own = box ? new Set(underlinesOf(box, rules)) : new Set<Rules["h"][number]>();
  for (const h of rules.h) {
    if (own.has(h)) continue;
    const rect = { l: h.l, r: h.r, b: h.y - 0.01, t: h.y + 0.01 };
    if (lines.some((n) => hits(n, rect)) && !before.some((n) => hits(n, rect)))
      out.push({ kind: "rule", rect });
  }
  for (const v of rules.v) {
    const rect = { l: v.x - 0.01, r: v.x + 0.01, b: v.b, t: v.t };
    if (lines.some((n) => hits(n, rect)) && !before.some((n) => hits(n, rect)))
      out.push({ kind: "rule", rect });
  }
  return out;
}

/** The paragraph's most common font and size (a bold run-in head is only one word). */
export function mainChar(p: Paragraph): PageChar {
  const chars = p.lines.flatMap((l) => l.chars);
  const counts = new Map<string, { n: number; c: PageChar }>();
  for (const c of chars) {
    const k = `${c.font}|${c.size.toFixed(1)}`;
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { n: 1, c });
  }
  const main = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.c ?? chars[0];
  if (!main) throw new Error("empty paragraph");
  return main;
}

/** Current style of each paragraph in `box`, for the properties panel and edits. */
export function detectStyle(m: PdfiumModule, box: TextBox, rules: Rules): ParagraphStyle[] {
  const underlined = underlinesOf(box, rules);
  return box.paragraphs.map((p) => {
    const main = mainChar(p);
    const style = main.font.replace(/^[A-Z]{6}\+/, "").toLowerCase();
    const color = fillColor(m, main.obj);
    const single = p.lines.length === 1 && box.lines.length === p.lines.length;
    return {
      font: { kind: "original", obj: main.obj },
      size: Math.round(main.size * 100) / 100,
      color,
      bold: /bold|black|heavy|semibold|demi/.test(style),
      italic: /italic|oblique/.test(style),
      underline: p.lines.some((l) => underlined.some((h) => h.y < l.y && h.y > l.y - 0.3 * l.size)),
      // A lone amount is right-aligned (it grows to the left); otherwise as found.
      align:
        single && /^\$?\s?\(?-?\d[\d,]*\.?\d*\)?%?$/.test(p.text)
          ? "right"
          : box.justified
            ? "justify"
            : "left",
      leading: box.leading ?? Math.round(main.size * 1.2 * 100) / 100,
    };
  });
}

function fillColor(m: PdfiumModule, obj: number): Rgba {
  const p = m.pdfium.wasmExports.malloc(16);
  try {
    if (!m.FPDFPageObj_GetFillColor(obj, p, p + 4, p + 8, p + 12))
      return { r: 0, g: 0, b: 0, a: 255 };
    const u = (k: number) => m.pdfium.getValue(p + k * 4, "i32") >>> 0;
    return { r: u(0), g: u(1), b: u(2), a: u(3) };
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}
