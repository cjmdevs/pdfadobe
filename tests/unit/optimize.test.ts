// Phase 7: Reduce File Size. Corpus files get smaller and their pages render the same
// (pixel difference within tolerance); a fully embedded font is subset and its text
// still extracts and draws the same.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { renderGray } from "../../src/engine/ocr/image";
import { createGlyphSubsetter, type GlyphSubsetter } from "../../src/engine/edit/fonts/subset";
import { optimizeDocument, type OptimizePresetId } from "../../src/engine/optimize";
import { resample } from "../../src/engine/optimize/images";

const require = createRequire(import.meta.url);
const qpdf = nodeQpdf();
let m: PdfiumModule;
let subsetter: GlyphSubsetter;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  subsetter = await createGlyphSubsetter(
    readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")),
  );
});

function pageText(bytes: Uint8Array, index = 0): string {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(index, (page) => {
      const tp = m.FPDFText_LoadPage(page);
      const n = m.FPDFText_CountChars(tp);
      let s = "";
      for (let i = 0; i < n; i++) s += String.fromCodePoint(m.FPDFText_GetUnicode(tp, i) || 32);
      m.FPDFText_ClosePage(tp);
      return s;
    });
  } finally {
    doc.close();
  }
}

/** Mean absolute grey difference (0-255) between two renders of every page at 72 dpi. */
function renderDiff(a: Uint8Array, b: Uint8Array): number {
  const da = RawDoc.open(m, a);
  const db = RawDoc.open(m, b);
  try {
    expect(db.pageCount).toBe(da.pageCount);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < Math.min(da.pageCount, 5); i++) {
      const ra = renderGray(m, da, i, 72);
      const rb = renderGray(m, db, i, 72);
      expect([rb.width, rb.height]).toEqual([ra.width, ra.height]);
      for (let k = 0; k < ra.data.length; k++)
        sum += Math.abs((ra.data[k] ?? 0) - (rb.data[k] ?? 0));
      n += ra.data.length;
    }
    return sum / n;
  } finally {
    da.close();
    db.close();
  }
}

const corpus = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));

describe("Reduce File Size", { timeout: 120_000 }, () => {
  const cases: [string, OptimizePresetId, number][] = [
    ["scanned-image-only.pdf", "email", 6],
    ["scanned-image-only.pdf", "standard", 4],
    ["scanned-image-only.pdf", "archive", 3],
    ["long-200p.pdf", "standard", 0.5],
    ["workpaper-a.pdf", "standard", 0.5],
    ["leak-image.pdf", "standard", 4],
  ];
  it.each(cases)("%s (%s): smaller, renders the same", async (file, preset, tolerance) => {
    const src = corpus(file);
    const r = await optimizeDocument(m, qpdf, subsetter, src, preset);
    expect(r.before).toBe(src.length);
    expect(r.after).toBe(r.bytes.length);
    expect(r.after).toBeLessThan(r.before);
    expect(renderDiff(src, r.bytes)).toBeLessThan(tolerance);
    expect(pageText(r.bytes)).toBe(pageText(src));
    // A structurally valid file (qpdf exits 0 or 3 only on success).
    const check = await qpdf.run({
      inputs: { "in0.pdf": r.bytes },
      args: ["--check", "in0.pdf"],
      outputs: [],
    });
    expect(check.warnings).toBe(false);
    if (r.linearized) expect(check.stdout).toContain("File is linearized");
  });

  it("resamples a scan above the preset's resolution, keeping its page size", async () => {
    const src = corpus("scanned-image-only.pdf"); // 1700 x 2200 on Letter = 200 dpi
    const email = await optimizeDocument(m, qpdf, subsetter, src, "email");
    const archive = await optimizeDocument(m, qpdf, subsetter, src, "archive");
    expect(email.downsampled).toBe(1);
    // At 300 dpi the 200 dpi scan keeps its pixels (a JPEG of this mostly white page
    // is no smaller than its Flate data, so it may stay as it is).
    expect(archive.downsampled).toBe(0);
    expect(email.after).toBeLessThan(archive.after);
  });

  it("subsets a fully embedded font; text and drawing unchanged", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(
      // Noto Sans (OFL-1.1), shipped with EmbedPDF's font package.
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../node_modules/@embedpdf/fonts-latin/fonts/NotoSans-Regular.ttf",
        ),
      ),
      { subset: false },
    );
    const page = doc.addPage([612, 792]);
    page.drawText("Trial balance reconciled 2026", { x: 72, y: 700, size: 18, font });
    const src = await doc.save();
    const r = await optimizeDocument(m, qpdf, subsetter, src, "standard");
    expect(r.fontsSubset).toBe(1);
    expect(r.after).toBeLessThan(r.before / 4);
    expect(pageText(r.bytes)).toBe("Trial balance reconciled 2026");
    expect(renderDiff(src, r.bytes)).toBeLessThan(0.05);
  });

  it("never changes the input", async () => {
    const src = corpus("scanned-image-only.pdf");
    const copy = src.slice();
    await optimizeDocument(m, qpdf, subsetter, src, "email");
    expect(src).toEqual(copy);
  });
});

describe("resample", () => {
  it("averages areas", () => {
    const px = new Uint8Array([0, 100, 200, 100, 0, 100, 200, 100]);
    expect(resample(px, 4, 2, 1, 2, 1)).toEqual(new Uint8Array([50, 150]));
  });
});
