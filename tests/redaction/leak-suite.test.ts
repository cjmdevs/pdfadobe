// Phase 5 leak suite. For every corpus file holding the fake SSN: redact it (search
// hits + the file's area boxes), then look for it with tools that share no code with
// the redaction engine: pdf.js (page text, metadata, XMP, annotations, form values),
// qpdf (every byte, every stream decoded, six encodings) and Tesseract (OCR of each
// rendered page). Runs in CI (.github/workflows/redaction.yml) and before every push.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FAKE_SSN, LEAK_FILES, OUT_DIR, SSN_LAYOUT } from "../corpus/generate.mjs";
import { pdfjsView, rawHits, type PdfjsView } from "../helpers/leak-scan";
import { nodeQpdf } from "../helpers/qpdf-node";
import { OCR_SSN, ocrPages } from "../helpers/ocr";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import {
  ALL_SANITIZE,
  redactDocument,
  searchDocument,
  type PageRedaction,
} from "../../src/engine/redact";

const require = createRequire(import.meta.url);
const OUT = join(OUT_DIR, "..", "out");
let m: PdfiumModule;

const box = (r: { x: number; y: number; width: number; height: number }) => ({
  l: r.x,
  b: r.y,
  r: r.x + r.width,
  t: r.y + r.height,
});

const FILES = [
  ...LEAK_FILES,
  {
    file: "ssn-redaction.pdf",
    what: "the Phase 0 SSN fixture: runs, split runs, page 2, field, note, image, vectors, metadata",
    areas: [
      { page: 0, rect: SSN_LAYOUT.formField.rect },
      { page: 0, rect: SSN_LAYOUT.areaZone },
    ],
    keep: "KEEP-THIS-LINE",
    sanitize: false,
  },
];

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  mkdirSync(OUT, { recursive: true });
});

describe.each(FILES)("$file ($what)", (spec) => {
  let original: Uint8Array;
  let redacted: Uint8Array;
  let view: PdfjsView;

  beforeAll(async () => {
    original = new Uint8Array(readFileSync(join(OUT_DIR, spec.file)));
    const hits = searchDocument(m, original, { literals: [FAKE_SSN] });
    const marks: PageRedaction[] = hits.map((h) => ({
      pageIndex: h.pageIndex,
      rects: h.rects.map((r) => ({ l: r.l - 1, b: r.b - 1, r: r.r + 1, t: r.t + 1 })),
    }));
    for (const a of spec.areas) marks.push({ pageIndex: a.page, rects: [box(a.rect)] });
    const result = await redactDocument(m, nodeQpdf(), original, {
      marks,
      found: hits.map((h) => h.text ?? ""),
      sanitize: spec.sanitize ? ALL_SANITIZE : null,
    });
    redacted = result.bytes;
    writeFileSync(join(OUT, spec.file.replace(/\.pdf$/, "_Redacted.pdf")), redacted);
    view = await pdfjsView(redacted);
  });

  it.skipIf(spec.pixelsOnly)("the original holds the SSN (the checks below can see it)", () => {
    expect(rawHits(original, FAKE_SSN).length).toBeGreaterThan(0);
  });

  it("page text (pdf.js)", () => {
    expect(view.pageText.join("")).not.toContain(FAKE_SSN);
    expect(view.pageText.join("").replace(/\s/g, "")).not.toContain("000-12-3456");
  });

  it("raw bytes and every decoded stream (qpdf), every encoding", () => {
    expect(rawHits(redacted, FAKE_SSN)).toEqual([]);
  });

  it("metadata, XMP, annotations and form values (pdf.js)", () => {
    expect(JSON.stringify(view.info)).not.toContain(FAKE_SSN);
    expect(view.xmp).not.toContain(FAKE_SSN);
    expect(view.annotations.flatMap((a) => a.strings).join(" ")).not.toContain(FAKE_SSN);
  });

  it("OCR of every rendered page (Tesseract), and the keep line still reads", () => {
    const before = ocrPages(m, original).join("\n");
    const after = ocrPages(m, redacted).join("\n");
    if (!spec.notDrawn) expect(before).toMatch(OCR_SSN);
    expect(after).not.toMatch(OCR_SSN);
    expect(after.replace(/\s/g, "")).toContain(spec.keep);
  });
});
