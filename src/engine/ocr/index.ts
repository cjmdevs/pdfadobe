// Recognize Text (Phase 7). For each page: render at 300 dpi as displayed, find its
// orientation (Tesseract OSD) and skew, OCR a straightened copy into Tesseract's
// text-only PDF, then place that invisible text back on the page with the inverse
// turn. The page's own content (the scan) is never changed: the text is grafted on as
// one form XObject per page (pages/graft.ts), like OCRmyPDF's sandwich renderer.
import {
  PDFDocument,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import type { PdfiumModule } from "../pdfium";
import { RawDoc } from "../pages/raw";
import type { Qpdf } from "../pages/qpdf";
import { graftLayers, pageFrames } from "../pages/graft";
import { estimateSkew, renderGray, rotateFine, rotateQuarter, toPgm, type Gray } from "./image";
import { OcrCancelled, type Ocr } from "./tesseract";

export * from "./tesseract";
export * from "./image";
export * from "./straighten";

export interface OcrOptions {
  /** 0-based pages to read; all pages when left out. */
  pages?: number[];
  /** Leave pages that already have text alone (default true). */
  skipText?: boolean;
  /** Find each page's orientation and skew before reading (default true). */
  straighten?: boolean;
  dpi?: number;
}

export interface OcrProgress {
  /** 0-based page being read now, or null when done. */
  page: number | null;
  done: number;
  total: number;
}

export interface OcrReport {
  bytes: Uint8Array;
  /** Pages that got a text layer. */
  read: number[];
  /** Pages left alone because they already had text. */
  hadText: number[];
  /** Pages Tesseract found no words on. */
  noWords: number[];
}

/** Cancels a run between pages, and the Tesseract process that is running now. */
export class OcrControl {
  cancelled = false;
  private running: number | null = null;
  private static seq = 0;
  constructor(private readonly ocr: Ocr) {}

  /** A job id that is unique within this JS context (worker or Node process). */
  nextJob(): number {
    this.running = ++OcrControl.seq;
    return this.running;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.running !== null) await this.ocr.cancel(this.running);
  }

  check(): void {
    if (this.cancelled) throw new OcrCancelled();
  }
}

/** Pages with this many non-blank characters count as "already has text". */
export const TEXT_THRESHOLD = 20;

export function pageHasText(m: PdfiumModule, doc: RawDoc, index: number): boolean {
  return doc.withPage(index, (page) => {
    const tp = m.FPDFText_LoadPage(page);
    if (!tp) return false;
    try {
      const n = m.FPDFText_CountChars(tp);
      let seen = 0;
      for (let i = 0; i < n && seen < TEXT_THRESHOLD; i++) {
        if (!/\s/.test(String.fromCodePoint(m.FPDFText_GetUnicode(tp, i) || 32))) seen++;
      }
      return seen >= TEXT_THRESHOLD;
    } finally {
      m.FPDFText_ClosePage(tp);
    }
  });
}

/** Tesseract OSD output: the clockwise turn that makes the page upright, if sure. */
export function parseOsd(text: string, minConfidence = 2): 0 | 90 | 180 | 270 {
  const rotate = Number(/Rotate:\s*(\d+)/.exec(text)?.[1] ?? 0);
  const conf = Number(/Orientation confidence:\s*([\d.]+)/.exec(text)?.[1] ?? 0);
  if (conf < minConfidence) return 0;
  return rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0;
}

/** PDF matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];

/** `first`, then `then`. */
export function compose(first: Matrix, then: Matrix): Matrix {
  const [a, b, c, d, e, f] = first;
  const [A, B, C, D, E, F] = then;
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ];
}

/**
 * Maps points of Tesseract's text page (points, bottom-left origin, read from the
 * straightened image) onto the displayed page (`pageW` x `pageH` points).
 * `w` x `h` is the rendered image before any turn; `quarter` and `fine` are the
 * clockwise turns applied to it, in that order.
 */
export function layerMatrix(
  img: { w: number; h: number },
  page: { w: number; h: number },
  quarter: 0 | 90 | 180 | 270,
  fine: number,
  dpi: number,
): Matrix {
  const px = dpi / 72;
  const turned = quarter === 90 || quarter === 270;
  const w2 = turned ? img.h : img.w;
  const h2 = turned ? img.w : img.h;
  // Tesseract points -> pixels of the straightened image (y down).
  let m: Matrix = [px, 0, 0, -px, 0, h2];
  // Undo the fine turn: counter-clockwise on screen about the centre.
  const a = (-fine * Math.PI) / 180;
  const cx = w2 / 2;
  const cy = h2 / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  m = compose(m, [1, 0, 0, 1, -cx, -cy]);
  m = compose(m, [cos, sin, -sin, cos, 0, 0]);
  m = compose(m, [1, 0, 0, 1, cx, cy]);
  // Undo the quarter turn (pixels of the turned image -> pixels of the render).
  const { w, h } = img;
  const undo: Record<0 | 90 | 180 | 270, Matrix> = {
    0: [1, 0, 0, 1, 0, 0],
    90: [0, -1, 1, 0, 0, h], // (X, Y) -> (Y, h - X)
    180: [-1, 0, 0, -1, w, h],
    270: [0, 1, -1, 0, w, 0], // (X, Y) -> (w - Y, X)
  };
  m = compose(m, undo[quarter]);
  // Render pixels -> displayed page points (y up).
  return compose(m, [page.w / w, 0, 0, -page.h / h, 0, page.h]);
}

