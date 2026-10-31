// Phase 7: PDF pages to PNG/JPEG at a chosen resolution, PDF to plain text, and images
// to PDF (scanner batches: JPEG, PNG and multi-page G4 TIFF, one page per image).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { decodePng } from "../../src/engine/pages/png";
import { imagePages, imagesToPdf } from "../../src/engine/pages/images";
import { RawDoc } from "../../src/engine/pages/raw";
import { documentText, pageFileName, pageImage } from "../../src/engine/convert";

const require = createRequire(import.meta.url);
let m: PdfiumModule;
const corpus = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));
const fixture = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, "..", "fixtures", f)));

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

describe("PDF to images", () => {
  it("renders PNG at the chosen resolution, as the page is seen", () => {
    const png = pageImage(m, corpus("text-1p.pdf"), 0, 150, "png");
    const img = decodePng(png);
    expect([img.width, img.height]).toEqual([1275, 1650]); // Letter at 150 dpi
    // Mostly white paper with some dark text.
    let dark = 0;
    for (let i = 0; i < img.data.length; i += 4) if ((img.data[i] ?? 255) < 100) dark++;
    expect(dark).toBeGreaterThan(1000);
    // A /Rotate 90 page comes out landscape.
    const turned = decodePng(pageImage(m, corpus("navigation.pdf"), 5, 72, "png"));
    expect([turned.width, turned.height]).toEqual([792, 612]);
  });

  it("writes JPEG files", () => {
    const jpg = pageImage(m, corpus("text-1p.pdf"), 0, 100, "jpeg", 80);
    expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("refuses absurd sizes instead of running out of memory", () => {
    expect(() => pageImage(m, corpus("text-1p.pdf"), 0, 2400, "png")).toThrow(/too large/);
  });

  it("names files by page, padded", () => {
    expect(pageFileName("Return", 2, 120, "png")).toBe("Return_Page_003.png");
    expect(pageFileName("Return", 0, 9, "jpeg")).toBe("Return_Page_1.jpg");
  });
});

describe("PDF to text", () => {
  it("gives every page's text with page breaks", () => {
    const text = documentText(m, corpus("long-200p.pdf"));
    const pages = text.split("\f");
    expect(pages).toHaveLength(200);
    expect(pages[14]).toContain("schedule line 15");
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it("gives nothing for a scan without OCR", () => {
    expect(documentText(m, corpus("scanned-image-only.pdf")).trim()).toBe("");
  });
});

describe("Images to PDF", () => {
  it("one page per image, TIFF pages included", () => {
    const files = [fixture("photo-rgb.jpg"), fixture("scan-g4-3p.tif")];
    const pdf = imagesToPdf(files.flatMap((f) => imagePages(f)));
    const doc = RawDoc.open(m, pdf);
    try {
      expect(doc.pageCount).toBe(4);
    } finally {
      doc.close();
    }
  });
});
