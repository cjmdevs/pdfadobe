// Built-in text stamps (Phase 3): Approved, Reviewed, Draft, Confidential. Each is drawn
// as a one-page PDF that becomes the stamp annotation's appearance stream (PDFium copies
// the page into /AP), so Acrobat shows exactly what we drew. Our own design; nothing
// from Adobe's stamp sets. Node-safe (the MCP server can stamp too).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface TextStampDef {
  id: string;
  title: string;
  /** "#rrggbb" */
  color: string;
}

export const TEXT_STAMPS: readonly TextStampDef[] = [
  { id: "approved", title: "APPROVED", color: "#1E7B34" },
  { id: "reviewed", title: "REVIEWED", color: "#1F4E9C" },
  { id: "draft", title: "DRAFT", color: "#B3261E" },
  { id: "confidential", title: "CONFIDENTIAL", color: "#B3261E" },
];

export interface StampDrawing {
  /** One-page PDF, page size = stamp size. */
  pdf: Uint8Array;
  width: number;
  height: number;
}

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * A stamp: the title in a rounded frame, and `detail` (e.g. "J. Reviewer, 10/23/2026
 * 9:41 AM") in small type under it when given, like Acrobat's dynamic stamps. The text
 * is fixed when the stamp is placed.
 */
export async function drawTextStamp(def: TextStampDef, detail?: string): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const titleSize = 22;
  const detailSize = 8;
  const padX = 12;
  const line = detail ? detail.slice(0, 80) : "";
  const titleW = bold.widthOfTextAtSize(def.title, titleSize);
  const detailW = line ? regular.widthOfTextAtSize(line, detailSize) : 0;
  const width = Math.ceil(Math.max(titleW, detailW) + padX * 2);
  const height = line ? 50 : 36;
  const page = doc.addPage([width, height]);
  const color = hex(def.color);
  const inset = 1.5;
  page.drawRectangle({
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
    borderColor: color,
    borderWidth: 2.5,
    // pdf-lib has no rounded rectangles; a second, inner frame gives the stamp look.
  });
  page.drawRectangle({
    x: inset + 3,
    y: inset + 3,
    width: width - (inset + 3) * 2,
    height: height - (inset + 3) * 2,
    borderColor: color,
    borderWidth: 0.75,
  });
  page.drawText(def.title, {
    x: (width - titleW) / 2,
    y: line ? height - 10 - titleSize * 0.75 : (height - titleSize * 0.7) / 2,
    size: titleSize,
    font: bold,
    color,
  });
  if (line)
    page.drawText(line, {
      x: (width - detailW) / 2,
      y: 9,
      size: detailSize,
      font: regular,
      color,
    });
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}

/** "J. Reviewer, 10/23/2026 9:41 AM" in the user's locale. */
export function stampDetail(author: string, when: Date, locale?: string): string {
  const date = when.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = when.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return `${author}, ${date} ${time}`;
}
