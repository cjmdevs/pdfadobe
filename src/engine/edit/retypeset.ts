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
import { lookOf, nextBoxId, setBoxId, type Look, type Spacing } from "./marks";
import { kernCache, standardKerner, type Kerner } from "./fonts/kern";
import { listOf, type ListStyle } from "./lists";
import { removeBoxText, type Removal } from "./split";
import {
  layoutRuns,
  type Align,
  type Fragment,
  type PieceMeasure,
  type PlacedLine,
} from "./typeset";

const FPDF_FONT_TRUETYPE = 2;
const FPDF_PAGEOBJ_TEXT = 1;
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

/** Character formatting: a whole paragraph's, or a run's inside it. */
export interface CharStyle {
  font: FontChoice;
  /** Points. */
  size: number;
  color: Rgba;
  /** Bold / italic wanted; drawn fake when the chosen font isn't bold / italic. */
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Superscript or subscript: smaller and raised or lowered. */
  script?: "super" | "sub";
  /** Horizontal scaling, percent (100: none). */
  hScale?: number;
  /** Extra space after every character / every word space, thousandths of an em. */
  charSpacing?: number;
  wordSpacing?: number;
  /** Pair kerning from the font (fonts from files and the standard 14). */
  kerning?: boolean;
}

export interface ParagraphStyle extends CharStyle {
  align: Align;
  /** Baseline to baseline, points. */
  leading: number;
  /**
   * Where the text starts, in points from the box's left edge: `first` for the first
   * line (after a list marker), `left` for the others. Absent: both 0.
   */
  indent?: { first: number; left: number; right?: number };
  /**
   * A list marker ("•", "1.") drawn `at` points from the box's left edge, in the
   * paragraph's font unless `font` is given (a new marker the PDF's own subset lacks).
   */
  marker?: { text: string; at: number; font?: FontChoice };
  /**
   * The paragraph's list: its marker is generated (numbers count up) and the text hangs
   * after it. Null takes a list off; absent keeps what the page has.
   */
  list?: ListStyle | null;
  /** Extra space above the paragraph (not the first), points. */
  spaceBefore?: number;
  /** Extra space below the paragraph (before the next one), points. */
  spaceAfter?: number;
}

/** Character formatting over `text.slice(start, end)`; the rest is the paragraph's. */
export interface CharRun {
  start: number;
  end: number;
  style: Partial<CharStyle>;
}

export interface EditParagraph {
  text: string;
  style: ParagraphStyle;
  runs?: CharRun[];
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
      /** Box id to mark the text with (default: the box's own, else a new one). */
      boxId?: number;
      /** New left edge (points, like `TextBox.l`); default the box's own. */
      left?: number;
      /** Moves the text up (+) or down (-) by this many points (the top handle). */
      dy?: number;
    }
  /** Add a new box: first baseline at (x, y); `width` wraps, null grows. */
  | {
      kind: "new";
      x: number;
      y: number;
      width: number | null;
      others: TextBox[];
      rules: Rules;
      boxId?: number;
    };

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
  /** Boxes pushed down below the edited one (`push`), and how many went off the page. */
  pushed?: number;
  pushedOff?: number;
  /** Some text needs the content-stream pass for its spacing (`spacing.ts`). */
  spaced?: boolean;
  /** Text objects written for each paragraph (PDFium handles, valid while the page is loaded). */
  objects: number[][];
}

export interface RetypesetDeps {
  subset: Subsetter;
  /** Pair kerning for fonts from files (HarfBuzz); without it they are not kerned. */
  kerner?: Kerner;
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

  // Character styles: every run of every paragraph, resolved against its paragraph.
  const pieces: CharStyle[] = [];
  const pieceKey = new Map<string, number>();
  const pieceOf = (s: CharStyle): number => {
    const k = JSON.stringify({ ...s, font: keyOf(s.font) });
    let i = pieceKey.get(k);
    if (i === undefined) {
      i = pieces.push(s) - 1;
      pieceKey.set(k, i);
    }
    return i;
  };
  const fragsOf = paragraphs.map((para) => fragments(para, pieceOf));
  // A list marker the text still starts with is drawn on its own at its place, in the
  // paragraph's style; the text after it starts at the indent.
  const markers = paragraphs.map((para) =>
    para.style.marker && para.text.startsWith(para.style.marker.text + " ")
      ? {
          ...para.style.marker,
          piece: pieceOf(markerStyle(para.style)),
        }
      : null,
  );
  const fonts = new FontLoader(m, doc, page, deps);
  for (const [i, frags] of fragsOf.entries()) {
    const mk = markers[i];
    for (const f of mk ? [{ text: mk.text, piece: mk.piece }, ...frags] : frags) {
      const st = pieces[f.piece];
      if (st) fonts.need(st.font, f.text);
    }
  }
  const measures = pieces.map((st) => pieceMeasure(fonts.get(st.font), st));
  const measure: PieceMeasure = (p, s) => measures[p]?.(s) ?? 0;

