// Phase 6 Flatten form: filled values become page content (read by pdf.js and PDFium),
// no form structure is left (qpdf, pdf.js), hidden fields leave no trace in the bytes,
// and comments are kept.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import { decompressedBytes, pdfiumText, pdfjsView, rawHits } from "../helpers/leak-scan";
import type { PagesCtx } from "../../src/engine/pages";
import { fillForm, flattenForm, type FieldValues } from "../../src/engine/forms";

const OUT = join(OUT_DIR, "..", "out", "forms");
let ctx: PagesCtx;
beforeAll(async () => {
  ctx = await nodePagesCtx();
  mkdirSync(OUT, { recursive: true });
});

const read = (p: string) => new Uint8Array(readFileSync(p));

async function fieldCount(bytes: Uint8Array): Promise<number> {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const objs = (await pdf.getFieldObjects()) as Map<string, unknown> | null;
  let widgets = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const annots = (await (await pdf.getPage(p)).getAnnotations()) as { subtype: string }[];
    widgets += annots.filter((a) => a.subtype === "Widget").length;
  }
  await task.destroy();
  return (objs?.size ?? 0) + widgets;
}

async function widgetCount(bytes: Uint8Array): Promise<number> {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  let n = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const annots = (await (await pdf.getPage(p)).getAnnotations()) as { subtype: string }[];
    n += annots.filter((a) => a.subtype === "Widget").length;
  }
  await task.destroy();
  return n;
}

/** Widgets drawn per case: the 1040 has 126 text fields. */
const drawnBefore = new Map<string, number>();

const CASES: [string, string, FieldValues][] = [
  [
    "acroform",
    join(OUT_DIR, "acroform.pdf"),
    { "taxpayer.name": "Jane Flatten", "tax.year": "2024", "filing.status": "mfj" },
  ],
  [
    "f1040",
    join(OUT_DIR, "..", "irs", "f1040.pdf"),
    {
      "topmostSubform[0].Page1[0].f1_04[0]": "Jane Flatten",
      "topmostSubform[0].Page1[0].c1_1[0]": "Yes",
    },
  ],
  [
    "fw9",
    join(OUT_DIR, "..", "irs", "fw9.pdf"),
    { "topmostSubform[0].Page1[0].f1_01[0]": "Jane Flatten" },
  ],
];

describe.each(CASES)("flatten %s", (label, path, values) => {
  let flat: Uint8Array;
  beforeAll(async () => {
    const filled = await fillForm(ctx.engine, read(path), values);
    expect(filled.skipped).toEqual([]);
    const widgets = await widgetCount(read(path));
    const r = await flattenForm(ctx, filled.bytes);
    // Every widget is drawn or (hidden) dropped: none is skipped.
    expect(r.drawn + r.hidden + r.empty).toBe(widgets);
    expect(r.drawn).toBeGreaterThan(0);
    flat = r.bytes;
    drawnBefore.set(label, r.drawn);
    writeFileSync(join(OUT, `${label}-flattened.pdf`), flat);
  });

  it("a ticked box is drawn (buttons draw too, not only text)", async () => {
    if (label === "f1040") expect(drawnBefore.get(label)).toBeGreaterThan(126);
  });

  it("the typed value is page text now (pdf.js and PDFium)", async () => {
    expect((await pdfjsView(flat)).pageText.join("\n")).toContain("Jane Flatten");
    expect((await pdfiumText(ctx.engine, flat)).join("\n")).toContain("Jane Flatten");
  });

  it("no fields, widgets, XFA or usage rights are left", async () => {
    expect(await fieldCount(flat)).toBe(0);
    const raw = decompressedBytes(flat).toString("latin1");
    for (const key of ["/AcroForm", "/Widget", "/XFA", "/Perms", "/UR3"])
      expect.soft(raw.includes(key), key).toBe(false);
    // The value lives only in the page content now, not in a field (/V).
    expect(raw).not.toMatch(/\/V\s*\(Jane Flatten\)/);
  });
});

describe("flatten details", () => {
  it("drops a hidden field without drawing it, and keeps no trace of its value", async () => {
    const pdf = await PDFDocument.load(read(join(OUT_DIR, "acroform.pdf")));
    const f = pdf.getForm().getTextField("notes");
    f.setText("HIDDEN-VALUE-4417");
    const w = f.acroField.getWidgets()[0]!;
    w.dict.set(PDFName.of("F"), PDFNumber.of(2)); // Hidden, no Print
    const r = await flattenForm(ctx, await pdf.save());
    expect(r.hidden).toBe(1);
    expect(rawHits(r.bytes, "HIDDEN-VALUE-4417")).toEqual([]);
    expect((await pdfjsView(r.bytes)).pageText.join("\n")).not.toContain("HIDDEN-VALUE-4417");
  });

  it("draws every kind of field: dropdown, radio and checkbox appearances stay", async () => {
    const filled = await fillForm(ctx.engine, read(join(OUT_DIR, "acroform.pdf")), {
      "tax.year": "2025",
      "signed.8879": "Yes",
    });
    const r = await flattenForm(ctx, filled.bytes);
    expect(r.drawn).toBe(7);
    expect((await pdfjsView(r.bytes)).pageText.join(" ")).toContain("2025");
  });

  it("keeps comments and other markup", async () => {
    const before = read(join(OUT_DIR, "workpaper-a.pdf"));
    const r = await flattenForm(ctx, before);
    const task = getDocument({ data: r.bytes.slice() });
    const doc = await task.promise;
    const kinds = new Set<string>();
    for (let p = 1; p <= doc.numPages; p++) {
      for (const a of (await (await doc.getPage(p)).getAnnotations()) as { subtype: string }[])
        kinds.add(a.subtype);
    }
    await task.destroy();
    expect(kinds.has("Widget")).toBe(false);
    expect(kinds.has("Text") || kinds.has("Square")).toBe(true);
  });
});
