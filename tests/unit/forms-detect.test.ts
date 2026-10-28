// Phase 6 Detect fields: the synthetic flat intake form yields its blanks, boxes and
// notes area, named from their labels; a fillable form yields nothing new.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FLAT_FORM_LAYOUT, OUT_DIR } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import type { PagesCtx } from "../../src/engine/pages";
import { addFields, detectFields, formValues, fillForm } from "../../src/engine/forms";

let ctx: PagesCtx;
beforeAll(async () => {
  ctx = await nodePagesCtx();
});
const read = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));

describe("detectFields", () => {
  it("finds the blanks, the line, the boxes and the notes area of a flat form", () => {
    const found = detectFields(ctx.module, read("flat-form.pdf"), new Set());
    const byName = new Map(found.map((c) => [c.name, c]));
    const L = FLAT_FORM_LAYOUT;
    for (const u of L.underscores) expect.soft(byName.get(u.label)?.kind, u.label).toBe("text");
    expect(byName.get(L.line.label)?.kind).toBe("text");
    for (const b of L.boxes) expect.soft(byName.get(b.label)?.kind, b.label).toBe("checkbox");
    expect(byName.get(L.notes.label)).toMatchObject({ kind: "text", multiline: true });
    expect(found).toHaveLength(6);
    // Each text blank sits on its line: bottom within 3 pt of the baseline/rule.
    expect(
      Math.abs((byName.get("Client name")?.rect.b ?? 0) - (L.underscores[0]!.y - 2)),
    ).toBeLessThan(3);
  });

  it("finds nothing new on a form that already has its fields", () => {
    expect(detectFields(ctx.module, read("acroform.pdf"), new Set())).toEqual([]);
  });

  it("names clash-free against fields already in the document", () => {
    const found = detectFields(ctx.module, read("flat-form.pdf"), new Set(["Notes"]));
    expect(found.map((c) => c.name)).toContain("Notes 2");
  });

  it("the detected fields can be added and filled", async () => {
    const found = detectFields(ctx.module, read("flat-form.pdf"), new Set());
    const r = await addFields(ctx, read("flat-form.pdf"), found);
    expect(r.names).toHaveLength(6);
    const filled = await fillForm(ctx.engine, r.bytes, {
      "Client name": "Jane Sample",
      Married: "Yes",
      Notes: "Line one",
    });
    expect(filled.skipped).toEqual([]);
    expect(await formValues(ctx.engine, filled.bytes)).toMatchObject({
      "Client name": "Jane Sample",
      Married: "Yes",
      Notes: "Line one",
    });
    // Running it again finds nothing: every blank has its field now.
    expect(detectFields(ctx.module, r.bytes, new Set(r.names))).toEqual([]);
  });
});