  // Layout first (refusals here leave the page untouched).
  const box = target.kind === "box" ? target.box : null;
  // The box's left edge, at glyph origins (a loose box can start a hair before one).
  const first = box?.lines[0];
  const left = box
    ? (target.kind === "box" && target.left !== undefined ? target.left : box.l) +
      ((first?.chars[0]?.x ?? box.l) - (first?.l ?? box.l))
    : target.kind === "new"
      ? target.x
      : 0;
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
  let baseline = box
    ? (box.lines[0]?.y ?? 0) + (target.kind === "box" ? (target.dy ?? 0) : 0)
    : target.kind === "new"
      ? target.y
      : 0;
  const placed: { para: EditParagraph; lines: PlacedLine[] }[] = [];
  paragraphs.forEach((para, i) => {
    const st = para.style;
    if (i) baseline -= (st.spaceBefore ?? 0) + (paragraphs[i - 1]?.style.spaceAfter ?? 0);
    const marker = markers[i] ?? null;
    const firstX = left + (st.marker && !marker ? st.marker.at : (st.indent?.first ?? 0));
    const lines = layoutRuns(
      fragsOf[i] ?? [],
      {
        l: left + (st.indent?.left ?? 0),
        // A right indent only narrows wrapped text (a growing line has no right edge).
        r: wrap ? right - (st.indent?.right ?? 0) : right,
        first: firstX,
        wrap,
      },
      st.align,
      baseline,
      st.leading,
      measure,
    );
    const top = lines[0];
    if (marker && top)
      top.runs.unshift({ text: marker.text, x: left + marker.at, y: top.y, piece: marker.piece });
    placed.push({ para, lines });
    baseline -= lines.length * st.leading;
  });

