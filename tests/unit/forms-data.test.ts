// Phase 6 form data files: FDF, XFDF, JSON, CSV writers and readers, and a round trip
// (fill a corpus form, export, import into the blank form, same values) for each.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import type { PagesCtx } from "../../src/engine/pages";
import {
  FormDataError,
  copyFileName,
  looksSensitive,
  csvRowValues,
  fillForm,
  formValues,
  parseCsv,
  parseFdf,
  parseFormData,
  parseJsonFields,
  parseXfdfFields,
  readFields,
  toCsv,
  toFdf,
  toJson,
  toXfdf,
  valuesOf,
  type DataFormat,
  type FieldValues,
  type FormField,
} from "../../src/engine/forms";

let ctx: PagesCtx;
beforeAll(async () => {
  ctx = await nodePagesCtx();
});

const enc = (s: string) => new TextEncoder().encode(s);

async function fieldsOf(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await ctx.engine
    .openDocumentBuffer({ id: crypto.randomUUID(), content: bytes.slice().buffer })
    .toPromise();
  try {
    return await readFields(ctx.engine, doc);
  } finally {
    await ctx.engine.closeDocument(doc).toPromise();
  }
}

describe("FDF", () => {
  it("round-trips nested names, brackets, parentheses, non-ASCII and button names", async () => {
    const values = {
      "topmostSubform[0].Page1[0].f1_01[0]": "Jane (Sample) \\ O'Neil",
      "topmostSubform[0].Page1[0].c1_1[0]": "1",
      "a.b": "Zoë – 100 €",
      plain: "",
    };
    const fdf = toFdf(values, new Set(["topmostSubform[0].Page1[0].c1_1[0]"]), "f1040.pdf");
    expect(fdf.startsWith("%FDF-1.2")).toBe(true);
    expect(fdf).toContain("/V /1");
    expect(await parseFdf(enc(fdf))).toEqual(values);
  });

  it("reads Acrobat-style FDF with indirect field objects and hex strings", async () => {
    const fdf = [
      "%FDF-1.2",
      "1 0 obj << /FDF << /Fields [ 2 0 R ] >> >> endobj",
      "2 0 obj << /T (client) /Kids [ << /T (name) /V <FEFF004A0061006E0065> >> << /T (ok) /V /Yes >> ] >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");
    expect(await parseFdf(enc(fdf))).toEqual({ "client.name": "Jane", "client.ok": "Yes" });
  });

  it("refuses files that are not FDF", async () => {
    await expect(parseFdf(enc("%PDF-1.7\n"))).rejects.toBeInstanceOf(FormDataError);
  });
});

describe("XFDF", () => {
  it("round-trips nested names and XML special characters", () => {
    const values = { "a.b.c": 'x < y & "z"', d: "plain", e: "" };
    expect(parseXfdfFields(toXfdf(values, "x.pdf"))).toEqual(values);
  });
  it("reads a flat Acrobat XFDF", () => {
    const xml =
      '<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><fields>' +
      '<field name="name"><value>Jane</value></field>' +
      '<field name="status"><value>mfj</value></field></fields></xfdf>';
    expect(parseXfdfFields(xml)).toEqual({ name: "Jane", status: "mfj" });
  });
});

