// Workpaper tickmarks (Phase 4). Each tickmark is drawn as a one-page PDF that becomes a
// stamp annotation's appearance (like src/engine/stamps.ts), so Acrobat shows exactly
// what we drew. The built-in set is our own drawing from the symbols' names; nothing is
// copied from CCH PDFlyer's stamp files. Node-safe.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { StampDrawing } from "../stamps";

/** Drawn marks (a path, not a font glyph). */
export type TickMark = "check" | "caretUp" | "caretLeft";
export const TICK_MARKS: readonly TickMark[] = ["check", "caretUp", "caretLeft"];

export interface TickmarkImage {
  mime: "image/png" | "image/jpeg";
  /** Base64. */
  data: string;
}

export interface TickmarkDef {
  id: string;
  /** "Agrees to General Ledger". */
  name: string;
  /** What it means on a workpaper (Acrobat shows it as the comment text; legend). */
  meaning: string;
  /** "#rrggbb" */
  color: string;
  /** Height in points. */
  size: number;
  mark?: TickMark;
  /** Letters drawn after the mark ("GL"), or alone ("NR"). */
  text?: string;
  circle?: boolean;
  /** Counts up as it is placed: A, B, C... or 1, 2, 3... (drawn instead of `text`). */
  sequence?: "letters" | "numbers";
  /** An image tickmark (drawn instead of mark and text). */
  image?: TickmarkImage;
}

const RED = "#D0021B";
const t = (
  id: string,
  name: string,
  look: Pick<TickmarkDef, "mark" | "text" | "circle" | "sequence">,
): TickmarkDef => ({ id, name, meaning: name, color: RED, size: 14, ...look });

/** The firm set (owner list, 2026-10-27). Drawn by us; reviewed at the stage 1 check. */
export const BUILT_IN_TICKMARKS: readonly TickmarkDef[] = [
  t("agrees", "Agrees to", { mark: "check" }),
  t("agreesGL", "Agrees to General Ledger", { mark: "check", text: "GL" }),
  t("agreesPY", "Agrees to Prior Year", { mark: "check", text: "PY" }),
  t("calculated", "Calculated", { text: "c", circle: true }),
  t("confirmed", "Confirmed", { text: "C" }),
  t("confirmedEx", "Confirmed with exception", { text: "CX" }),
  t("confirmedExCleared", "Confirmed with exception cleared", { mark: "check", text: "CX" }),
  t("consistent", "Consistent & Comparable with Prior Year", { text: "CC" }),
  t("crossFooted", "Cross-footed", { mark: "caretLeft" }),
  t("footed", "Footed", { mark: "caretUp" }),
  t("immaterial", "Immaterial", { text: "i", circle: true }),
  t("noReply", "No Reply", { text: "NR" }),
  t("recalculated", "Recalculated", { mark: "check", circle: true }),
  t("unreconciled", "Unreconciled Difference", { text: "UD" }),
  t("letters", "Letter (A, B, C...)", { sequence: "letters", circle: true }),
  t("numbers", "Number (1, 2, 3...)", { sequence: "numbers", circle: true }),
];

