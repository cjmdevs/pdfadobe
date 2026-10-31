// Backlog B6 / Phase 4 stage 4: a PDFlyer-marked workpaper (synthetic copy of how
// PDFlyer and Acrobat store their items) renders and every item is in the Stamp Summary.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, PDFLYER_SAMPLE } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import type { Engine } from "../../src/engine/pdfium";
import type { PdfAnnotationObject } from "@embedpdf/models";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { summaryCsv, summaryRows } from "../../src/flyer/items";

let engine: Engine;
beforeAll(async () => {
  engine = await nodeEngine();
});
afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

describe("PDFlyer-marked workpaper", () => {
  it("lists every item, each with its own appearance", async () => {
    const doc = await engine
      .openDocumentBuffer({
        id: "pdflyer",
        content: toArrayBuffer(readFileSync(join(OUT_DIR, "pdflyer-sample.pdf"))),
      })
      .toPromise();
    const annots = await engine.getPageAnnotations(doc, doc.pages[0]!).toPromise();
    const items = annots.filter((a: PdfAnnotationObject) => a.type !== PdfAnnotationSubtype.POPUP);
    expect(items.every((a: PdfAnnotationObject) => (a.appearanceModes ?? 0) & 1)).toBe(true);

    const rows = summaryRows(annots, () => ({ width: 612, height: 792 }));
    expect(rows.map((r) => [r.type, r.name])).toEqual(
      expect.arrayContaining([
        ["PdflyerTickmark", "A (Letter Connectors)"],
        ["PdflyerTickmark", "2 (Connectors)"],
        ["PdflyerTickmark", "Agrees to General Ledger"],
        ["PdflyerTape", "Calculator tape"],
        ["PdflyerNote", "Sticky note"],
        ["TextBox", "Text box"],
        ["Stamp", "Reviewed"],
      ]),
    );
    expect(rows).toHaveLength(PDFLYER_SAMPLE.tickmarks.length + 4);
    expect(rows.filter((r) => r.offPage).map((r) => r.type)).toEqual(["PdflyerNote"]);
    expect(rows.find((r) => r.name.startsWith("2 "))?.meaning).toBe("Ties to schedule 2");
    expect(summaryCsv(rows, (d) => d.toISOString())).toContain("PDFlyer note,Sticky note");
  });
});
