// Phase 6 Prepare Form engine: add each kind of field to a flat PDF, group radio
// buttons, set properties, and read the result with qpdf, pdf.js and our own engine.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, qpdfBin } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import type { PagesCtx } from "../../src/engine/pages";
import {
  DEFAULT_SIZE,
  FormDesignError,
  addField,
  fillForm,
  formValues,
  parseFormat,
  readFieldProps,
  readFields,
  resetFields,
  setFieldProps,
  type NewFieldKind,
} from "../../src/engine/forms";

const OUT = join(OUT_DIR, "..", "out", "forms");
let ctx: PagesCtx;
let built: Uint8Array<ArrayBufferLike>;

beforeAll(async () => {
  ctx = await nodePagesCtx();
  mkdirSync(OUT, { recursive: true });
  // One of each kind on the flat text-1p.pdf, top to bottom.
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(
    readFileSync(join(OUT_DIR, "text-1p.pdf")),
  );
  const kinds: NewFieldKind[] = ["text", "checkbox", "radio", "dropdown", "date", "signature"];
  let y = 700;
  for (const kind of kinds) {
    const { w, h } = DEFAULT_SIZE[kind];
    bytes = (
      await addField(ctx, bytes, {
        kind,
        pageIndex: 0,
        rect: { l: 300, b: y, r: 300 + w, t: y + h },
      })
    ).bytes;
    y -= 50;
  }
  // A second button in the radio group.
  bytes = (
    await addField(ctx, bytes, {
      kind: "radio",
      pageIndex: 0,
      rect: { l: 340, b: 600, r: 354, t: 614 },
      joinGroup: "Group1",
    })
  ).bytes;
  built = bytes;
  writeFileSync(join(OUT, "prepared.pdf"), built);
});

interface QField {
  fullname: string;
  fieldtype: string;
  annotation: { annotationflags: number };
}

function qpdfFields(bytes: Uint8Array): QField[] {
  const p = join(OUT, "prepared-check.pdf");
  writeFileSync(p, bytes);
  return (
    JSON.parse(
      execFileSync(qpdfBin(), ["--json=2", "--json-key=acroform", p], { encoding: "utf8" }),
    ) as { acroform: { fields: QField[] } }
  ).acroform.fields;
}

async function pdfjsFields(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const objs = (await pdf.getFieldObjects()) as Map<
    string,
    { type: string; exportValues?: string; charLimit?: number }[]
  >;
  const out = new Map([...objs].map(([k, v]) => [k, v.filter((x) => x.type)]));
  await task.destroy();
  return out;
}

async function fieldsOf(bytes: Uint8Array) {
  const doc = await ctx.engine
    .openDocumentBuffer({ id: crypto.randomUUID(), content: bytes.slice().buffer })
    .toPromise();
  try {
    return await readFields(ctx.engine, doc);
  } finally {
    await ctx.engine.closeDocument(doc).toPromise();
  }
}