describe("JSON", () => {
  it("round-trips our export and accepts a plain object", () => {
    const values = { a: "1", "b.c": "two" };
    expect(parseJsonFields(toJson(values, "x.pdf"))).toEqual(values);
    expect(parseJsonFields('{"a": 5, "b": true, "c": null}')).toEqual({ a: "5", b: "Yes" });
  });
  it("refuses nested values", () => {
    expect(() => parseJsonFields('{"a": {"b": 1}}')).toThrow(FormDataError);
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas, line breaks and leading zeros", () => {
    const names = ["name", "notes", "zip"];
    const rows = [
      { name: 'Jane "J" Doe', notes: "a, b\r\nc", zip: "01234" },
      { name: "Bob", notes: "", zip: "99999" },
    ];
    const csv = toCsv(names, rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const t = parseCsv(csv);
    expect(t.names).toEqual(names);
    expect(csvRowValues(t, 0)).toEqual(rows[0]);
    // An empty cell leaves its field alone.
    expect(csvRowValues(t, 1)).toEqual({ name: "Bob", zip: "99999" });
  });
  it("reads semicolon and tab files and skips blank lines", () => {
    expect(parseCsv("a;b\n1;2\n\n3;4\n").rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseCsv("a\tb\r\nx\ty\r\n").rows).toEqual([["x", "y"]]);
  });
  it("refuses a duplicate or empty header", () => {
    expect(() => parseCsv("a,a\n1,2")).toThrow(/twice/);
    expect(() => parseCsv("a,,b\n1,2,3")).toThrow(/no name/);
    expect(() => parseCsv('a\n"open')).toThrow(/quote/);
  });
});

const FORMS = [
  ["acroform", join(OUT_DIR, "acroform.pdf")],
  ["f1040", join(OUT_DIR, "..", "irs", "f1040.pdf")],
] as const;
const FORMATS: DataFormat[] = ["fdf", "xfdf", "json", "csv"];

describe.each(FORMS)("export, then import into the blank form: %s", (_label, path) => {
  let blank: Uint8Array;
  let filled: Uint8Array;
  let expected: FieldValues;
  let fields: FormField[];

  beforeAll(async () => {
    blank = new Uint8Array(readFileSync(path));
    const blankFields = await fieldsOf(blank);
    const values: FieldValues = {};
    blankFields.forEach((f, i) => {
      if (f.readOnly) return;
      if (f.kind === "text") values[f.name] = `V${i}`.slice(0, f.maxLen ?? 99);
      else if (f.options.length) values[f.name] = f.options[f.options.length - 1]!;
    });
    filled = (await fillForm(ctx.engine, blank, values)).bytes;
    fields = await fieldsOf(filled);
    expected = await formValues(ctx.engine, filled);
  });

  it.each(FORMATS)("%s", async (format) => {
    const buttons = new Set(
      fields.filter((f) => f.kind === "checkbox" || f.kind === "radio").map((f) => f.name),
    );
    const raw = valuesOf(fields, format === "fdf" || format === "xfdf" ? "raw" : "label");
    const text =
      format === "fdf"
        ? toFdf(raw, buttons, "form.pdf")
        : format === "xfdf"
          ? toXfdf(raw, "form.pdf")
          : format === "json"
            ? toJson(raw, "form.pdf")
            : toCsv(Object.keys(raw), [raw]);
    const [row] = await parseFormData(enc(text), format);
    const imported = await fillForm(ctx.engine, blank, row!);
    expect(imported.unknown).toEqual([]);
    expect(imported.skipped).toEqual([]);
    const got = await formValues(ctx.engine, imported.bytes);
    for (const [k, v] of Object.entries(expected)) expect.soft(got[k], k).toBe(v);
  });
});

describe("fill from CSV helpers", () => {
  it("flags SSN and EIN columns", () => {
    expect(looksSensitive(["Alpha", "000-12-3456"])).toBe(true);
    expect(looksSensitive(["12-3456789"])).toBe(true);
    expect(looksSensitive(["Alpha One", "2024", "01234"])).toBe(false);
  });
  it("names copies by column or by row number, safe for Windows", () => {
    expect(copyFileName("f1040", 0, 3, "Jane: Doe?")).toBe("f1040 - Jane Doe.pdf");
    expect(copyFileName("f1040", 4, 12)).toBe("f1040 - 005.pdf");
    expect(copyFileName("f1040", 1, 3, "  ")).toBe("f1040 - 002.pdf");
    expect(copyFileName("f1040", 0, 1, "trailing dots...")).toBe("f1040 - trailing dots.pdf");
  });
});