  const removal: Removal | null =
    box && target.kind === "box" ? removeBoxText(m, doc, page, box, target.chars) : null;
  const created: number[] = [];
  /** Spacing each text object still needs from the content-stream pass (`spacing.ts`). */
  const spacing = new Map<number, Spacing>();
  /** Each object's spacing settings, for its mark (`Look`). */
  const looks = new Map<number, Look>();
  try {
    let fakeBold = false;
    let fakeItalic = false;
    const perParagraph: number[][] = [];
    for (const { lines } of placed) {
      const from = created.length;
      for (const line of lines) {
        for (const run of line.runs) {
          const s = pieces[run.piece];
          if (!s || !run.text) continue;
          const font = fonts.get(s.font);
          const boldFake = s.bold && !font.bold;
          const italicFake = s.italic && !font.italic;
          fakeBold ||= boldFake;
          fakeItalic ||= italicFake;
          const size = scriptSize(s);
          const y = run.y + scriptRise(s);
          // No space glyph: each word on its own, at the spaced position.
          const parts = font.noSpace ? run.text.split(" ") : [run.text];
          let x = run.x;
          for (const part of parts) {
            if (part) {
              const obj = placeText(
                m,
                doc,
                page,
                font.handle,
                part,
                x,
                y,
                s,
                size,
                boldFake,
                italicFake,
              );
              created.push(obj);
              const sp = spacingOf(font, s, part);
              if (sp) spacing.set(obj, sp);
              looks.set(obj, {
                ...(s.charSpacing ? { charSpacing: s.charSpacing } : {}),
                ...(s.wordSpacing ? { wordSpacing: s.wordSpacing } : {}),
                ...(s.hScale !== undefined && s.hScale !== 100 ? { hScale: s.hScale } : {}),
                ...(s.kerning ? { kerning: true } : {}),
              });
            }
            x += measure(run.piece, part) + measure(run.piece, " ");
          }
          if (s.underline && run.text.trim()) {
            const pos = font.underline.position * size;
            const thick = Math.max(0.5, font.underline.thickness * size);
            const w = measure(run.piece, run.text.trimEnd());
            created.push(placeRect(m, page, run.x, y + pos - thick / 2, w, thick, s.color));
          }
        }
      }
      perParagraph.push(
        created.slice(from).filter((o) => m.FPDFPageObj_GetType(o) === FPDF_PAGEOBJ_TEXT),
      );
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
    // The written text is one box from now on (`marks.ts`), keeping the box's id.
    const id = target.boxId ?? box?.id ?? nextBoxId(m, page);
    for (const o of created)
      if (m.FPDFPageObj_GetType(o) === FPDF_PAGEOBJ_TEXT)
        setBoxId(m, doc, o, id, spacing.get(o), looks.get(o) ?? {});
    if (!m.FPDFPage_GenerateContent(page)) throw new Error("PDFium could not regenerate the page");

    // Each line as tall as its largest text (a bigger run-in head, say).
    const lineRects = placed.flatMap(({ para, lines }) =>
      lines
        .filter((l) => l.text)
        .map((l) =>
          textRect(
            l.x,
            l.y,
            l.width,
            Math.max(para.style.size, ...l.runs.map((r) => pieces[r.piece]?.size ?? 0)),
          ),
        ),
    );
    const others = target.others.filter((o) => o !== box);
    return {
      lines: lineRects,
      bounds: union(lineRects),
      fonts: fonts.written(),
      fakeBold,
      fakeItalic,
      objects: perParagraph,
      spaced: spacing.size > 0,
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

/** A list marker's style: the paragraph's (or its own font), never raised, spaced or kerned. */
function markerStyle(s: ParagraphStyle): CharStyle {
  const { font, size, color, bold, italic, underline } = s;
  return {
    font: s.marker?.font ?? font,
    size,
    color,
    bold,
    italic,
    underline,
    ...(s.hScale !== undefined ? { hScale: s.hScale } : {}),
  };
}

/** The character part of a paragraph style. */
function charStyleOf(s: ParagraphStyle): CharStyle {
  const out: CharStyle = {
    font: s.font,
    size: s.size,
    color: s.color,
    bold: s.bold,
    italic: s.italic,
    underline: s.underline,
  };
  for (const k of ["script", "hScale", "charSpacing", "wordSpacing", "kerning"] as const)
    if (s[k] !== undefined) Object.assign(out, { [k]: s[k] });
  return out;
}

/** The paragraph's text as fragments in their pieces (after its list marker, if any). */
function fragments(para: EditParagraph, pieceOf: (s: CharStyle) => number): Fragment[] {
  const base = charStyleOf(para.style);
  const mk = para.style.marker;
  const skip = mk && para.text.startsWith(mk.text + " ") ? mk.text.length + 1 : 0;
  const text = para.text;
  // Cut points: every run edge; each stretch takes the last run covering it.
  const runs = (para.runs ?? []).filter((r) => r.end > r.start);
  const cuts = [...new Set([skip, text.length, ...runs.flatMap((r) => [r.start, r.end])])]
    .filter((c) => c >= skip && c <= text.length)
    .sort((a, b) => a - b);
  const out: Fragment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i] ?? 0;
    const b = cuts[i + 1] ?? 0;
    const over = runs.filter((r) => r.start <= a && r.end >= b);
    const style = over.reduce<CharStyle>((s, r) => ({ ...s, ...r.style }), base);
    const piece = pieceOf(style);
    const prev = out.at(-1);
    if (prev && prev.piece === piece) prev.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), piece });
  }
  return out;
}

/** Superscript / subscript: smaller, raised or lowered (fractions of the size). */
const SCRIPT_SIZE = 0.6;
const RISE = { super: 0.35, sub: -0.12 };
const scriptSize = (s: CharStyle) => (s.script ? s.size * SCRIPT_SIZE : s.size);
const scriptRise = (s: CharStyle) => (s.script ? RISE[s.script] * s.size : 0);

/**
 * Width of `text` in a piece: glyph advances, pair kerning, character and word
 * spacing (thousandths of an em), all times the horizontal scale.
 */
function pieceMeasure(font: LoadedFont, s: CharStyle): (text: string) => number {
  const size = scriptSize(s);
  const h = (s.hScale ?? 100) / 100;
  const cs = ((s.charSpacing ?? 0) / 1000) * size;
  const ws = ((s.wordSpacing ?? 0) / 1000) * size;
  return (text) => {
    if (!text) return 0;
    const n = [...text].length;
    const spaces = text.split(" ").length - 1;
    const kern = s.kerning && font.kern ? font.kern(text).reduce((a, k) => a + k, 0) * size : 0;
    return (font.width(text, size) + kern + cs * n + ws * spaces) * h;
  };
}

