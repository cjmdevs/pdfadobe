// Phase 4 stage 3: amounts read from a page, the 10-key and standard calculators, footing
// with a variance, and a tape placed as a /Stamp that reopens with its lines.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import { inspectAnnots } from "../helpers/annot-inspect";
import { createPdfium, type Engine } from "../../src/engine/pdfium";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import { pageNumbers, parseAmount } from "../../src/engine/flyer/numbers";
import {
  DEFAULT_CALC,
  deleteLine,
  textLine,
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
import { TAPE_GREY, parseTapeText, tapeAnnotation } from "../../src/flyer/tapeRows";
import { addPdflyerKeys } from "../../src/engine/flyer/pdflyer";
import { RawDoc } from "../../src/engine/pages/raw";
import { encodePng } from "../../src/engine/pages/png";
import { renderPage } from "../helpers/edit-render";
import { nodeQpdf } from "../helpers/qpdf-node";
import type { PdfiumModule } from "../../src/engine/pdfium";

let engine: Engine;
let m: PdfiumModule;
const qpdf = nodeQpdf();

beforeAll(async () => {
  engine = await nodeEngine();
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
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

  it("PDFlyer keys: += finishes ×, memory, +/-, %, Add Line, ◇, *, GT, New Tape", () => {
    let s = keys(DEFAULT_CALC, "1", "2", "*", "3", "+");
    expect(s.acc).toBe(36);
    s = keys(DEFAULT_CALC, "5", "0", "MS", "C", "MR", "+", "MR", "M+", "MR", "+");
    expect(s.acc).toBe(150);
    s = keys(DEFAULT_CALC, "2", "0", "0", "+", "1", "0", "%", "+", "4", "Neg", "AddLine", "S");
    expect(s.tape.map((l) => `${l.op}${l.value}`)).toEqual(["+200", "+20", "#-4", "S220"]);
    s = keys(DEFAULT_CALC, "5", "+", "T", "NewTape", "7", "+", "T", "GT");
    expect(s.tape.map((l) => `${l.sec ?? 1}:${l.op}${l.value}`)).toEqual([
      "1:+5",
      "1:T5",
      "2:+7",
      "2:T7",
      "2:G12",
    ]);
    expect(display(keys(DEFAULT_CALC, "1", "000"), DEFAULT_CALC)).toBe("1000");
  });

  it("Delete Line takes a line off and works the totals out again", () => {
    const s = keys(DEFAULT_CALC, "5", "+", "7", "+", "S", "T");
    const d = deleteLine(s, 0, DEFAULT_CALC);
    expect(d.tape.map((l) => `${l.op}${l.value}`)).toEqual(["+7", "S7", "T7"]);
    expect(textLine(d, "1/2/26 9:00 AM").tape.at(-1)).toEqual({
      op: "@",
      value: 0,
      note: "1/2/26 9:00 AM",
    });
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
  it("is PDFlyer's grey free text, listed as text, that reopens with its lines", async () => {
    const doc = await engine
      .openDocumentBuffer({
        id: "tape",
        content: toArrayBuffer(readFileSync(join(OUT_DIR, "text-1p.pdf"))),
      })
      .toPromise();
    const s = keys(DEFAULT_CALC, ...digits("1234.5"), "+", ...digits("100"), "-", "T");
    const anno = tapeAnnotation(
      s.tape,
      2,
      TAPE_GREY,
      { pageIndex: 0, x: 420, y: 300, page: { width: 612, height: 792 } },
      "Test Preparer",
      "tape",
    );
    expect(anno.contents.split(/\n/)).toEqual([
      "1 - 0 |  |",
      "1 - 1 |  | 1,234.50 +",
      "1 - 2 |  |   100.00 -",
      "1 - 3 |  | 1,134.50 *",
    ]);
    await engine.createPageAnnotation(doc, doc.pages[0]!, anno).toPromise();
    const saved = await addPdflyerKeys(
      qpdf,
      new Uint8Array(await engine.saveAsCopy(doc).toPromise()),
    );
    mkdirSync(join(OUT_DIR, "..", "out"), { recursive: true });
    writeFileSync(join(OUT_DIR, "..", "out", "tape-sample.pdf"), saved);
    const raw = inspectAnnots(saved);
    expect(raw[0]?.subtype).toBe("/FreeText");
    expect(raw[0]?.hasAppearance).toBe(true);
    expect(raw[0]?.subject).toBe("Calculator Tape:PDFlyer");
    expect(raw[0]?.dict["/F"]).toBe(516);
    expect(raw[0]?.dict["/TapeData"]).toHaveLength(4);
    // A picture to look at (tests/corpus/out/tape-sample.png).
    const rd = RawDoc.open(m, saved);
    try {
      const r = renderPage(m, rd, 0, 2);
      writeFileSync(join(OUT_DIR, "..", "out", "tape-sample.png"), encodePng(r));
    } finally {
      rd.close();
    }
    const again = await engine
      .openDocumentBuffer({ id: "tape-again", content: toArrayBuffer(saved) })
      .toPromise();
    const annots = await engine.getPageAnnotations(again, again.pages[0]!).toPromise();
    expect(summaryRows(annots).map((r) => r.name)).toEqual(["Calculator tape"]);
    expect(pwData(annots[0]!)?.pwTape).toEqual(s.tape);
    expect(parseTapeText(annots[0]!.contents ?? "")).toEqual(s.tape);
  });
});