describe("addField", () => {
  it("adds every kind with Acrobat-style names, all printing", () => {
    const q = qpdfFields(built);
    const byName = new Map<string, QField[]>();
    for (const f of q) byName.set(f.fullname, [...(byName.get(f.fullname) ?? []), f]);
    expect([...byName.keys()].sort()).toEqual(
      ["Check Box1", "Date1", "Dropdown1", "Group1", "Signature1", "Text1"].sort(),
    );
    expect(byName.get("Text1")?.[0]?.fieldtype).toBe("/Tx");
    expect(byName.get("Check Box1")?.[0]?.fieldtype).toBe("/Btn");
    expect(byName.get("Dropdown1")?.[0]?.fieldtype).toBe("/Ch");
    expect(byName.get("Signature1")?.[0]?.fieldtype).toBe("/Sig");
    expect(byName.get("Group1")).toHaveLength(2);
    for (const f of q) expect.soft(f.annotation.annotationflags & 4, f.fullname).toBe(4);
  });

  it("pdf.js sees the same fields; radio buttons have readable export values", async () => {
    const js = await pdfjsFields(built);
    expect(js.get("Group1")?.map((w) => w.exportValues)).toEqual(["Choice1", "Choice2"]);
    expect(js.get("Signature1")?.[0]?.type).toBe("signature");
    expect(js.get("Date1")?.[0]?.type).toBe("text");
  });

  it("our engine fills the new fields; the date field carries Acrobat's date scripts", async () => {
    const r = await fillForm(ctx.engine, built, {
      Text1: "Hello",
      "Check Box1": "Yes",
      Group1: "Choice2",
      Date1: "10/27/2026",
    });
    expect(r.skipped).toEqual([]);
    expect(await formValues(ctx.engine, r.bytes)).toMatchObject({
      Text1: "Hello",
      "Check Box1": "Yes",
      Group1: "Choice2",
      Date1: "10/27/2026",
    });
    expect((await readFieldProps(ctx, built, "Date1")).format).toEqual({
      kind: "date",
      pattern: "mm/dd/yyyy",
    });
  });

  it("refuses a name that is taken, and joining something that is not a radio group", async () => {
    const rect = { l: 50, b: 50, r: 100, t: 70 };
    await expect(
      addField(ctx, built, { kind: "text", pageIndex: 0, rect, name: "Text1" }),
    ).rejects.toThrow(FormDesignError);
    await expect(
      addField(ctx, built, { kind: "radio", pageIndex: 0, rect, joinGroup: "Text1" }),
    ).rejects.toThrow(/not a radio group/);
  });
});

describe("setFieldProps", () => {
  it("max length goes on the field, where Acrobat and pdf.js read it", async () => {
    const b = await setFieldProps(ctx, built, "Text1", { maxLen: 5 });
    expect((await readFieldProps(ctx, b, "Text1")).maxLen).toBe(5);
    expect((await pdfjsFields(b)).get("Text1")?.[0]?.charLimit).toBe(5);
    expect((await fillForm(ctx.engine, b, { Text1: "123456" })).skipped).toEqual([
      { name: "Text1", reason: "too-long" },
    ]);
  });

  it("default values are what Reset form puts back", async () => {
    let b = await setFieldProps(ctx, built, "Text1", { defaultValue: "Default" });
    b = await setFieldProps(ctx, b, "Group1", { defaultValue: "Choice1" });
    b = (await fillForm(ctx.engine, b, { Text1: "typed", Group1: "Choice2" })).bytes;
    const r = await resetFields(ctx, b, { to: "default" });
    expect(await formValues(ctx.engine, r.bytes)).toMatchObject({
      Text1: "Default",
      Group1: "Choice1",
    });
  });

  it("number formats round-trip as Acrobat AFNumber scripts", async () => {
    const format = { kind: "number", decimals: 2, sep: 0, negative: 2, currency: "$" } as const;
    const b = await setFieldProps(ctx, built, "Text1", { format });
    expect((await readFieldProps(ctx, b, "Text1")).format).toEqual(format);
    const none = await setFieldProps(ctx, b, "Text1", { format: { kind: "none" } });
    expect((await readFieldProps(ctx, none, "Text1")).format).toEqual({ kind: "none" });
    expect(parseFormat('AFNumber_Format(0, 1, 0, 0, "", true);')).toMatchObject({ decimals: 0 });
  });

  it("export values rename the radio buttons; filling by the new names works", async () => {
    const b = await setFieldProps(ctx, built, "Group1", { exportValues: ["single", "joint"] });
    expect((await readFieldProps(ctx, b, "Group1")).exportValues).toEqual(["single", "joint"]);
    const f = await fillForm(ctx.engine, b, { Group1: "joint" });
    expect(f.skipped).toEqual([]);
    expect((await fieldsOf(f.bytes)).find((x) => x.name === "Group1")?.value).toBe("joint");
  });
});