/** What the content-stream pass must add to one written text object, or null. */
function spacingOf(font: LoadedFont, s: CharStyle, text: string): Spacing | null {
  const size = scriptSize(s);
  const chars = [...text];
  const adj = new Map<number, number>();
  // TJ numbers are thousandths of an em, subtracted from the position.
  if (s.kerning && font.kern)
    font.kern(text).forEach((k, i) => {
      if (k) adj.set(i, (adj.get(i) ?? 0) - k * 1000);
    });
  if (s.wordSpacing)
    chars.forEach((c, i) => {
      if (c === " " && i < chars.length - 1) adj.set(i, (adj.get(i) ?? 0) - (s.wordSpacing ?? 0));
    });
  const tc = ((s.charSpacing ?? 0) / 1000) * size;
  const kept = [...adj].filter(([, v]) => Math.abs(v) >= 0.5);
  if (!tc && !kept.length) return null;
  return { tc, n: chars.length, adjust: kept.map(([i, v]) => [i, Math.round(v * 10) / 10]) };
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
  /** Pair kerning after each letter of `text`, fractions of the size (none: not kerned). */
  kern?: (text: string) => number[];
}

/** Loads each chosen font once per edit, checking permission and letters first. */
class FontLoader {
  private readonly loaded = new Map<string, LoadedFont & { report: WrittenFont }>();
  private readonly texts = new Map<string, string>();

  constructor(
    private readonly m: PdfiumModule,
    private readonly doc: number,
    private readonly page: number,
    private readonly deps: RetypesetDeps,
  ) {}

  /** Text the font must show (its letters are checked, and a subset keeps them). */
  need(choice: FontChoice, text: string): void {
    const key = keyOf(choice);
    this.texts.set(key, (this.texts.get(key) ?? "") + text);
  }

