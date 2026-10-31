// Phase 3 gate: every markup type survives save/reopen, and the saved corpus file is
// read back with qpdf (no PDFium code) to check subtype, rect, color and contents.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PdfAnnotationReplyType,
  PdfAnnotationState,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from "@embedpdf/models";
import { OUT_DIR, qpdfBin } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { pdfjsView } from "../helpers/leak-scan";
import { inspectAnnots, rgb, type RawAnnot } from "../helpers/annot-inspect";
import { AUTHOR, SAMPLES } from "../helpers/markup-samples";
import type { Engine } from "../../src/engine/pdfium";
import { TEXT_STAMPS, drawTextStamp } from "../../src/engine/stamps";
import { decompressedBytes } from "../helpers/leak-scan";

const OUT = join(OUT_DIR, "..", "out");
const MARKUP_CORPUS = join(OUT, "markup-all.pdf");

let engine: Engine;
let saved: Uint8Array;
let raw: RawAnnot[];
let pageHeight: number;
const ids = new Map<string, string>();

async function open(bytes: Uint8Array, id: string): Promise<PdfDocumentObject> {
  return engine.openDocumentBuffer({ id, content: toArrayBuffer(bytes) }).toPromise();
}

beforeAll(async () => {
  engine = await nodeEngine();
  const doc = await open(readFileSync(join(OUT_DIR, "text-1p.pdf")), "markup");
  const page = doc.pages[0]!;
  pageHeight = page.size.height;
  for (const s of SAMPLES) {
    ids.set(s.anno.id, await engine.createPageAnnotation(doc, page, s.anno).toPromise());
  }
  const png = toArrayBuffer(readFileSync(join(OUT_DIR, "stamp-reviewed.png")));
  await engine
    .createPageAnnotation(
      doc,
      page,
      {
        type: PdfAnnotationSubtype.STAMP,
        id: "stamp",
        pageIndex: 0,
        rect: { origin: { x: 400, y: 640 }, size: { width: 150, height: 50 } },
        contents: "Image stamp",
        author: AUTHOR,
        flags: ["print"],
      },
      { data: png, mimeType: "image/png" },
    )
    .toPromise();
  // A built-in text stamp: our one-page PDF becomes its appearance.
  const approved = await drawTextStamp(
    TEXT_STAMPS.find((d) => d.id === "approved")!,
    "Test Reviewer, 10/23/2026 9:00 AM",
  );
  await engine
    .createPageAnnotation(
      doc,
      page,
      {
        type: PdfAnnotationSubtype.STAMP,
        id: "text-stamp",
        pageIndex: 0,
        rect: {
          origin: { x: 72, y: 640 },
          size: { width: approved.width, height: approved.height },
        },
        contents: "Approved stamp",
        author: AUTHOR,
        subject: "Approved",
        flags: ["print"],
      },
      { data: toArrayBuffer(approved.pdf), mimeType: "application/pdf" },
    )
    .toPromise();
  // A reply thread and a review state on the sticky note.
  const note = SAMPLES.find((s) => s.anno.id === "note")!.anno;
  await engine
    .createPageAnnotation(doc, page, {
      type: PdfAnnotationSubtype.TEXT,
      id: "reply",
      pageIndex: 0,
      rect: note.rect,
      contents: "Agreed, ticked.",
      author: "Second Reviewer",
      inReplyToId: ids.get("note")!,
      replyType: PdfAnnotationReplyType.Reply,
      flags: ["print", "noView", "noZoom", "noRotate"],
    })
    .toPromise();
  await engine
    .createPageAnnotation(doc, page, {
      type: PdfAnnotationSubtype.TEXT,
      id: "state",
      pageIndex: 0,
      rect: note.rect,
      contents: "Accepted set by Second Reviewer",
      author: "Second Reviewer",
      inReplyToId: ids.get("note")!,
      replyType: PdfAnnotationReplyType.Reply,
      state: PdfAnnotationState.Accepted,
      stateModel: PdfAnnotationStateModel.Review,
      flags: ["hidden", "noView", "noZoom", "noRotate", "print"],
    })
    .toPromise();
  saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
  await engine.closeDocument(doc).toPromise();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MARKUP_CORPUS, saved);
  raw = inspectAnnots(readFileSync(MARKUP_CORPUS));
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

/** EmbedPDF rect (top-left origin) -> PDF [x0 y0 x1 y1]. */
function pdfRect(a: PdfAnnotationObject): number[] {
  const { origin: o, size: s } = a.rect;
  return [o.x, pageHeight - o.y - s.height, o.x + s.width, pageHeight - o.y];
}

function find(contents: string): RawAnnot {
  const a = raw.find((x) => x.contents === contents);
  expect(a, `annotation "${contents}" in saved file`).toBeDefined();
  return a!;
}

describe("markup round trip (Phase 3 gate)", () => {
  it("saved file is clean per qpdf --check", () => {
    expect(() =>
      execFileSync(qpdfBin(), ["--check", MARKUP_CORPUS], { stdio: "pipe" }),
    ).not.toThrow();
  });

  describe.each(SAMPLES.map((s) => [s.anno.id, s] as const))("%s", (_id, s) => {
    it("has the right subtype, contents and author", () => {
      const a = find(s.anno.contents!);
      expect(a.subtype).toBe(`/${s.subtype}`);
      expect(a.author).toBe(AUTHOR);
    });

    it("keeps its rect (within 1 pt; PDFium may pad for stroke and line endings)", () => {
      const a = find(s.anno.contents!);
      const want = pdfRect(s.anno);
      // Lines, arrows, polylines, polygons and ink get a rect computed from their points
      // plus the stroke, so only containment is meaningful there.
      if (["Line", "PolyLine", "Polygon", "Ink"].includes(s.subtype)) {
        expect(a.rect[0]).toBeLessThanOrEqual(want[2]!);
        expect(a.rect[2]).toBeGreaterThanOrEqual(want[0]!);
        return;
      }
      a.rect.forEach((v, i) => expect(Math.abs(v - want[i]!), `rect[${i}]`).toBeLessThan(1));
    });

    it("has the right color", () => {
      if (!s.color) return;
      const a = find(s.anno.contents!);
      const got = s.color.key === "C" ? a.color : a.interior;
      expect(got, `/${s.color.key}`).not.toBeNull();
      rgb(s.color.hex).forEach((v, i) => expect(Math.abs(got![i]! - v)).toBeLessThan(0.01));
    });

    it("has an appearance stream, so Acrobat draws it as we do", () => {
      expect(find(s.anno.contents!).hasAppearance).toBe(true);
    });
  });

  it("free text keeps font, size and text color in /DA", () => {
    const da = String(find("Free text box").dict["/DA"]);
    expect(da).toMatch(/12(\.0+)? Tf/);
    expect(da).toMatch(/\/Helv /);
    expect(da).toMatch(/(^|[ :])0?\.75\d* 0 0 rg/);
  });

  it("callout is a FreeTextCallout with a /CL leader line and an arrow", () => {
    const d = find("Callout: see A-1").dict;
    expect(d["/IT"]).toBe("/FreeTextCallout");
    expect(Array.isArray(d["/CL"]) && (d["/CL"] as unknown[]).length).toBe(6);
    expect(String(d["/LE"])).toContain("OpenArrow");
  });

  it("arrow has an /OpenArrow line ending", () => {
    expect(JSON.stringify(find("Arrow").dict["/LE"])).toContain("/OpenArrow");
  });

  it("cloud has a cloudy border effect (/BE /S /C)", () => {
    const be = JSON.stringify(find("Cloud").dict["/BE"]);
    expect(be).toContain('"/S":"/C"');
  });

  it("text stamp is a /Stamp whose appearance draws our title and detail line", () => {
    const a = find("Approved stamp");
    expect(a.subtype).toBe("/Stamp");
    expect(a.subject).toBe("Approved");
    expect(a.hasAppearance).toBe(true);
    // pdf-lib writes text as hex strings: <415050...> Tj.
    const raw = decompressedBytes(saved).toString("latin1").toUpperCase();
    const hex = (t: string) => Buffer.from(t, "latin1").toString("hex").toUpperCase();
    expect(raw).toContain(hex("APPROVED"));
    expect(raw).toContain(hex("Test Reviewer, 10/23/2026"));
  });

  it("image stamp is a /Stamp with an appearance", () => {
    const a = find("Image stamp");
    expect(a.subtype).toBe("/Stamp");
    expect(a.hasAppearance).toBe(true);
  });

  it("reply and review state point at the note (/IRT) with Acrobat's state keys", () => {
    const note = find("Sticky note: tie to TB");
    const reply = find("Agreed, ticked.");
    const state = find("Accepted set by Second Reviewer");
    expect(reply.dict["/IRT"]).toBe(note.ref);
    expect(state.dict["/IRT"]).toBe(note.ref);
    expect(state.dict["/StateModel"]).toBe("u:Review");
    expect(state.dict["/State"]).toBe("u:Accepted");
  });

  it("pdf.js (a second independent reader) sees every annotation and its text", async () => {
    const v = await pdfjsView(saved);
    const subtypes = v.annotations.map((a) => a.subtype);
    for (const s of SAMPLES) expect(subtypes).toContain(s.subtype);
    const strings = v.annotations.flatMap((a) => a.strings).join("\n");
    for (const s of SAMPLES) expect(strings).toContain(s.anno.contents);
  });

  it("PDFium reads every annotation back with the same type, contents and author", async () => {
    const doc = await open(saved, "reopen");
    const back: PdfAnnotationObject[] = await engine
      .getPageAnnotations(doc, doc.pages[0]!)
      .toPromise();
    await engine.closeDocument(doc).toPromise();
    for (const s of SAMPLES) {
      const a = back.find((b) => b.contents === s.anno.contents);
      expect(a, s.anno.id).toBeDefined();
      expect(a!.type).toBe(s.anno.type);
      expect(a!.author).toBe(AUTHOR);
    }
  });
});