/** The n-th value of a sequence, from 1: A..Z, AA..; or 1, 2, 3. */
export function sequenceLabel(kind: "letters" | "numbers", n: number): string {
  if (kind === "numbers") return String(n);
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
    s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/** Inverse of sequenceLabel; 0 when `label` is not one. */
export function sequenceNumber(kind: "letters" | "numbers", label: string): number {
  if (kind === "numbers") return /^\d{1,6}$/.test(label) ? Number(label) : 0;
  if (!/^[A-Z]{1,4}$/.test(label)) return 0;
  let n = 0;
  for (const c of label) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

export const hexColor = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Mark paths in a unit box (y down), with their width in units of the height. */
const MARKS: Record<TickMark, { path: string; width: number }> = {
  check: { path: "M 0.05 0.55 L 0.38 0.9 L 0.95 0.08", width: 1 },
  caretUp: { path: "M 0.05 0.9 L 0.4 0.12 L 0.75 0.9", width: 0.8 },
  caretLeft: { path: "M 0.75 0.1 L 0.1 0.5 L 0.75 0.9", width: 0.8 },
};

const scalePath = (path: string, k: number) =>
  path.replace(/-?\d+(\.\d+)?/g, (v) => String(Math.round(Number(v) * k * 100) / 100));

/** Text the standard fonts can draw (WinAnsi); anything else becomes "?". */
export function encodable(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return Array.from(s, (c) => (ok.has(c.codePointAt(0) ?? 0) ? c : "?")).join("");
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Draws `def` into `page` with its bottom-left at (x, y); returns nothing. */
async function drawInto(
  doc: PDFDocument,
  page: PDFPage,
  def: TickmarkDef,
  label: string | undefined,
  box: { x: number; y: number; width: number; height: number },
  font: PDFFont,
) {
  const color = hexColor(def.color);
  const h = def.size;
  const line = Math.max(1, h / 9);
  const pad = line;
  if (def.image) {
    const bytes = fromBase64(def.image.data);
    const img =
      def.image.mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    page.drawImage(img, box);
    return;
  }
  const text = encodable(font, def.sequence ? (label ?? "?") : (def.text ?? ""));
  const mark = def.mark ? MARKS[def.mark] : null;
  const fontSize = h * 0.85;
  const textW = text ? font.widthOfTextAtSize(text, fontSize) : 0;
  const markW = mark ? mark.width * h : 0;
  const gap = mark && text ? h * 0.1 : 0;
  const contentW = markW + gap + textW;
  let x = box.x + (box.width - contentW) / 2;
  const top = box.y + box.height - (box.height - h) / 2;
  if (mark) {
    page.drawSvgPath(scalePath(mark.path, h), {
      x,
      y: top,
      borderColor: color,
      borderWidth: line * 1.2,
    });
    x += markW + gap;
  }
  if (text)
    page.drawText(text, {
      x,
      y: top - h + (h - font.heightAtSize(fontSize, { descender: false })) / 2,
      size: fontSize,
      font,
      color,
    });
  if (def.circle)
    page.drawEllipse({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      xScale: box.width / 2 - pad / 2,
      yScale: box.height / 2 - pad / 2,
      borderColor: color,
      borderWidth: line,
    });
}

/** Outer size of a tickmark (points), the drawing included. */
async function measure(def: TickmarkDef, label: string | undefined, font: PDFFont) {
  const h = def.size;
  const pad = Math.max(1, h / 9) * 1.5;
  if (def.image) {
    const doc = await PDFDocument.create();
    const bytes = fromBase64(def.image.data);
    const img =
      def.image.mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    return { width: Math.max(4, (img.width / img.height) * h), height: h };
  }
  const text = encodable(font, def.sequence ? (label ?? "?") : (def.text ?? ""));
  const markW = def.mark ? MARKS[def.mark].width * h : 0;
  const textW = text ? font.widthOfTextAtSize(text, h * 0.85) : 0;
  const gap = def.mark && text ? h * 0.1 : 0;
  let width = markW + gap + textW + pad * 2;
  let height = h + pad * 2;
  if (def.circle) {
    // The ellipse goes around the content with room at the corners.
    width = Math.max(width * 1.25, height * 1.25);
    height = height * 1.25;
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/** One tickmark as a one-page PDF (page size = tickmark size). */
export async function drawTickmark(def: TickmarkDef, label?: string): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = await measure(def, label, font);
  const page = doc.addPage([width, height]);
  await drawInto(doc, page, def, label, { x: 0, y: 0, width, height }, font);
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}

export interface LegendEntry {
  def: TickmarkDef;
  /** Sequences: the legend shows their first value. */
  label?: string;
  meaning: string;
}

/** A "Tickmark legend" box: each symbol and its meaning, one per row. */
export async function drawLegend(entries: LegendEntry[]): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const size = 9;
  const row = 16;
  const symW = 34;
  const pad = 8;
  const title = "Tickmark legend";
  const lines = entries.map((e) => encodable(regular, e.meaning).slice(0, 90));
  const textW = Math.max(
    bold.widthOfTextAtSize(title, 10),
    ...lines.map((l) => regular.widthOfTextAtSize(l, size)),
  );
  const width = Math.ceil(pad * 2 + symW + textW);
  const height = Math.ceil(pad * 2 + 16 + entries.length * row);
  const page = doc.addPage([width, height]);
  page.drawRectangle({
    x: 0.5,
    y: 0.5,
    width: width - 1,
    height: height - 1,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });
  page.drawText(title, { x: pad, y: height - pad - 9, size: 10, font: bold, color: rgb(0, 0, 0) });
  for (const [i, e] of entries.entries()) {
    const y = height - pad - 16 - (i + 1) * row + 3;
    const art = await drawTickmark({ ...e.def, size: 10 }, e.label);
    const [emb] = await doc.embedPdf(art.pdf);
    if (emb) {
      const k = Math.min(1, (row - 2) / art.height, (symW - 6) / art.width);
      page.drawPage(emb, { x: pad, y, width: art.width * k, height: art.height * k });
    }
    page.drawText(lines[i] ?? "", { x: pad + symW, y: y + 3, size, font: regular });
  }
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}
