// Phase 6 calculations: Acrobat's built-in formulas and simplified field notation run
// without JavaScript; numbers are stored plain under formatted appearances.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, qpdfBin } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import { pdfjsView } from "../helpers/leak-scan";
import type { PagesCtx } from "../../src/engine/pages";
import {
  customCalcs,
  displayValue,
  fillAndCalculate,
  flattenForm,
  formValues,
  formatNumber,
  parseCalc,
  parseExpr,
  readCalcSetup,
  recalculate,
  round,
  toNumber,
  type CalcSetup,
} from "../../src/engine/forms";

const OUT = join(OUT_DIR, "..", "out", "forms");
let ctx: PagesCtx;
beforeAll(async () => {
  ctx = await nodePagesCtx();
  mkdirSync(OUT, { recursive: true });
});

describe("parsing", () => {
  it("reads both AFSimple_Calculate list styles", () => {
    expect(parseCalc('AFSimple_Calculate("SUM", new Array ("A", "B.1"));')).toEqual({
      kind: "simple",
      op: "SUM",
      fields: ["A", "B.1"],
    });
    expect(parseCalc('AFSimple_Calculate("AVG", "A, B ,C");')).toMatchObject({
      op: "AVG",
      fields: ["A", "B", "C"],
    });
  });
  it("reads simplified field notation, with escaped names and precedence", () => {
    const c = parseCalc("/** BVCALC (Line\\ 1 + 2) * Rate - -3 EVCALC **/ event.value = 0;");
    expect(c.kind).toBe("sfn");
    const setup: CalcSetup = {
      order: ["X"],
      calcs: { X: c },
      formats: {},
      names: ["Line 1", "Rate", "X"],
    };
    expect(recalculate(setup, { "Line 1": "4", Rate: "0.5" })).toEqual({ X: "6" });
    expect(() => parseExpr("A +")).toThrow();
  });
  it("anything else is a custom script, never run", () => {
    expect(parseCalc('event.value = this.getField("A").value * 2;').kind).toBe("custom");
  });
});

describe("numbers", () => {
  const money = { kind: "number", decimals: 2, sep: 0, negative: 2, currency: "$" } as const;
  it("formats like AFNumber_Format", () => {
    expect(formatNumber(1234.5, money)).toBe("$1,234.50");
    expect(formatNumber(-1234.5, money)).toBe("($1,234.50)");
    expect(formatNumber(-0.004, { ...money, negative: 0 })).toBe("$0.00");
    expect(formatNumber(1234567.891, { ...money, sep: 2, currency: "" })).toBe("1.234.567,89");
    expect(formatNumber(1.005, { ...money, currency: "" })).toBe("1.01");
  });
  it("reads typed and formatted numbers back", () => {
    expect(toNumber("$1,234.50")).toBe(1234.5);
    expect(toNumber("($1,234.50)")).toBe(-1234.5);
    expect(toNumber("-12")).toBe(-12);
    expect(toNumber("")).toBe(0);
    expect(toNumber("1.234,5", { ...money, sep: 2 })).toBe(1234.5);
    expect(round(2.675, 2)).toBe(2.68);
  });
});

describe("calc-form.pdf", () => {
  let setup: CalcSetup;
  beforeAll(async () => {
    setup = await readCalcSetup(ctx, new Uint8Array(readFileSync(join(OUT_DIR, "calc-form.pdf"))));
  });

  it("reads the calculations in /CO order, the formats and the custom script", () => {
    expect(setup.order).toEqual(["Total", "Average", "Net", "Half", "Custom", "LinesTotal"]);
    expect(setup.calcs["Total"]).toMatchObject({ kind: "simple", op: "SUM" });
    expect(setup.calcs["Net"]?.kind).toBe("sfn");
    expect(customCalcs(setup)).toEqual(["Custom"]);
    expect(setup.formats["Total"]).toMatchObject({ decimals: 2, currency: "$", negative: 2 });
  });

  it("fill + calculate: raw numbers in /V, formatted text on the page", async () => {
    const r = await fillAndCalculate(
      ctx,
      new Uint8Array(readFileSync(join(OUT_DIR, "calc-form.pdf"))),
      {
        Wages: "1000",
        Interest: "234.5",
        Dividends: "1,000.25",
        Deduction: "3000",
        "Line.0": "1",
        "Line.1": "2",
        "Line.2": "3.5",
      },
    );
    expect(r.skipped).toEqual([]);
    const v = await formValues(ctx.engine, r.bytes);
    expect(v).toMatchObject({
      Wages: "1000",
      Dividends: "1000.25",
      Total: "2234.75",
      Average: "744.92",
      Net: "-765.25",
      Half: "-382.63",
      LinesTotal: "6.5",
    });
    // The custom script field is left as it was.
    expect(v["Custom"]).toBe("");
    const out = join(OUT, "calc-filled.pdf");
    writeFileSync(out, r.bytes);
    // qpdf agrees on the stored values.
    const q = JSON.parse(
      execFileSync(qpdfBin(), ["--json=2", "--json-key=acroform", out], { encoding: "utf8" }),
    ) as { acroform: { fields: { fullname: string; value: string }[] } };
    expect(q.acroform.fields.find((f) => f.fullname === "Total")?.value).toBe("u:2234.75");
    // What the fields show (flattened, read as page text by pdf.js).
    const text = (await pdfjsView((await flattenForm(ctx, r.bytes)).bytes)).pageText.join(" ");
    for (const shown of ["1,000.00", "$2,234.75", "744.92", "($765.25)", "6.50"])
      expect.soft(text, shown).toContain(shown);
  });
});

describe("display vs max length", () => {
  const setup: CalcSetup = {
    order: [],
    calcs: {},
    formats: { N: { kind: "number", decimals: 2, sep: 0, negative: 0, currency: "" } },
    names: ["N"],
    maxLens: { N: 5 },
  };
  it("keeps the plain number when the formatted text would not fit", () => {
    expect(displayValue(setup, "N", "12345")).toBe("12345");
    expect(displayValue(setup, "N", "12")).toBe("12.00");
    expect(displayValue({ ...setup, maxLens: {} }, "N", "12345")).toBe("12,345.00");
  });
});
