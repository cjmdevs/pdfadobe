// The SSN fixture through the Phase 5 redaction pipeline, judged by extractors that
// share no code with it (pdf.js, qpdf). Phase 0 pinned six EmbedPDF gaps here with
// `it.fails` (docs/spike-report.md); all six now pass and the markers are gone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_SSN, OUT_DIR, SSN_LAYOUT } from "../corpus/generate.mjs";
import {
  decompressedBytes,
  pdfiumText,
  pdfjsView,
  rawHits,
  type PdfjsView,
} from "../helpers/leak-scan";
import { nodeEngine } from "../helpers/pdfium-node";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type Engine } from "../../src/engine/pdfium";
import { redactDocument, searchDocument, type PageRedaction } from "../../src/engine/redact";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const box = (r: { x: number; y: number; width: number; height: number }) => ({
  l: r.x,
  b: r.y,
  r: r.x + r.width,
  t: r.y + r.height,
});

const OUT = join(OUT_DIR, "..", "out");
let engine: Engine;
let original: Uint8Array;
let redacted: Uint8Array;
let view: PdfjsView;
let marked = 0;

beforeAll(async () => {
  engine = await nodeEngine();
  const m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))))
    .module;
  original = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
  // Search hits (grown 1 pt for ascenders) plus the two area boxes.
  const hits = searchDocument(m, original, { literals: [FAKE_SSN] });
  const marks: PageRedaction[] = hits.map((h) => ({
    pageIndex: h.pageIndex,
    rects: h.rects.map((r) => ({ l: r.l - 1, b: r.b - 1, r: r.r + 1, t: r.t + 1 })),
  }));
  marks.push({ pageIndex: 0, rects: [box(SSN_LAYOUT.formField.rect), box(SSN_LAYOUT.areaZone)] });
  marked = hits.length + 2;
  const result = await redactDocument(m, nodeQpdf(), original, {
    marks,
    found: hits.map((h) => h.text ?? ""),
  });
  redacted = result.bytes;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "ssn-redacted.pdf"), redacted);
  view = await pdfjsView(redacted);
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

async function page1Ops(bytes: Uint8Array): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const ops = (await (await doc.getPage(1)).getOperatorList()).fnArray;
  await task.destroy();
  return ops;
}

describe("fixture sanity (the test can see the SSN before redaction)", () => {
  it("all extractors find the SSN in the original", async () => {
    const v = await pdfjsView(original);
    expect((await pdfiumText(engine, original)).join("")).toContain(FAKE_SSN);
    expect(v.pageText.join("")).toContain(FAKE_SSN);
    expect(v.annotations.flatMap((a) => a.strings).join(" ")).toContain(FAKE_SSN);
    expect(String(v.info.Subject)).toContain(FAKE_SSN);
    expect(v.xmp).toContain(FAKE_SSN);
    expect(rawHits(original, FAKE_SSN)).toContain("ascii");
  });

  it("marked 3 text hits (incl. split run, page 2) + 2 areas", () => {
    expect(marked).toBe(5);
  });
});

describe("redacted output: page content", () => {
  it("SSN is gone from page text (PDFium)", async () => {
    expect((await pdfiumText(engine, redacted)).join("\n")).not.toContain(FAKE_SSN);
  });

  it("SSN is gone from page text (pdf.js), incl. split runs and page 2", () => {
    expect(view.pageText.join("")).not.toContain(FAKE_SSN);
    expect(view.pageText.join("")).not.toContain("3456");
  });

  it("vector path only partly under a box is clipped, not kept whole", () => {
    // The 70 pt red bar under the first SSN pokes out of the box: it is still painted
    // (the only red fill on the page), but its top edge now stops at the box.
    // PDFium writes the colour as ".80000001"; the bar's top-right corner is "70 1.5 l".
    const red = /(^|\s)0?\.80*1? 0 0 rg/m;
    const bar = /(^|\s)70 1\.5 l/m;
    const before = decompressedBytes(original).toString("latin1");
    const after = decompressedBytes(redacted).toString("latin1");
    expect(red.test(before) && bar.test(before)).toBe(true);
    expect(red.test(after)).toBe(true);
    expect(bar.test(after)).toBe(false);
  });

  it("text outside the boxes survives", () => {
    const all = view.pageText.join("");
    expect(all).toContain(SSN_LAYOUT.keepText);
    expect(all).toContain("KEEP-THIS-LINE");
    expect(all).toContain("Page 2. Dependent record references");
  });

  it("image fully under an area box is removed", async () => {
    const count = (ops: number[]) => ops.filter((o) => o === OPS.paintImageXObject).length;
    expect(count(await page1Ops(original))).toBe(1);
    expect(count(await page1Ops(redacted))).toBe(0);
  });

  it("vector path fully under an area box is removed", () => {
    // The square is the only fill in this colour (0 0.4 0.8 rg; PDFium writes 0 .4 .8 rg).
    const re = /(^|\s)0 0?\.4(0*\d*)? 0?\.8(0*\d*)? rg/m;
    expect(re.test(decompressedBytes(original).toString("latin1"))).toBe(true);
    expect(re.test(decompressedBytes(redacted).toString("latin1"))).toBe(false);
  });
});

describe("redacted output: everything else (EmbedPDF 2.15.1 gaps, closed in Phase 5)", () => {
  it("annotation over the box (sticky note /Contents) is removed", () => {
    expect(view.annotations.flatMap((a) => a.strings).join(" ")).not.toContain(FAKE_SSN);
  });

  it("form field value under the box (/V and widget appearance) is removed", () => {
    const widget = view.annotations.filter((a) => a.subtype === "Widget");
    expect(widget.flatMap((a) => a.strings).join(" ")).not.toContain(FAKE_SSN);
  });

  it("document /Info (Subject, Keywords) is scrubbed", () => {
    expect(JSON.stringify(view.info)).not.toContain(FAKE_SSN);
  });

  it("XMP metadata is scrubbed", () => {
    expect(view.xmp).not.toContain(FAKE_SSN);
    // Apply drops XMP whole: it repeats document properties and cannot be checked
    // entry by entry.
    expect(decompressedBytes(redacted).toString("latin1")).not.toContain("<x:xmpmeta");
  });

  it("SSN is absent from the raw file in every encoding (end-to-end gate)", () => {
    expect(rawHits(redacted, FAKE_SSN)).toEqual([]);
  });
});
