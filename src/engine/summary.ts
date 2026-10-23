// Comment summary (Phase 3): a printable PDF with, for each page that has comments, a
// small picture of the page (vector, markup drawn in, numbered markers) and its numbered
// comments below it: type, author, date, status, text and replies. Node-safe.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PdfAnnotationObject } from "@embedpdf/models";
import type { Engine } from "./pdfium";
import { flattenMarkup } from "./flatten";
import { buildThreads, typeLabel, type CommentThread } from "../markup/comments";

export interface SummaryOptions {
  fileName: string;
  /** Dates as the user reads them (the app passes the locale's format). */
  formatDate(d: Date): string;
  generated: Date;
}

const PAGE = { width: 612, height: 792 }; // Letter
const MARGIN = 54;
const THUMB_H = 300;
const ACCENT = rgb(0.75, 0.1, 0.1);

/** Text the standard fonts can draw (WinAnsi); anything else becomes "?". */
function encodable(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return Array.from(s.replace(/\r\n?/g, "\n"), (c) =>
    c === "\n" || ok.has(c.codePointAt(0) ?? 0) ? c : "?",
  ).join("");
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of encodable(font, text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A word longer than the line is cut.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

export async function summarizeComments(
  engine: Engine,
  bytes: Uint8Array,
  opts: SummaryOptions,
): Promise<{ pdf: Uint8Array; comments: number }> {
  // Threads from the document as it is.
  const doc = await engine
    .openDocumentBuffer({ id: `summary-${crypto.randomUUID()}`, content: bytes.slice().buffer })
    .toPromise();
  const all: PdfAnnotationObject[] = [];
  const sizes = doc.pages.map((p) => p.size);
  try {
    for (const p of doc.pages) all.push(...(await engine.getPageAnnotations(doc, p).toPromise()));
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
  const threads = buildThreads(all);

  // Page pictures with the markup drawn in (a flattened copy, never saved).
  const flat = await flattenMarkup(engine, bytes);
  const src = await PDFDocument.load(flat.bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  out.setTitle(`Comment summary - ${opts.fileName}`);
  out.setProducer("PDF Workbench");
  out.setCreator("PDF Workbench");
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const textW = PAGE.width - MARGIN * 2;

  let page: PDFPage = out.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const newPage = () => {
    page = out.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  const line = (text: string, font: PDFFont, size: number, indent = 0, color = rgb(0, 0, 0)) => {
    for (const l of wrap(font, size, text, textW - indent)) {
      if (y - size < MARGIN) newPage();
      y -= size * 1.3;
      page.drawText(l, { x: MARGIN + indent, y, size, font, color });
    }
  };

  line(`Comment summary: ${opts.fileName}`, bold, 14);
  line(
    `${threads.length} comment${threads.length === 1 ? "" : "s"} · created ${opts.formatDate(opts.generated)}`,
    regular,
    9,
  );
  if (!threads.length) line("This document has no comments.", regular, 11);

  const pages = [...new Set(threads.map((t) => t.annotation.pageIndex))].sort((a, b) => a - b);
  let n = 0;
  for (const pi of pages) {
    const list = threads.filter((t) => t.annotation.pageIndex === pi);
    const size = sizes[pi];
    const srcPage = src.getPage(pi);
    if (!size) continue;
    // Start each document page on a new summary page (after the title block on page 1).
    if (n > 0 || y < PAGE.height - MARGIN - 60) newPage();
    else y -= 12;
    y -= 14;
    page.drawText(encodable(bold, `Page ${pi + 1}`), { x: MARGIN, y, size: 12, font: bold });
    const k = Math.min(textW / size.width, THUMB_H / size.height);
    const w = size.width * k;
    const h = size.height * k;
    const left = MARGIN + (textW - w) / 2;
    const bottom = y - 8 - h;
    const embedded = await out.embedPage(srcPage);
    page.drawPage(embedded, { x: left, y: bottom, width: w, height: h });
    page.drawRectangle({
      x: left,
      y: bottom,
      width: w,
      height: h,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.5,
    });
    // Numbered markers at each comment's top-left corner (page space: top-left origin).
    list.forEach((t, i) => {
      const r = t.annotation.rect;
      const cx = left + Math.min(Math.max(r.origin.x * k, 6), w - 6);
      const cy = bottom + h - Math.min(Math.max(r.origin.y * k, 6), h - 6);
      page.drawCircle({ x: cx, y: cy, size: 6, color: ACCENT });
      const label = String(n + i + 1);
      page.drawText(label, {
        x: cx - bold.widthOfTextAtSize(label, 6.5) / 2,
        y: cy - 2.3,
        size: 6.5,
        font: bold,
        color: rgb(1, 1, 1),
      });
    });
    y = bottom - 6;
    for (const t of list) {
      n++;
      writeThread(t, n);
    }
  }

  function writeThread(t: CommentThread, num: number) {
    const a = t.annotation;
    const when = a.modified ?? a.created;
    const status = [t.status !== "None" ? `Status: ${t.status}` : "", t.marked ? "Marked" : ""]
      .filter(Boolean)
      .join(", ");
    y -= 6;
    line(
      [`${num}. ${typeLabel(a)}`, a.author || "Unknown", when ? opts.formatDate(when) : "", status]
        .filter(Boolean)
        .join("  ·  "),
      bold,
      9,
    );
    if (a.contents) line(a.contents, regular, 9, 14);
    for (const r of t.replies) {
      const rw = r.modified ?? r.created;
      line(
        `Reply from ${r.author || "Unknown"}${rw ? `, ${opts.formatDate(rw)}` : ""}:`,
        bold,
        8.5,
        14,
        rgb(0.3, 0.3, 0.3),
      );
      line(r.contents ?? "", regular, 8.5, 28);
    }
  }

  // Page numbers.
  const total = out.getPageCount();
  out.getPages().forEach((p, i) => {
    const label = `${i + 1} / ${total}`;
    p.drawText(label, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(label, 8),
      y: MARGIN / 2,
      size: 8,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
  });
  return { pdf: await out.save(), comments: threads.length };
}
