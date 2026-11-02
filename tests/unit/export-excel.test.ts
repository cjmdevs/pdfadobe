// B5: Export to Excel. Text lines become rows, shared gaps become columns, amounts
// become numbers. The .xlsx is checked by unzipping it (Excel itself is the owner check).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { documentXlsx } from "../../src/engine/convert";
import { pageTable, parseAmount, type TableChar } from "../../src/engine/convert/tables";
import { columnName, writeXlsx } from "../../src/engine/convert/xlsx";

const require = createRequire(import.meta.url);
let m: PdfiumModule;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

/** Characters of `text` set at x in a 10 pt monospace-ish font (6 pt per char). */
function word(text: string, x: number, y: number): TableChar[] {
  return [...text].map((ch, i) => ({ ch, y, l: x + i * 6, r: x + i * 6 + 6, size: 10 }));
}

describe("amounts", () => {
  it("reads report amounts as numbers", () => {
    expect(parseAmount("1,234.50")).toEqual({ n: 1234.5, decimals: 2 });
    expect(parseAmount("$1,234")).toEqual({ n: 1234, decimals: 0 });
    expect(parseAmount("(1,234.50)")).toEqual({ n: -1234.5, decimals: 2 });
    expect(parseAmount("1,234.50-")).toEqual({ n: -1234.5, decimals: 2 });
    expect(parseAmount("-17")).toEqual({ n: -17, decimals: 0 });
    expect(parseAmount("12.5%")).toEqual({ n: 0.125, decimals: 1, percent: true });
  });

  it("keeps codes and words as text", () => {
    for (const s of ["00123", "123456789", "1000-00", "Cash", "(12", "12.3.4", "--5"]) {
      expect(parseAmount(s)).toBeNull();
    }
    expect(parseAmount("0.50")).toEqual({ n: 0.5, decimals: 2 });
  });
});

describe("page layout", () => {
  it("puts right-aligned amounts in one column and keeps titles", () => {
    const chars = [
      ...word("Trial Balance", 50, 700),
      ...word("Cash", 50, 680),
      ...word("1,234.50", 200, 680),
      ...word("Accounts receivable", 50, 666),
      ...word("10,000.00", 194, 666),
      ...word("(500.00)", 200, 652),
      ...word("Allowance", 50, 652),
    ];
    const rows = pageTable(chars);
    expect(rows).toEqual([
      ["Trial Balance"],
      ["Cash", { n: 1234.5, decimals: 2 }],
      ["Accounts receivable", { n: 10000, decimals: 2 }],
      ["Allowance", { n: -500, decimals: 2 }],
    ]);
  });

  it("joins a separated dollar sign to its amount and keeps word spaces", () => {
    const chars = [
      ...word("Net", 50, 500),
      { ch: "i", y: 500, l: 70, r: 73, size: 10 },
      { ch: "n", y: 500, l: 73, r: 79, size: 10 },
      ...word("$", 180, 500),
      ...word("2,000", 230, 500),
      ...word("Other", 50, 486),
      ...word("15", 248, 486),
    ];
    expect(pageTable(chars)).toEqual([
      ["Net in", { n: 2000, decimals: 0 }],
      ["Other", { n: 15, decimals: 0 }],
    ]);
  });
});

describe("workbook", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("writes a valid package with numbers, styles and escaped text", () => {
    const xlsx = writeXlsx([
      { name: "Page 1", rows: [["A & B <c>", { n: -12.5, decimals: 2 }], [null, "x"]] },
      { name: "Page 1", rows: [] },
    ]);
    const files = unzipSync(xlsx);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t>A &amp; B &lt;c&gt;</t></is></c>');
    expect(sheet).toContain('<c r="B1" s="2"><v>-12.5</v></c>');
    expect(sheet).toContain('<c r="B2" t="inlineStr">');
    // Duplicate sheet names are made unique.
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('name="Page 1 2"');
  });

  it("exports a real PDF page by page", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    const rows: [string, string][] = [
      ["Cash in bank", "12,500.00"],
      ["Prepaid insurance", "1,200.00"],
      ["Accrued liabilities", "(3,450.25)"],
    ];
    page.drawText("Synthetic Co. trial balance", { x: 72, y: 720, size: 12, font });
    rows.forEach(([name, amt], i) => {
      const y = 690 - i * 16;
      page.drawText(name, { x: 72, y, size: 10, font });
      page.drawText(amt, { x: 400 - font.widthOfTextAtSize(amt, 10), y, size: 10, font });
    });
    pdf.addPage([612, 792]); // blank page: an empty sheet
    const files = unzipSync(documentXlsx(m, await pdf.save()));
    const s1 = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(s1).toContain("<t>Synthetic Co. trial balance</t>");
    expect(s1).toContain('<c r="A2" t="inlineStr"><is><t>Cash in bank</t></is></c><c r="B2" s="2"><v>12500</v></c>');
    expect(s1).toContain('<c r="B4" s="2"><v>-3450.25</v></c>');
    expect(strFromU8(files["xl/worksheets/sheet2.xml"]!)).toContain("<sheetData></sheetData>");
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('name="Page 2"');
  });
});
