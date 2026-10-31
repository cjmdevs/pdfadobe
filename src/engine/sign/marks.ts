// Fill & Sign marks (Phase 8): check, cross, dot, a date, and a saved signature image
// (optionally with the date under it). Each is drawn as a one-page PDF that becomes a
// stamp annotation's appearance, like the built-in stamps (src/engine/stamps.ts), so
// Acrobat shows exactly what was drawn. Node-safe.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { StampDrawing } from "../stamps";

export type FillMark = "check" | "cross" | "dot";

const INK = rgb(0, 0, 0);

async function blank(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  return doc;
}

/** A check mark, cross or dot about `size` points across. */
export async function drawFillMark(kind: FillMark, size = 14): Promise<StampDrawing> {
  const doc = await blank();
  const page = doc.addPage([size, size]);
  const w = size * 0.12;
  if (kind === "check") {
    page.drawSvgPath(
      `M ${size * 0.12} ${size * 0.55} L ${size * 0.4} ${size * 0.85} L ${size * 0.9} ${size * 0.15}`,
      {
        x: 0,
        y: size,
        borderColor: INK,
        borderWidth: w,
      },
    );
  } else if (kind === "cross") {
    const a = size * 0.15;
    const b = size * 0.85;
    page.drawLine({ start: { x: a, y: a }, end: { x: b, y: b }, thickness: w, color: INK });
    page.drawLine({ start: { x: a, y: b }, end: { x: b, y: a }, thickness: w, color: INK });
  } else {
    page.drawCircle({ x: size / 2, y: size / 2, size: size * 0.22, color: INK });
  }
  return { pdf: await doc.save({ useObjectStreams: false }), width: size, height: size };
}

/** One line of text (a date) in Helvetica. */
export async function drawTextMark(text: string, size = 11): Promise<StampDrawing> {
  const doc = await blank();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const safe = encodable(font.getCharacterSet(), text);
  const width = Math.ceil(font.widthOfTextAtSize(safe, size) + 4);
  const height = Math.ceil(size * 1.3);
  const page = doc.addPage([width, height]);
  page.drawText(safe, { x: 2, y: size * 0.3, size, font, color: INK });
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}

/**
 * A saved signature (PNG) at `width` x `height` points, with `dateText` in small type
 * under it when given.
 */
export async function drawSignatureMark(
  png: Uint8Array,
  width: number,
  height: number,
  dateText?: string,
): Promise<StampDrawing> {
  const doc = await blank();
  const img = await doc.embedPng(png);
  const dateSize = Math.max(7, Math.min(10, height * 0.18));
  const extra = dateText ? Math.ceil(dateSize * 1.5) : 0;
  const font = dateText ? await doc.embedFont(StandardFonts.Helvetica) : null;
  const line = font && dateText ? encodable(font.getCharacterSet(), dateText) : "";
  const textW = font && line ? font.widthOfTextAtSize(line, dateSize) : 0;
  const pageW = Math.ceil(Math.max(width, textW + 2));
  const page = doc.addPage([pageW, height + extra]);
  page.drawImage(img, { x: (pageW - width) / 2, y: extra, width, height });
  if (font && line)
    page.drawText(line, { x: 1, y: dateSize * 0.35, size: dateSize, font, color: INK });
  return { pdf: await doc.save({ useObjectStreams: false }), width: pageW, height: height + extra };
}

function encodable(ok: number[], s: string): string {
  const set = new Set(ok);
  return Array.from(s, (c) => (set.has(c.codePointAt(0) ?? 0) ? c : "?")).join("");
}

/** "10/31/2026": the date Fill & Sign writes (the user's locale). */
export function fillDate(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}
