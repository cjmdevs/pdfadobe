// Phase 6 forms engine: form kind, reading fields, filling by name, XFA strip on save.
// Every corpus form is filled, saved, and reopened by our engine AND by two parsers that
// share no code with it (pdf.js, qpdf). Outputs land in tests/corpus/out/forms/ for the
// owner's Acrobat round-trip.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, qpdfBin } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import type { PagesCtx } from "../../src/engine/pages";
import {
  fillForm,
  finishFormSave,
  formKind,
  formValues,
  missingRequired,
  planFill,
  readFields,
  type FieldValues,
  type FormField,
} from "../../src/engine/forms";

const OUT = join(OUT_DIR, "..", "out", "forms");
const IRS = join(OUT_DIR, "..", "irs");
let ctx: PagesCtx;

beforeAll(async () => {
  ctx = await nodePagesCtx();
  mkdirSync(OUT, { recursive: true });
});

const read = (path: string) => new Uint8Array(readFileSync(path));

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

/** A value for every fillable field: short text within max length, a non-default choice. */
function sampleValues(fields: FormField[]): FieldValues {
  const out: FieldValues = {};
  fields.forEach((f, i) => {
    if (f.readOnly) return;
    if (f.kind === "text") out[f.name] = `V${i}`.slice(0, f.maxLen ?? 99);
    else if (f.kind === "checkbox") out[f.name] = f.options[0] ?? "Yes";
    else if ((f.kind === "radio" || f.kind === "dropdown" || f.kind === "list") && f.options.length)
      out[f.name] = f.options[f.options.length - 1]!;
  });
  return out;
}

