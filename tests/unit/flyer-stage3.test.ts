// Phase 4 stage 3: amounts read from a page, the 10-key and standard calculators, footing
// with a variance, and a tape placed as a /Stamp that reopens with its lines.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfStampAnnoObject } from "@embedpdf/models";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { inspectAnnots } from "../helpers/annot-inspect";
import { createPdfium, type Engine } from "../../src/engine/pdfium";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import { pageNumbers, parseAmount } from "../../src/engine/flyer/numbers";
import { drawTape } from "../../src/engine/flyer/tape";
import {
  DEFAULT_CALC,
  EMPTY_CALC,
  display,
  foot,
  footTape,
  press,
  sendAmount,
  type CalcKey,
  type CalcSettings,
  type CalcState,
} from "../../src/flyer/calc";
import { pwData, summaryRows } from "../../src/flyer/items";
import { tapeRows } from "../../src/flyer/tapeRows";

let engine: Engine;

beforeAll(async () => {
  engine = await nodeEngine();
});
afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

const keys = (cfg: CalcSettings, ...ks: CalcKey[]) =>
  ks.reduce<CalcState>((s, k) => press(s, k, cfg), EMPTY_CALC);
const digits = (n: string) => n.split("") as CalcKey[];

describe("amounts", () => {
  it("reads accountants' formats and nothing else", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("$1,234,567.89")).toBe(1234567.89);
    expect(parseAmount("(1,234.56)")).toBe(-1234.56);
    expect(parseAmount("1,234.56-")).toBe(-1234.56);
    expect(parseAmount("-12")).toBe(-12);
    expect(parseAmount("1,200.")).toBe(1200);
    for (const no of ["1,23", "10/27/2026", "Total", "1-2", "", "$"])
      expect(parseAmount(no)).toBeNull();
  });

  it("finds the amount printed on a corpus page, with its position", async () => {
    const m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))))
      .module;
    const r = pageNumbers(m, readFileSync(join(OUT_DIR, "text-1p.pdf")), 0);
    const total = r.numbers.find((n) => n.value === 1234567.89);
    expect(total?.text).toBe("$1,234,567.89");
    expect(total!.rect.r).toBeGreaterThan(total!.rect.l);
  });
});

describe("calculator", () => {
  it("10-key adds, subtracts, subtotals and totals", () => {
    const s = keys(DEFAULT_CALC, ...digits("12.5"), "+", ...digits("7.5"), "+", "3", "-", "S", "T");
    expect(s.tape.map((l) => `${l.op}${l.value}`)).toEqual(["+12.5", "+7.5", "-3", "S17", "T17"]);
    expect(s.acc).toBe(0);
    // Add mode: 1234 means 12.34; 0.1 + 0.2 shows 0.30.
    const add = { ...DEFAULT_CALC, addMode: true };
    expect(display(keys(add, "1", "2", "3", "4", "+"), add)).toBe("12.34");
    expect(display(keys(DEFAULT_CALC, ".", "1", "+", ".", "2", "+"), DEFAULT_CALC)).toBe("0.30");
  });

  it("10-key multiplies, then + adds the product", () => {
    const s = keys(DEFAULT_CALC, "1", "2", "*", "3", "=", "+");
    expect(s.acc).toBe(36);
  });

  it("standard calculator works left to right", () => {
    const std = { ...DEFAULT_CALC, mode: "standard" as const };
    const s = keys(std, "1", "2", "+", "3", "*", "2", "=");
    expect(display(s, std)).toBe("30.00");
    expect(s.tape.at(-1)).toEqual({ op: "=", value: 30 });
  });

  it("a clicked number is added (10-key) or subtracted with Shift", () => {
    let s = sendAmount(EMPTY_CALC, 100, false, DEFAULT_CALC);
    s = sendAmount(s, 40, true, DEFAULT_CALC);
    expect(s.acc).toBe(60);
  });

  it("foots a column and shows the variance", () => {
    const r = foot([100.1, 200.2, 300.3], 600.5, false);
    expect(r.sum).toBe(600.6);
    expect(r.variance).toBe(-0.1);
    expect(footTape([100.1, 200.2, 300.3], r).map((l) => l.note ?? l.op)).toEqual([
      "+",
      "+",
      "+",
      "foot",
      "total on page",
      "variance",
    ]);
  });
});

describe("tape on the page", () => {
  it("is a /Stamp with an appearance that reopens with its lines", async () => {
    const doc = await engine
      .openDocumentBuffer({
        id: "tape",
        content: toArrayBuffer(readFileSync(join(OUT_DIR, "text-1p.pdf"))),
      })
      .toPromise();
    const s = keys(DEFAULT_CALC, ...digits("1234.5"), "+", ...digits("100"), "-", "T");
    const art = await drawTape(tapeRows(s.tape, 2), "#FFFDE7");
    const anno: PdfStampAnnoObject = {
      type: PdfAnnotationSubtype.STAMP,
      id: "tape",
      pageIndex: 0,
      rect: { origin: { x: 420, y: 300 }, size: { width: art.width, height: art.height } },
      subject: "Calculator tape",
      contents: "1,234.50 +\n100.00 -\n1,134.50 T",
      author: "Test Preparer",
      flags: ["print"],
      custom: { pwType: "Tape", pwTape: s.tape },
    };
    await engine
      .createPageAnnotation(doc, doc.pages[0]!, anno, {
        data: toArrayBuffer(art.pdf),
        mimeType: "application/pdf",
      })
      .toPromise();
    const saved = new Uint8Array(await engine.saveAsCopy(doc).toPromise());
    mkdirSync(join(OUT_DIR, "..", "out"), { recursive: true });
    writeFileSync(join(OUT_DIR, "..", "out", "tape-sample.pdf"), saved);
    const raw = inspectAnnots(saved);
    expect(raw[0]?.subtype).toBe("/Stamp");
    expect(raw[0]?.hasAppearance).toBe(true);
    const again = await engine
      .openDocumentBuffer({ id: "tape-again", content: toArrayBuffer(saved) })
      .toPromise();
    const annots = await engine.getPageAnnotations(again, again.pages[0]!).toPromise();
    expect(summaryRows(annots).map((r) => r.name)).toEqual(["Calculator tape"]);
    expect(pwData(annots[0]!)?.pwTape).toEqual(s.tape);
  });
});
