// Calculator tape on the page (Phase 4 stage 3): a strip of tape paper with one line per
// entry (amount right-aligned, then the operation), drawn as a one-page PDF that becomes a
// /Stamp appearance. Totals get a rule above them, like an adding machine. Node-safe.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { StampDrawing } from "../stamps";
import { encodable, hexColor } from "./tickmarks";

export interface TapeRow {
  /** Formatted amount ("1,234.56"). */
  amount: string;
  /** "+", "-", "×", "÷", "=", "T", "S" or "". */
  op: string;
  note?: string;
  /** A total line: rule above, bold. */
  total?: boolean;
}

/** WinAnsi has × and ÷; Courier draws them. */
export async function drawTape(
  rows: TapeRow[],
  paper: string,
  title?: string,
): Promise<StampDrawing> {
  const doc = await PDFDocument.create();
  doc.setProducer("PDF Workbench");
  doc.setCreator("PDF Workbench");
  const mono = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const size = 9;
  const lineH = 12;
  const pad = 8;
  const amountW = Math.max(
    mono.widthOfTextAtSize("0,000,000.00", size),
    ...rows.map((r) => bold.widthOfTextAtSize(encodable(bold, r.amount), size)),
  );
  const opW = mono.widthOfTextAtSize(" T ", size);
  const noteW = Math.max(
    0,
    ...rows.map((r) => (r.note ? mono.widthOfTextAtSize(` ${encodable(mono, r.note)}`, 7) : 0)),
  );
  const head = title ? encodable(bold, title).slice(0, 40) : "";
  const width = Math.ceil(
    Math.max(
      pad * 2 + amountW + opW + noteW,
      head ? bold.widthOfTextAtSize(head, size) + pad * 2 : 0,
    ),
  );
  const height = Math.ceil(pad * 2 + (head ? lineH + 2 : 0) + Math.max(1, rows.length) * lineH + 6);
  const page = doc.addPage([width, height]);
  page.drawRectangle({
    x: 0.5,
    y: 0.5,
    width: width - 1,
    height: height - 1,
    color: hexColor(paper),
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 0.75,
  });
  const ink = rgb(0.1, 0.1, 0.1);
  let y = height - pad - size;
  if (head) {
    page.drawText(head, { x: pad, y, size, font: bold, color: ink });
    y -= lineH + 2;
  }
  for (const r of rows) {
    const font = r.total ? bold : mono;
    const amount = encodable(font, r.amount);
    // Negative amounts print in red, as on an adding machine.
    const color = r.amount.startsWith("-") ? rgb(0.75, 0.1, 0.1) : ink;
    if (r.total)
      page.drawLine({
        start: { x: pad, y: y + size + 1.5 },
        end: { x: pad + amountW, y: y + size + 1.5 },
        thickness: 0.6,
        color: ink,
      });
    page.drawText(amount, {
      x: pad + amountW - font.widthOfTextAtSize(amount, size),
      y,
      size,
      font,
      color,
    });
    if (r.op)
      page.drawText(` ${encodable(font, r.op)}`, { x: pad + amountW, y, size, font, color: ink });
    if (r.note)
      page.drawText(` ${encodable(mono, r.note)}`, {
        x: pad + amountW + opW,
        y: y + 1,
        size: 7,
        font: mono,
        color: rgb(0.35, 0.35, 0.35),
      });
    y -= lineH;
  }
  return { pdf: await doc.save({ useObjectStreams: false }), width, height };
}
