// Phase 3: flatten, XFDF export/import and the comment summary, on a file with every
// markup type (made here with PDFium). Results are read back with qpdf and pdf.js.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from "@embedpdf/models";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { pdfjsView } from "../helpers/leak-scan";
import { inspectAnnots } from "../helpers/annot-inspect";
import { AUTHOR, SAMPLES } from "../helpers/markup-samples";
import type { Engine } from "../../src/engine/pdfium";
import { flattenMarkup } from "../../src/engine/flatten";
import { exportXfdf, parseXfdf, pdfDate, parsePdfDate } from "../../src/engine/xfdf";
import { summarizeComments } from "../../src/engine/summary";
import { newReply, newState } from "../../src/markup/comments";

let engine: Engine;
let marked: Uint8Array;
let heights: number[];

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return engine
    .openDocumentBuffer({ id: crypto.randomUUID(), content: toArrayBuffer(bytes) })
    .toPromise();
}

async function annotsOf(bytes: Uint8Array): Promise<PdfAnnotationObject[]> {
  const doc = await open(bytes);
  try {
    const out: PdfAnnotationObject[] = [];
    for (const p of doc.pages) out.push(...(await engine.getPageAnnotations(doc, p).toPromise()));
    return out;
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}

beforeAll(async () => {
  engine = await nodeEngine();
  const doc = await open(new Uint8Array(readFileSync(join(OUT_DIR, "text-1p.pdf"))));
  const page = doc.pages[0]!;
  heights = doc.pages.map((p) => p.size.height);
  for (const s of SAMPLES) await engine.createPageAnnotation(doc, page, s.anno).toPromise();
  const note = SAMPLES.find((s) => s.anno.id === "note")!.anno;
  await engine
    .createPageAnnotation(doc, page, newReply(note, "Agreed, ticked.", "Second Reviewer"))
    .toPromise();
  await engine
    .createPageAnnotation(doc, page, newState(note, "Review", "Accepted", "Second Reviewer"))
    .toPromise();
  marked = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
  await engine.closeDocument(doc).toPromise();
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

/** Non-white pixels of page 1 rendered WITHOUT annotations (only page content). */
async function inkedPixels(bytes: Uint8Array): Promise<number> {
  const doc = await open(bytes);
  try {
    const img = await engine
      .renderPageRaw(doc, doc.pages[0]!, { scaleFactor: 0.5, withAnnotations: false })
      .toPromise();
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i]! < 230 || img.data[i + 1]! < 230 || img.data[i + 2]! < 230) n++;
    return n;
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}

describe("flatten", () => {
  it("draws the markup into the page itself (visible with annotations turned off)", async () => {
    const { bytes } = await flattenMarkup(engine, marked);
    const before = await inkedPixels(marked);
    const after = await inkedPixels(bytes);
    expect(after).toBeGreaterThan(before * 1.2);
  });

  it("whole document: no markup left, form-free page still valid, content grew", async () => {
    const { bytes, flattened } = await flattenMarkup(engine, marked);
    expect(flattened).toBe(SAMPLES.length);
    expect(inspectAnnots(bytes)).toEqual([]);
    // The drawings are now page content (bigger content stream than before).
    expect(bytes.byteLength).toBeGreaterThan(readFileSync(join(OUT_DIR, "text-1p.pdf")).byteLength);
    // The input bytes are untouched (flatten works on a copy).
    expect(inspectAnnots(marked).length).toBe(SAMPLES.length + 2);
  });

  it("selected only: the others stay as annotations", async () => {
    const { bytes, flattened } = await flattenMarkup(engine, marked, { ids: ["square", "ink"] });
    expect(flattened).toBe(2);
    const left = inspectAnnots(bytes).map((a) => a.subtype);
    expect(left).not.toContain("/Square");
    expect(left).not.toContain("/Ink");
    expect(left).toContain("/Circle");
    expect(left).toContain("/Text");
  });

  it("flattening a note removes its reply and status too", async () => {
    const { bytes } = await flattenMarkup(engine, marked, { ids: ["note"] });
    const texts = inspectAnnots(bytes).filter((a) => a.subtype === "/Text");
    expect(texts).toEqual([]);
  });
});

describe("XFDF", () => {
  let xfdf: string;
  beforeAll(async () => {
    xfdf = exportXfdf(await annotsOf(marked), heights, "text-1p.pdf");
  });

  it("is XFDF with one element per annotation, in PDF coordinates", () => {
    expect(xfdf).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xfdf).toContain('<xfdf xmlns="http://ns.adobe.com/xfdf/"');
    for (const el of [
      "highlight",
      "underline",
      "strikeout",
      "squiggly",
      "text",
      "freetext",
      "square",
      "circle",
      "line",
      "polyline",
      "polygon",
      "ink",
    ])
      expect(xfdf, el).toContain(`<${el} `);
    // The square: x 72..192, y 300..360 from the top of a 792 pt page.
    expect(xfdf).toMatch(/<square [^>]*rect="72,432,192,492"/);
    expect(xfdf).toMatch(/<polygon [^>]*style="cloudy"/);
    expect(xfdf).toMatch(/<text [^>]*state="Accepted"[^>]*statemodel="Review"/);
    expect(xfdf).toContain(`title="${AUTHOR}"`);
  });

  it("parses back to the same types, rects, colors, text and threads", async () => {
    const before = await annotsOf(marked);
    const { annotations, skipped } = parseXfdf(xfdf, heights);
    expect(skipped).toBe(0);
    expect(annotations).toHaveLength(before.length);
    for (const a of before) {
      const b = annotations.find((x) => x.id === a.id);
      expect(b, a.id).toBeDefined();
      expect(b!.type).toBe(a.type);
      expect(b!.contents ?? "").toBe(a.contents ?? "");
      expect(b!.author).toBe(a.author);
      expect(b!.inReplyToId).toBe(a.inReplyToId);
      for (const k of ["x", "y"] as const)
        expect(Math.abs(b!.rect.origin[k] - a.rect.origin[k]), `${a.id} ${k}`).toBeLessThan(0.01);
      const color = (o: PdfAnnotationObject) =>
        (o as { strokeColor?: string }).strokeColor?.toUpperCase();
      if (a.type !== PdfAnnotationSubtype.FREETEXT) expect(color(b!)).toBe(color(a));
    }
    // Replies come after their parents (created in order on import).
    const ix = (id: string) => annotations.findIndex((x) => x.id === id);
    for (const a of annotations)
      if (a.inReplyToId) expect(ix(a.inReplyToId)).toBeLessThan(ix(a.id));
  });

  it("imports into a clean copy of the file: qpdf sees the same markup", async () => {
    const doc = await open(new Uint8Array(readFileSync(join(OUT_DIR, "text-1p.pdf"))));
    for (const a of parseXfdf(xfdf, heights).annotations)
      await engine.createPageAnnotation(doc, doc.pages[a.pageIndex]!, a).toPromise();
    const out = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    await engine.closeDocument(doc).toPromise();
    const want = inspectAnnots(marked)
      .map((a) => `${a.subtype}|${a.contents}`)
      .sort();
    const got = inspectAnnots(out)
      .map((a) => `${a.subtype}|${a.contents}`)
      .sort();
    expect(got).toEqual(want);
    const ft = inspectAnnots(out).find((a) => a.contents === "Free text box")!;
    expect(String(ft.dict["/DA"])).toMatch(/\/Helv 12 Tf/);
  });

  it("rejects files that are not XFDF and skips pages the document lacks", () => {
    expect(() => parseXfdf("<html><body/></html>", heights)).toThrow(/not an XFDF/);
    expect(() => parseXfdf("not xml <<<", heights)).toThrow();
    const r = parseXfdf(
      '<xfdf><annots><square page="7" rect="0,0,10,10"/><square page="0" rect="0,0,10,10"/></annots></xfdf>',
      heights,
    );
    expect(r.skipped).toBe(1);
    expect(r.annotations).toHaveLength(1);
  });

  it("PDF dates round-trip, with and without a time zone", () => {
    const d = new Date("2026-10-23T09:05:07Z");
    expect(pdfDate(d)).toBe("D:20261023090507Z");
    expect(parsePdfDate("D:20261023090507Z")?.toISOString()).toBe(d.toISOString());
    expect(parsePdfDate("D:20261023040507-05'00'")?.toISOString()).toBe(d.toISOString());
  });
});

describe("comment summary", () => {
  it("lists every comment with author and text, and pictures the page", async () => {
    const { pdf, comments } = await summarizeComments(engine, marked, {
      fileName: "text-1p.pdf",
      formatDate: (d) => d.toISOString().slice(0, 10),
      generated: new Date("2026-10-23T12:00:00Z"),
    });
    expect(comments).toBe(SAMPLES.length);
    const v = await pdfjsView(pdf);
    const text = v.pageText.join("\n");
    expect(text).toContain("Comment summary: text-1p.pdf");
    expect(text).toContain("Page 1");
    for (const s of SAMPLES) if (s.anno.contents) expect(text).toContain(s.anno.contents);
    expect(text).toContain("Reply from Second Reviewer");
    expect(text).toContain("Status: Accepted");
    // The page picture carries the page's own text (vector copy of the page).
    expect(text).toContain("Sample Engagement Memo");
  });

  it("characters the standard fonts cannot draw do not break it", async () => {
    const doc = await open(new Uint8Array(readFileSync(join(OUT_DIR, "text-1p.pdf"))));
    await engine
      .createPageAnnotation(doc, doc.pages[0]!, {
        ...SAMPLES.find((s) => s.anno.id === "note")!.anno,
        id: "u",
        contents: "Tick ✓ → 漢字 ok",
      })
      .toPromise();
    const bytes = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    await engine.closeDocument(doc).toPromise();
    const { pdf } = await summarizeComments(engine, bytes, {
      fileName: "u.pdf",
      formatDate: (d) => d.toISOString(),
      generated: new Date(),
    });
    expect((await pdfjsView(pdf)).pageText.join(" ")).toContain("Tick ? ? ?? ok");
  });
});