  get(choice: FontChoice): LoadedFont {
    const key = keyOf(choice);
    let f = this.loaded.get(key);
    if (!f) {
      f = this.load(choice, this.texts.get(key) ?? "");
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
        ...(this.deps.kerner
          ? { kern: kernCache(this.deps.kerner(choice.bytes, face.index)) }
          : {}),
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
      // The standard 14 kern from their AFM data; the PDF's own fonts carry none.
      ...(choice.kind === "standard" ? { kern: kernCache(standardKerner(choice.name)) } : {}),
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
  s: CharStyle,
  size: number,
  fakeBold: boolean,
  fakeItalic: boolean,
): number {
  const obj = m.FPDFPageObj_CreateTextObj(doc, font, size);
  if (!obj || !setText(m, obj, text)) {
    if (obj) m.FPDFPageObj_Destroy(obj);
    throw new Error("PDFium could not write the text");
  }
  const { r, g, b, a } = s.color;
  m.FPDFPageObj_SetFillColor(obj, r, g, b, a);
  if (fakeBold) {
    m.FPDFTextObj_SetTextRenderMode(obj, FPDF_TEXTRENDERMODE_FILL_STROKE);
    m.FPDFPageObj_SetStrokeColor(obj, r, g, b, a);
    m.FPDFPageObj_SetStrokeWidth(obj, size * FAKE_BOLD);
  }
  // Horizontal scaling lives in the text matrix (PDFium keeps it through later edits).
  const h = (s.hScale ?? 100) / 100;
  m.FPDFPageObj_Transform(obj, h, 0, fakeItalic ? OBLIQUE : 0, 1, x, y);
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

/** Underline rules drawn under the box's lines (an earlier underlined edit; a list marker isn't underlined). */
export function underlinesOf(box: TextBox, rules: Rules): Rules["h"] {
  return rules.h.filter((h) =>
    box.lines.some(
      (l) =>
        h.y < l.y &&
        h.y > l.y - 0.3 * l.size &&
        h.l < l.textL + 0.5 * l.size &&
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
  const left = box.l;
  const round = (v: number) => Math.round(v * 100) / 100;
  return box.paragraphs.map((p, i) => {
    const main = mainChar(p);
    const style = main.font.replace(/^[A-Z]{6}\+/, "").toLowerCase();
    const color = fillColor(m, main.obj);
    const single = p.lines.length === 1 && box.lines.length === p.lines.length;
    return {
      font: { kind: "original", obj: main.obj },
      size: Math.round(main.size * 100) / 100,
      color,
      bold:
        /bold|black|heavy|semibold|demi/.test(style) ||
        m.FPDFTextObj_GetTextRenderMode(main.obj) === FPDF_TEXTRENDERMODE_FILL_STROKE,
      italic: /italic|oblique/.test(style),
      // Spacing settings our own edits wrote (PDFium can't read them from the text).
      ...lookOf(m, main.obj),
      underline: p.lines.some((l) => underlined.some((h) => h.y < l.y && h.y > l.y - 0.3 * l.size)),
      // A lone amount is right-aligned (it grows to the left); otherwise as found.
      align:
        single && /^\$?\s?\(?-?\d[\d,]*\.?\d*\)?%?$/.test(p.text)
          ? "right"
          : box.align !== "left"
            ? box.align
            : box.justified
              ? "justify"
              : "left",
      leading: box.leading ?? Math.round(main.size * 1.2 * 100) / 100,
      // Centred / right-aligned lines have no indent: each line sits on the shared edge.
      ...(box.align === "left"
        ? { indent: { first: round(p.firstL - left), left: round(p.bodyL - left) } }
        : {}),
      ...(p.marker
        ? {
            marker: { text: p.marker, at: round((p.lines[0]?.l ?? left) - left) },
            list: listOf(p.marker),
          }
        : {}),
      ...(i && p.spaceBefore ? { spaceBefore: p.spaceBefore } : {}),
    };
  });
}

/** A run of characters that differs from its paragraph's main style (plain data). */
export interface DetectedRun {
  start: number;
  end: number;
  /** Base font name as written in the PDF. */
  fontName: string;
  size: number;
  color: Rgba;
  bold: boolean;
  italic: boolean;
  script?: "super" | "sub";
}

/**
 * Each paragraph's character runs that differ from its main style (a bold run-in head,
 * a red word, a superscript), as offsets into the paragraph's text.
 */
export function detectRuns(m: PdfiumModule, box: TextBox): DetectedRun[][] {
  const colors = new Map<number, Rgba>();
  const stroked = new Map<number, boolean>();
  /** Simulated bold: filled and stroked (how an edit draws bold without a bold face). */
  const fakeBold = (obj: number) => {
    let b = stroked.get(obj);
    if (b === undefined) {
      b = m.FPDFTextObj_GetTextRenderMode(obj) === FPDF_TEXTRENDERMODE_FILL_STROKE;
      stroked.set(obj, b);
    }
    return b;
  };
  const colorOf = (obj: number) => {
    let c = colors.get(obj);
    if (!c) {
      c = fillColor(m, obj);
      colors.set(obj, c);
    }
    return c;
  };
  return box.paragraphs.map((p) => {
    const main = mainChar(p);
    const mainColor = colorOf(main.obj);
    // Each letter's offset in the paragraph text (lines joined by one space).
    const at: { i: number; c: PageChar; line: number }[] = [];
    let base = 0;
    p.lines.forEach((line, li) => {
      let k = 0;
      for (let i = 0; i < line.text.length && k < line.chars.length; i++) {
        const c = line.chars[k];
        if (!c || line.text[i] === " ") continue;
        at.push({ i: base + i, c, line: li });
        i += c.ch.length - 1;
        k++;
      }
      base += line.text.length + 1;
    });
    const runs: DetectedRun[] = [];
    for (const { i, c, line } of at) {
      const y = p.lines[line]?.y ?? c.y;
      const lineSize = p.lines[line]?.size ?? main.size;
      const script =
        c.size < 0.8 * lineSize && Math.abs(c.y - y) > 0.1 * lineSize
          ? c.y > y
            ? ("super" as const)
            : ("sub" as const)
          : undefined;
      const color = colorOf(c.obj);
      const style = c.font.replace(/^[A-Z]{6}\+/, "").toLowerCase();
      const run: DetectedRun = {
        start: i,
        end: i + c.ch.length,
        fontName: c.font,
        // A script's size is shown as its line's (the engine makes it smaller again).
        size: Math.round((script ? lineSize : c.size) * 100) / 100,
        color,
        bold: /bold|black|heavy|semibold|demi/.test(style) || fakeBold(c.obj),
        italic: /italic|oblique/.test(style),
        ...(script ? { script } : {}),
      };
      const last = runs.at(-1);
      const same =
        last &&
        last.fontName === run.fontName &&
        last.bold === run.bold &&
        Math.abs(last.size - run.size) < 0.05 &&
        last.script === run.script &&
        last.color.r === color.r &&
        last.color.g === color.g &&
        last.color.b === color.b;
      // Spaces between letters of one run belong to it.
      if (same) last.end = run.end;
      else runs.push(run);
    }
    const mainBold =
      fakeBold(main.obj) || /bold|black|heavy|semibold|demi/.test(main.font.toLowerCase());
    const plain = (r: DetectedRun) =>
      r.fontName === main.font &&
      r.bold === mainBold &&
      Math.abs(r.size - Math.round(main.size * 100) / 100) < 0.05 &&
      !r.script &&
      r.color.r === mainColor.r &&
      r.color.g === mainColor.g &&
      r.color.b === mainColor.b;
    return runs.some((r) => !plain(r)) ? runs.filter((r) => !plain(r)) : [];
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
