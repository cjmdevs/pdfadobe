// Phase 5 stage 1: Search & Redact patterns and document search. All numbers are fake.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FAKE_SSN, OUT_DIR } from "../corpus/generate.mjs";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import {
  abaValid,
  findMatches,
  regexError,
  type PatternId,
} from "../../src/engine/redact/patterns";
import { pageMarks, searchDocument } from "../../src/engine/redact/search";

const require = createRequire(import.meta.url);
let m: PdfiumModule;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const found = (text: string, id: PatternId) =>
  findMatches(text, { patterns: [id] }).map((h) => text.slice(h.start, h.end));

describe("patterns", () => {
  it("SSN: dashed and spaced, not inside longer numbers, labelled 9 digits", () => {
    expect(found("SSN 000-12-3456 and 123 45 6789", "ssn")).toEqual(["000-12-3456", "123 45 6789"]);
    expect(found("ref 1234-56-78901", "ssn")).toEqual([]);
    expect(found("SSN: 000123456", "ssn")).toEqual(["000123456"]);
    expect(found("Invoice 000123456", "ssn")).toEqual([]);
  });

  it("ITIN is its own pattern, and SSN still catches it", () => {
    expect(found("ITIN 912-70-1234", "itin")).toEqual(["912-70-1234"]);
    expect(found("SSN 912-40-1234", "itin")).toEqual([]);
    expect(found("912-70-1234", "ssn")).toEqual(["912-70-1234"]);
  });

  it("EIN, routing (check digit), account after a label", () => {
    expect(found("EIN 00-0000001", "ein")).toEqual(["00-0000001"]);
    expect(abaValid("011000015")).toBe(true);
    expect(abaValid("011000016")).toBe(false);
    expect(found("Routing 011000015 and 011000016", "routing")).toEqual(["011000015"]);
    expect(found("Account No: 0001234567", "account")).toEqual(["0001234567"]);
    expect(found("Acct # ****6789", "account")).toEqual(["****6789"]);
    expect(found("Accounts receivable 120", "account")).toEqual([]);
  });

  it("phone, email, date of birth, any date", () => {
    expect(found("Call (555) 555-0100 or 555-555-0199", "phone")).toEqual([
      "(555) 555-0100",
      "555-555-0199",
    ]);
    expect(found("mail jane.doe@example.com now", "email")).toEqual(["jane.doe@example.com"]);
    expect(found("DOB: 01/02/1970, filed 04/15/2024", "dob")).toEqual(["01/02/1970"]);
    expect(found("Date of birth March 3, 1965", "dob")).toEqual(["March 3, 1965"]);
    expect(found("filed 04/15/2024 and 2024-04-15", "date")).toEqual(["04/15/2024", "2024-04-15"]);
  });

  it("literals (whitespace-flexible, case, whole word) and user regex", () => {
    const t = "Jane  Doe, JANE DOE, Janet";
    const lit = (o: object) =>
      findMatches(t, { literals: ["jane doe"], ...o }).map((h) => t.slice(h.start, h.end));
    expect(lit({})).toEqual(["Jane  Doe", "JANE DOE"]);
    expect(lit({ matchCase: true })).toEqual([]);
    expect(
      findMatches(t, { literals: ["jane"], wholeWord: true }).map((h) => t.slice(h.start, h.end)),
    ).toEqual(["Jane", "JANE"]);
    expect(regexError("a*")).toMatch(/empty/);
    expect(regexError("(")).not.toBeNull();
    expect(findMatches("ID-77 ID-78", { regexes: [{ source: "ID-\\d+" }] })).toHaveLength(2);
  });
});

describe("document search", () => {
  it("finds the SSN on both pages, split runs included, one box per hit", () => {
    const bytes = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
    const hits = searchDocument(m, bytes, { patterns: ["ssn"] });
    expect(hits.map((h) => [h.pageIndex, h.text])).toEqual([
      [0, FAKE_SSN],
      [0, FAKE_SSN],
      [1, FAKE_SSN],
    ]);
    for (const h of hits) {
      expect(h.rects).toHaveLength(1);
      const r = h.rects[0]!;
      expect(r.r - r.l).toBeGreaterThan(40);
      expect(r.t - r.b).toBeGreaterThan(8);
    }
  });

  it("a whole-page mark covers the page", () => {
    const bytes = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
    expect(pageMarks(m, bytes, [1])).toEqual([
      { kind: "page", pageIndex: 1, rects: [{ l: 0, b: 0, r: 612, t: 792 }], source: "manual" },
    ]);
  });
});