interface PageRead {
  index: number;
  size: { w: number; h: number };
  img: { w: number; h: number };
  quarter: 0 | 90 | 180 | 270;
  fine: number;
  pdf: Uint8Array;
}

/** Reads one page. Returns null when Tesseract found no words on it. */
async function readPage(
  m: PdfiumModule,
  ocr: Ocr,
  doc: RawDoc,
  index: number,
  dpi: number,
  straighten: boolean,
  control: OcrControl,
): Promise<PageRead | null> {
  const size = doc.withPage(index, (p) => ({
    w: m.FPDF_GetPageWidthF(p),
    h: m.FPDF_GetPageHeightF(p),
  }));
  const render = renderGray(m, doc, index, dpi);
  let quarter: 0 | 90 | 180 | 270 = 0;
  let fine = 0;
  let img: Gray = render;
  if (straighten) {
    quarter = await orientationOf(ocr, render, dpi, control);
    img = rotateQuarter(render, quarter);
    fine = estimateSkew(img);
    if (Math.abs(fine) < 0.2) fine = 0;
    img = rotateFine(img, fine);
  }
  control.check();
  const r = await ocr
    .run({
      id: control.nextJob(),
      inputs: { "page.pgm": toPgm(img) },
      args: [
        "page.pgm",
        "text",
        "-l",
        "eng",
        "--dpi",
        String(dpi),
        "-c",
        "tessedit_create_pdf=1",
        "-c",
        "textonly_pdf=1",
        "-c",
        "tessedit_create_txt=1",
      ],
      outputs: ["text.pdf", "text.txt"],
    })
    .catch((e: unknown) => {
      control.check();
      throw e;
    });
  const pdf = r.files["text.pdf"];
  if (!pdf) throw new Error(`page ${index + 1}: Tesseract wrote no text layer`);
  const words = new TextDecoder().decode(r.files["text.txt"] ?? new Uint8Array()).trim();
  if (!words) return null;
  return { index, size, img: { w: render.width, h: render.height }, quarter, fine, pdf };
}

/** The clockwise quarter turn that makes `g` upright (0 when unsure). */
export async function orientationOf(
  ocr: Ocr,
  g: Gray,
  dpi: number,
  control: OcrControl,
): Promise<0 | 90 | 180 | 270> {
  control.check();
  try {
    const r = await ocr.run({
      id: control.nextJob(),
      inputs: { "page.pgm": toPgm(g) },
      args: ["page.pgm", "osd", "--psm", "0", "-l", "osd", "--dpi", String(dpi)],
      outputs: ["osd.osd"],
    });
    return parseOsd(new TextDecoder().decode(r.files["osd.osd"] ?? new Uint8Array()) + r.stdout);
  } catch {
    // Too little text to tell (Tesseract fails OSD then), or cancelled.
    control.check();
    return 0;
  }
}

/** One page per read page, the size of the displayed page, holding only its text. */
async function buildLayer(reads: PageRead[], dpi: number): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const r of reads) {
    const page = out.addPage([r.size.w, r.size.h]);
    const [text] = await out.embedPdf(r.pdf, [0]);
    if (!text) throw new Error(`page ${r.index + 1}: unreadable text layer`);
    const name = page.node.newXObject("OCR", text.ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...layerMatrix(r.img, r.size, r.quarter, r.fine, dpi)),
      drawObject(name),
      popGraphicsState(),
    );
  }
  return out.save({ useObjectStreams: false });
}

/**
 * Adds an invisible text layer to the chosen pages. Throws `OcrCancelled` if
 * `control.cancel()` was called; the input bytes are never changed.
 */
export async function ocrDocument(
  m: PdfiumModule,
  ocr: Ocr,
  qpdf: Qpdf,
  bytes: Uint8Array,
  opts: OcrOptions,
  control: OcrControl,
  progress?: (p: OcrProgress) => void,
): Promise<OcrReport> {
  const dpi = opts.dpi ?? 300;
  const doc = RawDoc.open(m, bytes);
  const reads: PageRead[] = [];
  const report: Omit<OcrReport, "bytes"> = { read: [], hadText: [], noWords: [] };
  try {
    const pages = opts.pages ?? Array.from({ length: doc.pageCount }, (_, i) => i);
    let done = 0;
    for (const index of pages) {
      control.check();
      progress?.({ page: index, done, total: pages.length });
      if (opts.skipText !== false && pageHasText(m, doc, index)) report.hadText.push(index);
      else {
        const r = await readPage(m, ocr, doc, index, dpi, opts.straighten !== false, control);
        if (r) reads.push(r);
        else report.noWords.push(index);
      }
      done++;
    }
    progress?.({ page: null, done, total: pages.length });
  } finally {
    doc.close();
  }
  control.check();
  if (!reads.length) return { bytes, ...report };
  const layer = await buildLayer(reads, dpi);
  report.read = reads.map((r) => r.index);
  const frames = pageFrames(m, bytes);
  const out = await graftLayers(
    qpdf,
    bytes,
    layer,
    reads.map((r, i) => ({
      page: r.index,
      layerPage: i,
      behind: false,
      matrix: frames[r.index]?.toUser ?? [1, 0, 0, 1, 0, 0],
    })),
    "ocr",
  );
  return { bytes: out, ...report };
}
