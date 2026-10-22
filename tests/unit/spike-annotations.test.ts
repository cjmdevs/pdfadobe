// Phase 0 spike step b: image stamp + free text, Save As, verify with independent readers.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, qpdfBin } from "../corpus/generate.mjs";
import { decompressedBytes, pdfjsView } from "../helpers/leak-scan";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import type { Engine } from "../../src/engine/pdfium";
import { addFreeText, addImageStamp, save } from "../../src/engine/spike";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";

const OUT = join(OUT_DIR, "..", "out");
const NOTE = "Tied to TB without exception. Ref W/P A-1.";
let engine: Engine;
let saved: Uint8Array;
let original: Uint8Array;

beforeAll(async () => {
  engine = await nodeEngine();
  original = new Uint8Array(readFileSync(join(OUT_DIR, "text-1p.pdf")));
  const png = toArrayBuffer(readFileSync(join(OUT_DIR, "stamp-reviewed.png")));
  const doc = await engine
    .openDocumentBuffer({ id: "anno", content: toArrayBuffer(original) })
    .toPromise();
  await addImageStamp(
    engine,
    doc,
    0,
    { origin: { x: 400, y: 40 }, size: { width: 150, height: 50 } },
    png,
  );
  await addFreeText(
    engine,
    doc,
    0,
    { origin: { x: 72, y: 600 }, size: { width: 300, height: 40 } },
    NOTE,
  );
  saved = new Uint8Array(await save(engine, doc));
  await engine.closeDocument(doc).toPromise();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "annotated.pdf"), saved);
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

describe("spike: stamp + free text annotations", () => {
  it("does not modify the input bytes (Save As writes a new buffer)", () => {
    expect(Buffer.compare(Buffer.from(original), readFileSync(join(OUT_DIR, "text-1p.pdf")))).toBe(
      0,
    );
    expect(saved.byteLength).toBeGreaterThan(original.byteLength);
  });

  it("output is structurally valid per qpdf", () => {
    const tmp = join(OUT, "annotated-check.pdf");
    writeFileSync(tmp, saved);
    expect(() => execFileSync(qpdfBin(), ["--check", tmp], { stdio: "pipe" })).not.toThrow();
  });

  it("pdf.js sees a Stamp and a FreeText annotation with the note text", async () => {
    const v = await pdfjsView(saved);
    const types = v.annotations.map((a) => a.subtype).sort();
    expect(types).toEqual(["FreeText", "Stamp"]);
    expect(v.annotations.flatMap((a) => a.strings).join(" ")).toContain(NOTE);
  });

  it("both annotations carry an appearance stream (/AP), so Acrobat can render them", () => {
    const raw = decompressedBytes(saved).toString("latin1");
    for (const subtype of ["/Stamp", "/FreeText"]) {
      const obj = raw.split(/\n(?=\d+ 0 obj)/).find((o) => o.includes(`/Subtype ${subtype}`));
      expect(obj, subtype).toBeDefined();
      expect(obj!.includes("/AP"), `${subtype} has /AP`).toBe(true);
    }
  });

  it("round-trips through PDFium", async () => {
    const doc = await engine
      .openDocumentBuffer({ id: "rt", content: toArrayBuffer(saved) })
      .toPromise();
    const annos: PdfAnnotationObject[] = await engine
      .getPageAnnotations(doc, doc.pages[0]!)
      .toPromise();
    expect(annos.map((a) => a.type).sort((a, b) => a - b)).toEqual(
      [PdfAnnotationSubtype.FREETEXT, PdfAnnotationSubtype.STAMP].sort((a, b) => a - b),
    );
  });
});