/** The value pdf.js reads for each field name (first widget that has one). */
async function pdfjsValues(bytes: Uint8Array): Promise<Record<string, string>> {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const objs = (await pdf.getFieldObjects()) as Map<string, { value?: unknown }[]> | null;
  const out: Record<string, string> = {};
  for (const [name, list] of objs ?? []) {
    const v = list.find((o) => o.value !== undefined && o.value !== null)?.value;
    if (v !== undefined) out[name] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  await task.destroy();
  return out;
}

/** The value qpdf reads for each field ("u:" text and "/" names unwrapped). */
function qpdfValues(path: string): Record<string, string> {
  const json = JSON.parse(
    execFileSync(qpdfBin(), ["--json=2", "--json-key=acroform", path], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as { acroform: { fields: { fullname: string; value: unknown }[] } };
  const out: Record<string, string> = {};
  for (const f of json.acroform.fields) {
    if (typeof f.value === "string") out[f.fullname] = f.value.replace(/^u:|^\//, "");
  }
  return out;
}

function xfaPresent(path: string): { xfa: boolean; perms: boolean } {
  const s = execFileSync(qpdfBin(), ["--qdf", "--object-streams=disable", path, "-"], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString("latin1");
  return { xfa: /\/XFA\s/.test(s), perms: /\/Perms\s/.test(s) };
}

describe("formKind", () => {
  it.each([
    ["generated/text-1p.pdf", "none"],
    ["generated/acroform.pdf", "acroform"],
    ["generated/xfa-only.pdf", "xfa-only"],
    ["irs/f1040.pdf", "hybrid"],
    ["irs/fw9.pdf", "hybrid"],
    ["irs/f8879.pdf", "hybrid"],
  ])("%s is %s", (file, kind) => {
    expect(formKind(ctx.module, read(join(OUT_DIR, "..", file)))).toBe(kind);
  });
});

describe("readFields", () => {
  it("reads every kind in the synthetic AcroForm", async () => {
    const fields = await fieldsOf(read(join(OUT_DIR, "acroform.pdf")));
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName["taxpayer.name"]?.kind).toBe("text");
    expect(byName["tax.year"]).toMatchObject({
      kind: "dropdown",
      options: ["2023", "2024", "2025"],
    });
    expect(byName["filing.status"]).toMatchObject({ kind: "radio", value: "Off" });
    expect(byName["filing.status"]?.options).toEqual(["single", "mfj", "mfs"]);
    expect(byName["filing.status"]?.widgets).toHaveLength(3);
    expect(byName["signed.8879"]).toMatchObject({ kind: "checkbox", value: "Off" });
    expect(byName["notes"]).toMatchObject({ kind: "text", multiline: true });
  });

  it("missingRequired lists empty required fields only", () => {
    const f = (name: string, value: string, required: boolean): FormField => ({
      name,
      kind: "text",
      value,
      options: [],
      required,
      readOnly: false,
      multiline: false,
      widgets: [],
    });
    expect(missingRequired([f("a", "", true), f("b", "x", true), f("c", "", false)])).toEqual([
      "a",
    ]);
  });
});

describe("planFill", () => {
  const base: FormField = {
    name: "f",
    kind: "text",
    value: "",
    options: [],
    required: false,
    readOnly: false,
    multiline: false,
    widgets: [{ id: "w", pageIndex: 0 }],
  };
  it("skips text longer than max length instead of cutting it", () => {
    expect(planFill({ ...base, maxLen: 3 }, "1234")).toEqual({ skip: "too-long" });
  });
  it("matches choices without regard to case, and refuses unknown ones", () => {
    const dd: FormField = { ...base, kind: "dropdown", options: ["One", "Two"] };
    expect(planFill(dd, "two")).toMatchObject({ set: { kind: "selection", index: 1 } });
    expect(planFill(dd, "Three")).toEqual({ skip: "not-an-option" });
  });
  it("reads common checkbox words", () => {
    const cb: FormField = { ...base, kind: "checkbox", value: "Off", options: ["Yes"] };
    for (const v of ["Yes", "true", "1", "X"])
      expect(planFill(cb, v)).toMatchObject({ set: { checked: true } });
    expect(planFill(cb, "no")).toEqual({ noop: true });
    expect(planFill(cb, "maybe")).toEqual({ skip: "not-an-option" });
  });
});

const CORPUS = [
  ["acroform", join(OUT_DIR, "acroform.pdf")],
  ["workpaper-a", join(OUT_DIR, "workpaper-a.pdf")],
  ["f1040", join(IRS, "f1040.pdf")],
  ["fw9", join(IRS, "fw9.pdf")],
  ["f8879", join(IRS, "f8879.pdf")],
] as const;

describe.each(CORPUS)("fill + save + reopen: %s", (label, path) => {
  let expected: FieldValues;
  /** What /V holds: a button's appearance state name, not its /Opt label. */
  let expectedRaw: FieldValues;
  let saved: Uint8Array;
  let outPath: string;
  let report: Awaited<ReturnType<typeof fillForm>>;

  beforeAll(async () => {
    const original = read(path);
    const fields = await fieldsOf(original);
    expected = sampleValues(fields);
    expectedRaw = Object.fromEntries(
      Object.entries(expected).map(([k, v]) => {
        const w = fields.find((f) => f.name === k)?.widgets.find((x) => x.label === v);
        return [k, w?.exportValue ?? v];
      }),
    );
    report = await fillForm(ctx.engine, original, expected);
    saved = await finishFormSave(ctx, report.bytes, "strip");
    outPath = join(OUT, `${label}-filled.pdf`);
    writeFileSync(outPath, saved);
  });

  it("fills every field it was given", () => {
    expect(report.unknown).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.filled.length).toBe(Object.keys(expected).length);
    expect(report.filled.length).toBeGreaterThan(0);
  });

  it("our engine reads the values back", async () => {
    const got = await formValues(ctx.engine, saved);
    for (const [k, v] of Object.entries(expected)) expect.soft(got[k], k).toBe(v);
  });

  it("pdf.js reads the values back", async () => {
    const got = await pdfjsValues(saved);
    for (const [k, v] of Object.entries(expected)) expect.soft(got[k], k).toBe(v);
  });

  it("qpdf reads the values back", () => {
    const got = qpdfValues(outPath);
    for (const [k, v] of Object.entries(expectedRaw)) expect.soft(got[k], k).toBe(v);
  });

  it("strip leaves no /XFA and no /Perms", () => {
    expect(xfaPresent(outPath)).toEqual({ xfa: false, perms: false });
  });
});

describe("XFA policy", () => {
  it("keep leaves the XFA twin and usage rights in place", async () => {
    const original = read(join(IRS, "fw9.pdf"));
    const { bytes } = await fillForm(ctx.engine, original, {});
    const kept = await finishFormSave(ctx, bytes, "keep");
    const p = join(OUT, "fw9-keep.pdf");
    writeFileSync(p, kept);
    expect(xfaPresent(p)).toEqual({ xfa: true, perms: true });
  });
});
