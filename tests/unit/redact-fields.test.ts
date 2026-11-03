// B7 owner check: Search & Redact finds a form field's value, a refusal says where the
// redacted text is still stored, and Find + Mark all + Apply on the SSN fixture saves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FAKE_SSN, OUT_DIR } from "../corpus/generate.mjs";
import { nodePagesCtx } from "../helpers/pages-ctx";
import { rawHits } from "../helpers/leak-scan";
import type { PagesCtx } from "../../src/engine/pages";
import {
  RedactionLeakError,
  redactDocument,
  searchDocument,
  searchFields,
} from "../../src/engine/redact";

let ctx: PagesCtx;
let original: Uint8Array;

beforeAll(async () => {
  ctx = await nodePagesCtx();
  original = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
});

describe("form-field values in Search & Redact", () => {
  it("finds the SSN in the field and marks the whole field", async () => {
    const hits = await searchFields(ctx.engine, original, { patterns: ["ssn"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pageIndex: 0, kind: "area", source: "ssn", inField: true });
    const r = hits[0]!.rects[0]!;
    expect(r.r - r.l).toBeGreaterThan(100); // the widget, not just the digits
  });

  it("a refusal names the form field and its page, never the SSN", async () => {
    const text = searchDocument(ctx.module, original, { patterns: ["ssn"] });
    const err = await redactDocument(ctx.module, ctx.qpdf, original, {
      marks: text.map((h) => ({ pageIndex: h.pageIndex, rects: h.rects })),
      found: text.map((h) => h.text ?? ""),
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RedactionLeakError);
    const leak = err as RedactionLeakError;
    expect(leak.places).toContainEqual({ kind: "field", pageIndex: 0 });
    expect(JSON.stringify(leak.places) + leak.message).not.toContain("3456");
  });

  it("text and field matches together: Apply saves a file with no SSN", async () => {
    const all = [
      ...searchDocument(ctx.module, original, { patterns: ["ssn"] }),
      ...(await searchFields(ctx.engine, original, { patterns: ["ssn"] })),
    ];
    const r = await redactDocument(ctx.module, ctx.qpdf, original, {
      marks: all.map((h) => ({ pageIndex: h.pageIndex, rects: h.rects })),
      found: all.map((h) => h.text ?? ""),
    });
    expect(r.objects.fieldsRemoved.length).toBe(1);
    expect(rawHits(r.bytes, FAKE_SSN)).toEqual([]);
  });
});
