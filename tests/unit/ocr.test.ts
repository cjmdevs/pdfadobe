// Phase 7: Recognize Text. A synthetic page with known words is "scanned" (rendered to
// a grey image and placed as an image-only page), tilted, turned or stored sideways.
// After OCR the words must be searchable where the scan shows them, and the page must
// look exactly as before (the text layer is invisible).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { png } from "../corpus/generate.mjs";
import { nodeOcr } from "../helpers/ocr-node";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import {
  OcrCancelled,
  OcrControl,
  checkOcrJob,
  estimateSkew,
  ocrDocument,
  parseOsd,
  renderGray,
  rotateFine,
  rotateQuarter,
  straightenPages,
  turnPagesUpright,
  type Gray,
} from "../../src/engine/ocr";

const require = createRequire(import.meta.url);
const ocr = nodeOcr();
const qpdf = nodeQpdf();
let m: PdfiumModule;

const WORDS = ["Synthetic", "Depreciation", "Quarterly", "Reconciliation"];
const LINES = [
  "Synthetic Invoice Number 4417",
  "Depreciation schedule total 12345.67",
  "Quarterly estimated payment voucher",
  "Bank Reconciliation for the period",
];

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  LINES.forEach((t, i) => page.drawText(t, { x: 72 + i * 20, y: 700 - i * 90, size: 16, font }));
  return doc.save();
}

function render(bytes: Uint8Array, dpi: number): Gray {
  const doc = RawDoc.open(m, bytes);
  try {
    return renderGray(m, doc, 0, dpi);
  } finally {
    doc.close();
  }
}

