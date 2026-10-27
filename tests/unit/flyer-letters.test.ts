// Owner feedback 2026-10-27: letter/number tickmarks keep their value, and matching ones
// link to each other (in Acrobat too: a /Link over each to the next one).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfStampAnnoObject,
} from "@embedpdf/models";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { inspectAnnots } from "../helpers/annot-inspect";
import type { Engine } from "../../src/engine/pdfium";
import { BUILT_IN_TICKMARKS, drawTickmark } from "../../src/engine/flyer/tickmarks";
import { nextLinked, tickLinkChanges } from "../../src/flyer/tickLinks";
import { sectionPicks } from "../../src/flyer/sections";
import { mergeLibrary } from "../../src/flyer/library";

const letter = BUILT_IN_TICKMARKS.find((d) => d.id === "letter")!;
const tick = (id: string, page: number, y: number, label: string): PdfStampAnnoObject => ({
  type: PdfAnnotationSubtype.STAMP,
  id,
  pageIndex: page,
  rect: { origin: { x: 100, y }, size: { width: 20, height: 20 } },
  subject: `Tickmark: Letter (${label})`,
  flags: ["print"],
  custom: { pwType: "Tickmark", pwTick: "letter", pwLabel: label, pwLink: true },
});

describe("sections", () => {
  it("the Letters section offers A-Z and the counting letters", () => {
    const letters = sectionPicks(mergeLibrary([], [])).find((s) => s.id === "letters")!;
    expect(letters.picks.slice(0, 3).map((p) => p.ref)).toEqual([
      "letter:A",
      "letter:B",
      "letter:C",
    ]);
    expect(letters.picks.at(-1)?.ref).toBe("letters");
  });
});

describe("matching letters link", () => {
  const annots: PdfAnnotationObject[] = [
    tick("a1", 0, 100, "A"),
    tick("a2", 1, 50, "A"),
    tick("a3", 0, 300, "A"),
    tick("b1", 0, 200, "B"),
  ];
  it("each A links to the next A in page order, the last back to the first; a lone B has none", () => {
    const { create, remove } = tickLinkChanges(annots, () => 792);
    expect(remove).toEqual([]);
    const pairs = create.map((l) => {
      const c = l.custom as { pwOf: string; pwNext: string };
      return `${c.pwOf}>${c.pwNext}`;
    });
    expect(pairs.sort()).toEqual(["a1>a3", "a2>a1", "a3>a2"]);
    expect(nextLinked(annots, annots[0]!)?.id).toBe("a3");
    // Applied: nothing more to do.
    const after = [...annots, ...create];
    expect(tickLinkChanges(after, () => 792)).toEqual({ create: [], remove: [] });
    // One A deleted: its link goes, and the A that pointed at it now points past it
    // (a2 > a1 is unchanged and stays).
    const fewer = after.filter((a) => a.id !== "a3");
    const redo = tickLinkChanges(fewer, () => 792);
    expect(redo.create.map((l) => (l.custom as { pwOf: string }).pwOf)).toEqual(["a1"]);
    expect(redo.remove).toHaveLength(2);
  });
});

describe("links in the saved file", () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await nodeEngine();
  });
  afterAll(async () => {
    await engine.closeAllDocuments().toPromise();
  });

  it("qpdf sees a GoTo /Link over each matching letter, to the other page", async () => {
    const doc = await engine
      .openDocumentBuffer({
        id: "letters",
        content: toArrayBuffer(readFileSync(join(OUT_DIR, "workpaper-a.pdf"))),
      })
      .toPromise();
    const art = await drawTickmark(letter, "A");
    const placed = [tick("x1", 0, 200, "A"), tick("x2", 1, 200, "A")];
    for (const a of placed)
      await engine
        .createPageAnnotation(doc, doc.pages[a.pageIndex]!, a, {
          data: toArrayBuffer(art.pdf),
          mimeType: "application/pdf",
        })
        .toPromise();
    for (const l of tickLinkChanges(placed, () => 792).create)
      await engine.createPageAnnotation(doc, doc.pages[l.pageIndex]!, l).toPromise();
    const saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    const links = inspectAnnots(saved).filter((a) => a.subtype === "/Link");
    expect(links.map((l) => l.page).sort()).toEqual([0, 1]);
    // A GoTo action (an indirect object).
    for (const l of links) expect(l.dict["/A"]).toBeDefined();
  });
});
