// Phase 0 spike: EmbedPDF redaction, judged by three independent extractors.
//
// `it.fails` marks a KNOWN EmbedPDF 2.15.1 limitation (see docs/spike-report.md).
// It passes while the leak exists and turns RED when the leak is fixed, so the
// marker must then be removed. A redaction feature is not done until none remain.

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
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import type { Engine } from "../../src/engine/pdfium";
import { fromPdfRect, redact, save } from "../../src/engine/spike";

const OUT = join(OUT_DIR, "..", "out");
let engine: Engine;
let original: Uint8Array;
let redacted: Uint8Array;
let view: PdfjsView;
let marked = 0;

beforeAll(async () => {
  engine = await nodeEngine();
  original = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
  const doc = await engine
    .openDocumentBuffer({ id: "ssn", content: toArrayBuffer(original) })
    .toPromise();
  const result = await redact(engine, doc, {
    needle: FAKE_SSN,
    areas: [
      { pageIndex: 0, rect: fromPdfRect(doc, 0, SSN_LAYOUT.formField.rect) },
      { pageIndex: 0, rect: fromPdfRect(doc, 0, SSN_LAYOUT.areaZone) },
    ],
  });
  marked = result.marked;
  redacted = new Uint8Array(await save(engine, doc));
  await engine.closeDocument(doc).toPromise();
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

  it("vector path only partly under a box is kept whole (not clipped)", () => {
    // Documented behaviour, not a leak: the 70pt red line under the first SSN.
    expect(decompressedBytes(redacted).toString("latin1")).toContain("0 0 70 1.5 re f");
  });

  it("text outside the boxes survives", () => {
    const all = view.pageText.join("");
    expect(all).toContain(SSN_LAYOUT.keepText);
    expect(all).toContain("KEEP-THIS-LINE");
    expect(all).toContain("Page 2. Dependent record references");
  });

  // KNOWN GAP (EmbedPDF 2.15.1): image XObjects under the box are left in place.
  it.fails("image fully under an area box is removed", async () => {
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

describe("redacted output: everything else (known EmbedPDF 2.15.1 gaps)", () => {
  it.fails("annotation over the box (sticky note /Contents) is removed", () => {
    expect(view.annotations.flatMap((a) => a.strings).join(" ")).not.toContain(FAKE_SSN);
  });

  it.fails("form field value under the box (/V and widget appearance) is removed", () => {
    const widget = view.annotations.filter((a) => a.subtype === "Widget");
    expect(widget.flatMap((a) => a.strings).join(" ")).not.toContain(FAKE_SSN);
  });

  it.fails("document /Info (Subject, Keywords) is scrubbed", () => {
    expect(JSON.stringify(view.info)).not.toContain(FAKE_SSN);
  });

  it.fails("XMP metadata is scrubbed", () => {
    expect(view.xmp).not.toContain(FAKE_SSN);
    const raw = decompressedBytes(redacted).toString("latin1");
    const xmp = raw.slice(raw.indexOf("<x:xmpmeta"), raw.indexOf("</x:xmpmeta>"));
    expect(xmp.length).toBeGreaterThan(0);
    expect(xmp.includes(FAKE_SSN)).toBe(false);
  });

  it.fails("SSN is absent from the raw file in every encoding (end-to-end gate)", () => {
    expect(rawHits(redacted, FAKE_SSN)).toEqual([]);
  });
});