/** An image-only page showing `g` over 612x792, stored with `/Rotate rotate`. */
async function scanPdf(g: Gray, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png(g.width, g.height, 0, g.data));
  const sideways = rotate % 180 !== 0;
  const page = doc.addPage(sideways ? [792, 612] : [612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  page.setRotation(degrees(rotate));
  return doc.save();
}

/** Centres (display points, y down) of `words` on page 0, from the PDF's text. */
function wordCentres(bytes: Uint8Array): Map<string, { x: number; y: number }> {
  const doc = RawDoc.open(m, bytes);
  const out = new Map<string, { x: number; y: number }>();
  try {
    doc.withPage(0, (page) => {
      const w = m.FPDF_GetPageWidthF(page);
      const h = m.FPDF_GetPageHeightF(page);
      const tp = m.FPDFText_LoadPage(page);
      const n = m.FPDFText_CountChars(tp);
      let text = "";
      for (let i = 0; i < n; i++) text += String.fromCodePoint(m.FPDFText_GetUnicode(tp, i) || 32);
      const mem = m.pdfium.wasmExports.malloc(48);
      const d = (o: number) => m.pdfium.getValue(mem + o, "double");
      for (const word of WORDS) {
        const at = text.indexOf(word);
        if (at < 0) continue;
        let sx = 0;
        let sy = 0;
        for (let i = at; i < at + word.length; i++) {
          m.FPDFText_GetCharBox(tp, i, mem, mem + 8, mem + 16, mem + 24);
          const cx = (d(0) + d(8)) / 2;
          const cy = (d(16) + d(24)) / 2;
          m.FPDF_PageToDevice(
            page,
            0,
            0,
            Math.round(w * 10),
            Math.round(h * 10),
            0,
            cx,
            cy,
            mem + 32,
            mem + 36,
          );
          sx += m.pdfium.getValue(mem + 32, "i32") / 10;
          sy += m.pdfium.getValue(mem + 36, "i32") / 10;
        }
        out.set(word, { x: sx / word.length, y: sy / word.length });
      }
      m.pdfium.wasmExports.free(mem);
      m.FPDFText_ClosePage(tp);
    });
  } finally {
    doc.close();
  }
  return out;
}

/** Turns a display point clockwise by `deg` about the page centre (y down). */
function turn(p: { x: number; y: number }, deg: number, w = 612, h = 792) {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - w / 2;
  const dy = p.y - h / 2;
  return {
    x: w / 2 + dx * Math.cos(a) - dy * Math.sin(a),
    y: h / 2 + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

function sameRender(a: Uint8Array, b: Uint8Array): boolean {
  const ra = render(a, 72);
  const rb = render(b, 72);
  return ra.width === rb.width && ra.data.every((v, i) => v === rb.data[i]);
}

describe("OCR jobs", () => {
  it("allows only plain names and listed options", () => {
    const job = (args: string[]) => ({
      id: 1,
      inputs: { "page.pgm": new Uint8Array() },
      args,
      outputs: [],
    });
    expect(() => checkOcrJob(job(["page.pgm", "out", "-l", "eng", "--psm", "0"]))).not.toThrow();
    for (const bad of [
      ["page.pgm", "out", "--tessdata-dir", "x"],
      ["page.pgm", "out", "-c", "tessedit_write_images=1"],
      ["page.pgm", "out", "pdf"],
      ["..\\page.pgm", "out"],
      ["page.pgm", "C:\\out"],
    ]) {
      expect(() => checkOcrJob(job(bad))).toThrow();
    }
  });

  it("reads Tesseract's orientation report", () => {
    expect(parseOsd("Rotate: 90\nOrientation confidence: 5.1")).toBe(90);
    expect(parseOsd("Rotate: 180\nOrientation confidence: 0.4")).toBe(0);
    expect(parseOsd("")).toBe(0);
  });
});

describe("straightening", () => {
  it("finds a 3 degree tilt", async () => {
    const g = render(await sourcePdf(), 150);
    expect(estimateSkew(g)).toBe(0);
    expect(estimateSkew(rotateFine(g, 3))).toBeCloseTo(-3, 0);
    expect(estimateSkew(rotateFine(g, -2))).toBeCloseTo(2, 0);
  });

  it("turns by quarters", () => {
    const g = { width: 2, height: 1, data: new Uint8Array([1, 2]) };
    expect(rotateQuarter(g, 90)).toEqual({ width: 1, height: 2, data: new Uint8Array([1, 2]) });
    expect(rotateQuarter(g, 270)).toEqual({ width: 1, height: 2, data: new Uint8Array([2, 1]) });
    expect(rotateQuarter(g, 180).data).toEqual(new Uint8Array([2, 1]));
  });
});

describe("Recognize Text", { timeout: 120_000 }, () => {
  const TOLERANCE = 8; // points

  async function check(scan: Uint8Array, expected: Map<string, { x: number; y: number }>) {
    const r = await ocrDocument(m, ocr, qpdf, scan, {}, new OcrControl(ocr));
    expect(r.read).toEqual([0]);
    expect(sameRender(scan, r.bytes)).toBe(true);
    const got = wordCentres(r.bytes);
    for (const word of WORDS) {
      const g = got.get(word);
      const e = expected.get(word)!;
      expect(g, `${word} is searchable`).toBeDefined();
      expect(Math.hypot(g!.x - e.x, g!.y - e.y), `${word} position`).toBeLessThan(TOLERANCE);
    }
  }

  it("adds a positioned, invisible text layer to a straight scan", async () => {
    const src = await sourcePdf();
    await check(await scanPdf(render(src, 200)), wordCentres(src));
  });

  it("leaves the scan drawn directly on the page (Edit PDF and redaction see it)", async () => {
    const scan = await scanPdf(render(await sourcePdf(), 200));
    const r = await ocrDocument(m, ocr, qpdf, scan, {}, new OcrControl(ocr));
    const doc = RawDoc.open(m, r.bytes);
    try {
      const types = doc.withPage(0, (p) =>
        Array.from({ length: m.FPDFPage_CountObjects(p) }, (_, i) =>
          m.FPDFPageObj_GetType(m.FPDFPage_GetObject(p, i)),
        ),
      );
      // 3 = image (the scan), 5 = form (the text layer).
      expect(types.filter((t) => t === 3)).toHaveLength(1);
      expect(types.filter((t) => t === 5)).toHaveLength(1);
    } finally {
      doc.close();
    }
  });

  it("reads a scan tilted by 3 degrees, words where the scan shows them", async () => {
    const src = await sourcePdf();
    const truth = new Map([...wordCentres(src)].map(([k, p]) => [k, turn(p, 3)]));
    await check(await scanPdf(rotateFine(render(src, 200), 3)), truth);
  });

  it("reads a page stored sideways with /Rotate 90", async () => {
    // The image is stored turned anticlockwise; /Rotate 90 shows it upright.
    const src = await sourcePdf();
    await check(await scanPdf(rotateQuarter(render(src, 200), 270), 90), wordCentres(src));
  });

  it("reads a page scanned upside down", async () => {
    const src = await sourcePdf();
    const truth = new Map([...wordCentres(src)].map(([k, p]) => [k, turn(p, 180)]));
    await check(await scanPdf(rotateQuarter(render(src, 200), 180)), truth);
  });

  it("skips pages that already have text and pages with no words", async () => {
    const src = await sourcePdf();
    const blank = await scanPdf({
      width: 100,
      height: 130,
      data: new Uint8Array(100 * 130).fill(255),
    });
    const r1 = await ocrDocument(m, ocr, qpdf, src, {}, new OcrControl(ocr));
    expect(r1).toMatchObject({ read: [], hadText: [0] });
    expect(r1.bytes).toBe(src);
    const r2 = await ocrDocument(m, ocr, qpdf, blank, {}, new OcrControl(ocr));
    expect(r2).toMatchObject({ read: [], noWords: [0] });
  });

  it("stops when cancelled", async () => {
    const scan = await scanPdf(render(await sourcePdf(), 200));
    const control = new OcrControl(ocr);
    const run = ocrDocument(m, ocr, qpdf, scan, {}, control, (p) => {
      if (p.page === 0) void control.cancel();
    });
    await expect(run).rejects.toBeInstanceOf(OcrCancelled);
  });
});

describe("Enhance", { timeout: 120_000 }, () => {
  it("fixes the corpus scans the owner check uses", async () => {
    const { OUT_DIR } = await import("../corpus/generate.mjs");
    const { join } = await import("node:path");
    const tilted = new Uint8Array(readFileSync(join(OUT_DIR, "scanned-tilted.pdf")));
    expect((await straightenPages(m, qpdf, tilted, [0])).turned[0]?.degrees).toBeCloseTo(-3, 0);
    const sideways = new Uint8Array(readFileSync(join(OUT_DIR, "scanned-sideways.pdf")));
    const up = await turnPagesUpright(m, ocr, sideways, [0], new OcrControl(ocr));
    expect(up.turned).toEqual([{ page: 0, degrees: 270 }]);
  });

  it("Straighten Pages turns a tilted scan level without re-encoding it", async () => {
    const src = await sourcePdf();
    const scan = await scanPdf(rotateFine(render(src, 200), 3));
    expect(Math.abs(estimateSkew(render(scan, 150)))).toBeGreaterThan(2);
    const r = await straightenPages(m, qpdf, scan, [0]);
    expect(r.turned).toHaveLength(1);
    expect(r.turned[0]?.degrees).toBeCloseTo(-3, 0);
    expect(Math.abs(estimateSkew(render(r.bytes, 150)))).toBeLessThan(0.5);
    // The same image object, untouched: only two small content streams were added.
    expect(r.bytes.length - scan.length).toBeLessThan(1500);
    // A straight page is left alone.
    const straight = await straightenPages(m, qpdf, await scanPdf(render(src, 200)), [0]);
    expect(straight.turned).toEqual([]);
  });

  it("Turn Pages Upright fixes an upside-down page with /Rotate", async () => {
    const src = await sourcePdf();
    const scan = await scanPdf(rotateQuarter(render(src, 200), 180));
    const r = await turnPagesUpright(m, ocr, scan, [0], new OcrControl(ocr));
    expect(r.turned).toEqual([{ page: 0, degrees: 180 }]);
    const doc = RawDoc.open(m, r.bytes);
    try {
      expect(doc.withPage(0, (p) => m.FPDFPage_GetRotation(p))).toBe(2);
    } finally {
      doc.close();
    }
  });
});
