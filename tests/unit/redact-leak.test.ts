// Phase 5 stage 4: the leak scan refuses to hand back a file that still holds a
// redacted string, and the refusal never carries that string.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FAKE_SSN, OUT_DIR } from "../corpus/generate.mjs";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import {
  DEFAULT_OVERLAY,
  RedactionLeakError,
  redactDocument,
  redactedFileName,
  searchDocument,
  secretsFor,
} from "../../src/engine/redact";
import { leakScan } from "../../src/engine/redact/leak";

const require = createRequire(import.meta.url);
const qpdf = nodeQpdf();
let m: PdfiumModule;
let original: Uint8Array;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  original = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
});

describe("leak scan", () => {
  it("refuses when the SSN is left on another page, and names no SSN", async () => {
    const page1 = searchDocument(m, original, { patterns: ["ssn"] }).filter(
      (h) => h.pageIndex === 0,
    );
    const run = redactDocument(m, qpdf, original, {
      marks: page1.map((h) => ({ pageIndex: 0, rects: h.rects })),
      found: page1.map((h) => h.text ?? ""),
    });
    const err = await run.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RedactionLeakError);
    const leak = err as RedactionLeakError;
    expect(leak.hits).toContainEqual({ secret: 0, where: "page-text", pageIndex: 1 });
    expect(leak.hits.some((h) => h.where === "file-bytes")).toBe(true);
    expect(JSON.stringify(leak.hits) + leak.message).not.toContain("3456");
  });

  it("a box that still shows content is a hit", async () => {
    // The unredacted original: the text under this box is still drawn.
    const hits = await leakScan(
      m,
      qpdf,
      original,
      [],
      [{ pageIndex: 0, rects: [{ l: 70, b: 686, r: 200, t: 704 }] }],
      DEFAULT_OVERLAY,
    );
    expect(hits).toEqual([{ secret: -1, where: "box-render", pageIndex: 0 }]);
  });

  it("checks search hits and long digit runs from area boxes, not plain words", () => {
    expect(
      secretsFor(
        [FAKE_SSN, "ab"],
        [{ pageIndex: 0, text: "Name Jane Doe Acct 000123456789 year 2024" }],
      ),
    ).toEqual([FAKE_SSN, "000123456789"]);
  });
});

it("redacted file name", () => {
  expect(redactedFileName("C:\\Clients\\Return 2024.pdf")).toBe(
    "C:\\Clients\\Return 2024_Redacted.pdf",
  );
  expect(redactedFileName("scan.PDF")).toBe("scan_Redacted.pdf");
  expect(redactedFileName("notes")).toBe("notes_Redacted.pdf");
});
