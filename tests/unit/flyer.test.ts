// Phase 4 stage 1: every tickmark kind and a legend are placed, saved and reopened; the
// reopened document still knows them (Stamp Summary of a previous session), and qpdf
// (no PDFium code) sees standard /Stamp annotations with appearances and our tag.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfDocumentObject } from "@embedpdf/models";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { inspectAnnots, type RawAnnot } from "../helpers/annot-inspect";
import type { Engine } from "../../src/engine/pdfium";
import {
  BUILT_IN_TICKMARKS,
  drawLegend,
  drawTickmark,
  toBase64,
  type TickmarkDef,
} from "../../src/engine/flyer/tickmarks";
import { nextSequence, summaryCsv, summaryRows, tickmarkSubject } from "../../src/flyer/items";
import { makeWorkpaperFile, mergeLibrary, parseWorkpaperFile } from "../../src/flyer/library";

let engine: Engine;
let reopened: PdfDocumentObject;
let raw: RawAnnot[];

const png = readFileSync(join(OUT_DIR, "stamp-reviewed.png"));
const imageTick: TickmarkDef = {
  id: "my.logo",
  name: "Logo",
  meaning: "Firm logo",
  color: "#000000",
  size: 20,
  image: { mime: "image/png", data: toBase64(png) },
};
const letters = BUILT_IN_TICKMARKS.find((d) => d.sequence === "letters")!;
const placed: { def: TickmarkDef; label?: string }[] = [
  ...BUILT_IN_TICKMARKS.filter((d) => !d.sequence).map((def) => ({ def })),
  { def: letters, label: "A" },
  { def: letters, label: "B" },
  { def: imageTick },
];

beforeAll(async () => {
  engine = await nodeEngine();
  const doc = await engine
    .openDocumentBuffer({
      id: "flyer",
      content: toArrayBuffer(readFileSync(join(OUT_DIR, "text-1p.pdf"))),
    })
    .toPromise();
  const page = doc.pages[0]!;
  for (const [i, p] of placed.entries()) {
    const art = await drawTickmark(p.def, p.label);
    await engine
      .createPageAnnotation(
        doc,
        page,
        {
          type: PdfAnnotationSubtype.STAMP,
          id: `t${i}`,
          pageIndex: 0,
          rect: {
            origin: { x: 60, y: 60 + i * 30 },
            size: { width: art.width, height: art.height },
          },
          subject: tickmarkSubject(p.def, p.label),
          contents: p.def.meaning,
          author: "Test Preparer",
          flags: ["print"],
          custom: {
            pwType: "Tickmark",
            pwTick: p.def.id,
            ...(p.label ? { pwLabel: p.label } : {}),
          },
        },
        { data: toArrayBuffer(art.pdf), mimeType: "application/pdf" },
      )
      .toPromise();
  }
  const legend = await drawLegend(placed.map((p) => ({ ...p, meaning: p.def.meaning })));
  await engine
    .createPageAnnotation(
      doc,
      page,
      {
        type: PdfAnnotationSubtype.STAMP,
        id: "legend",
        pageIndex: 0,
        rect: { origin: { x: 300, y: 60 }, size: { width: legend.width, height: legend.height } },
        subject: "Tickmark legend",
        author: "Test Preparer",
        flags: ["print"],
        custom: { pwType: "Legend" },
      },
      { data: toArrayBuffer(legend.pdf), mimeType: "application/pdf" },
    )
    .toPromise();
  const saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
  await engine.closeDocument(doc).toPromise();
  // Kept for the Acrobat check (docs/testing/phase-04-stage1-test-guide.md).
  mkdirSync(join(OUT_DIR, "..", "out"), { recursive: true });
  writeFileSync(join(OUT_DIR, "..", "out", "tickmarks-all.pdf"), saved);
  raw = inspectAnnots(saved);
  // "Previous session": a fresh open of the saved bytes.
  reopened = await engine
    .openDocumentBuffer({ id: "flyer-again", content: toArrayBuffer(saved) })
    .toPromise();
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

describe("tickmarks after save and reopen", () => {
  it("Stamp Summary finds every item placed in the previous session", async () => {
    const annots = await engine.getPageAnnotations(reopened, reopened.pages[0]!).toPromise();
    const rows = summaryRows(annots);
    expect(rows.filter((r) => r.type === "Tickmark")).toHaveLength(placed.length);
    expect(rows.filter((r) => r.type === "Legend")).toHaveLength(1);
    expect(rows.map((r) => r.name)).toContain("Footed");
    expect(rows.map((r) => r.name)).toContain("Letters counting up (A, B, C...) (B)");
    // Counting goes on where the last session stopped.
    expect(nextSequence(letters, annots)).toBe(3);
    const csv = summaryCsv(rows, (d) => d.toISOString());
    expect(csv.split("\r\n")[0]).toBe("Page,Type,Name,Meaning,Author,Date,X (pt),Y (pt),Off page");
    expect(csv).toContain("1,Tickmark,Footed,Footed,Test Preparer,");
  });

  it("each is a standard /Stamp with an appearance, Subject and our tag (qpdf)", () => {
    expect(raw).toHaveLength(placed.length + 1);
    for (const a of raw) {
      expect(a.subtype).toBe("/Stamp");
      expect(a.hasAppearance).toBe(true);
      expect(a.subject).toMatch(/^Tickmark/);
      expect(JSON.stringify(a.dict["/EPDFCustom"])).toMatch(/pwType/);
    }
  });
});

describe("workpaper settings file", () => {
  it("round-trips and rejects other files", () => {
    const file = makeWorkpaperFile([imageTick]);
    expect(parseWorkpaperFile(JSON.stringify(file)).tickmarks).toEqual([imageTick]);
    expect(() => parseWorkpaperFile("{}")).toThrow(/not a PDF Workbench/);
  });

  it("firm and personal tickmarks follow the built-in set; same id replaces", () => {
    const firmFooted = { ...BUILT_IN_TICKMARKS[9]!, color: "#0000FF" };
    const lib = mergeLibrary([firmFooted], [imageTick]);
    expect(lib).toHaveLength(BUILT_IN_TICKMARKS.length + 1);
    expect(lib.find((e) => e.def.id === firmFooted.id)?.source).toBe("firm");
    expect(lib.at(-1)?.source).toBe("mine");
  });
});
