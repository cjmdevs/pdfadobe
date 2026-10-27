// Phase 4 stage 2: a connector between two tickmarks, a sign-off stamp, an initials stamp
// and a workpaper note are saved and reopened; the reopened document still lists them,
// the connector still knows its ends, and qpdf sees standard /Line, /Stamp and /FreeText.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfStampAnnoObject,
} from "@embedpdf/models";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { inspectAnnots, type RawAnnot } from "../helpers/annot-inspect";
import type { Engine } from "../../src/engine/pdfium";
import { BUILT_IN_TICKMARKS, drawTickmark } from "../../src/engine/flyer/tickmarks";
import { BUILT_IN_STAMPS, drawUserStamp, stampLines } from "../../src/engine/flyer/userStamps";
import {
  CONNECTOR_STYLES,
  connectorLook,
  lineRect,
  reroutes,
  route,
} from "../../src/flyer/connectors";
import { noteRows, summaryRows } from "../../src/flyer/items";
import { makeWorkpaperFile, parseWorkpaperFile } from "../../src/flyer/library";

let engine: Engine;
let annots: PdfAnnotationObject[];
let raw: RawAnnot[];

const values = {
  name: "Test Preparer",
  initials: "TP",
  date: "10/27/2026",
  time: "2:00 PM",
  ref: "A-1",
  fields: {},
};

beforeAll(async () => {
  engine = await nodeEngine();
  const doc = await engine
    .openDocumentBuffer({
      id: "stage2",
      content: toArrayBuffer(readFileSync(join(OUT_DIR, "text-1p.pdf"))),
    })
    .toPromise();
  const page = doc.pages[0]!;
  const add = (a: PdfAnnotationObject, pdf?: Uint8Array) =>
    (pdf
      ? engine.createPageAnnotation(doc, page, a as PdfStampAnnoObject, {
          data: toArrayBuffer(pdf),
          mimeType: "application/pdf" as const,
        })
      : engine.createPageAnnotation(doc, page, a)
    ).toPromise();
  const footed = BUILT_IN_TICKMARKS.find((d) => d.id === "footed")!;
  const tick = await drawTickmark(footed);
  const at = (x: number, y: number) => ({
    origin: { x, y },
    size: { width: tick.width, height: tick.height },
  });
  for (const [id, x, y] of [
    ["a", 100, 100],
    ["b", 300, 200],
  ] as const)
    await add(
      {
        type: PdfAnnotationSubtype.STAMP,
        id,
        pageIndex: 0,
        rect: at(x, y),
        subject: "Tickmark: Footed",
        flags: ["print"],
        custom: { pwType: "Tickmark", pwTick: "footed" },
      },
      tick.pdf,
    );
  const r = route(at(100, 100), at(300, 200));
  await add({
    type: PdfAnnotationSubtype.LINE,
    id: "conn",
    pageIndex: 0,
    rect: lineRect(r.start, r.end),
    linePoints: r,
    ...connectorLook(CONNECTOR_STYLES[0]!),
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
    subject: "Connector",
    author: "Test Preparer",
    flags: ["print"],
    custom: { pwType: "Connector", pwFrom: "a", pwTo: "b" },
  } as PdfAnnotationObject);
  for (const t of [BUILT_IN_STAMPS[0]!, BUILT_IN_STAMPS[3]!]) {
    const art = await drawUserStamp(t, values);
    await add(
      {
        type: PdfAnnotationSubtype.STAMP,
        id: t.id,
        pageIndex: 0,
        rect: {
          origin: { x: t.kind === "user" ? 300 : 72, y: 400 },
          size: { width: art.width, height: art.height },
        },
        subject: t.title,
        contents: stampLines(t, values).join("; "),
        author: "Test Preparer",
        flags: ["print"],
        custom: { pwType: t.kind === "user" ? "UserStamp" : "StatusStamp", pwStamp: t.id },
      },
      art.pdf,
    );
  }
  await add({
    type: PdfAnnotationSubtype.FREETEXT,
    id: "note",
    pageIndex: 0,
    rect: { origin: { x: 72, y: 500 }, size: { width: 200, height: 40 } },
    contents: "Agreed to bank confirmation.",
    fontSize: 10,
    fontColor: "#000000",
    color: "#FFF6BF",
    author: "Test Preparer",
    flags: ["print"],
    custom: { pwType: "Note" },
  } as PdfAnnotationObject);
  const saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
  await engine.closeDocument(doc).toPromise();
  // Kept for the Acrobat check (docs/testing/phase-04-stage2-test-guide.md).
  mkdirSync(join(OUT_DIR, "..", "out"), { recursive: true });
  writeFileSync(join(OUT_DIR, "..", "out", "workpaper-stage2.pdf"), saved);
  raw = inspectAnnots(saved);
  const again = await engine
    .openDocumentBuffer({ id: "stage2-again", content: toArrayBuffer(saved) })
    .toPromise();
  annots = await engine.getPageAnnotations(again, again.pages[0]!).toPromise();
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

describe("stage 2 items after save and reopen", () => {
  it("Stamp Summary lists connector and stamps; the Notes list has the note", () => {
    const rows = summaryRows(annots);
    expect(rows.map((r) => `${r.type}:${r.name}`).sort()).toEqual([
      "Connector:Connector",
      "StatusStamp:Prepared by",
      "Tickmark:Footed",
      "Tickmark:Footed",
      "UserStamp:Initials",
    ]);
    expect(rows.find((r) => r.type === "StatusStamp")?.meaning).toBe(
      "Test Preparer (TP); 10/27/2026 2:00 PM; W/P ref: A-1",
    );
    expect(noteRows(annots).map((n) => n.text)).toEqual(["Agreed to bank confirmation."]);
  });

  it("the connector stays attached: moving a tickmark re-routes it", () => {
    expect(reroutes(annots).update).toEqual([]);
    const moved = annots.map((a) =>
      a.id === "b" ? { ...a, rect: { ...a.rect, origin: { x: 400, y: 50 } } } : a,
    );
    const { update } = reroutes(moved);
    expect(update.map((u) => u.id)).toEqual(["conn"]);
  });

  it("qpdf sees a /Line, /Stamps with appearances and a /FreeText", () => {
    const types = raw.map((a) => a.subtype).sort();
    expect(types).toEqual(["/FreeText", "/Line", "/Stamp", "/Stamp", "/Stamp", "/Stamp"]);
    expect(raw.find((a) => a.subtype === "/Line")?.hasAppearance).toBe(true);
    for (const a of raw) expect(JSON.stringify(a.dict["/EPDFCustom"])).toMatch(/pwType/);
  });

  it("the settings file carries stamp templates (stage 1 files still read)", () => {
    const mine = {
      ...BUILT_IN_STAMPS[0]!,
      id: "my.partner",
      title: "Partner review",
      fields: ["Client no."],
    };
    expect(parseWorkpaperFile(JSON.stringify(makeWorkpaperFile([], [mine]))).stamps).toEqual([
      mine,
    ]);
    const old = { format: "pdf-workbench-workpaper", version: 1, tickmarks: [] };
    expect(parseWorkpaperFile(JSON.stringify(old)).stamps).toEqual([]);
  });
});
