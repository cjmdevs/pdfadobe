// Phase 5 stage 2b: annotations and form fields under a redaction box, removed at the
// object level (qpdf JSON), then a full rewrite.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FAKE_SSN, OUT_DIR, SSN_LAYOUT } from "../corpus/generate.mjs";
import { inspectPdf } from "../helpers/pdf-inspect";
import { pdfjsView } from "../helpers/leak-scan";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { editRaw } from "../../src/engine/pages/raw";
import { redactContent, type PageRedaction } from "../../src/engine/redact/apply";
import { PdfObjects, removeUnderMarks, rewrite } from "../../src/engine/redact/objects";

const require = createRequire(import.meta.url);
const qpdf = nodeQpdf();
let m: PdfiumModule;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const box = (r: { x: number; y: number; width: number; height: number }) => ({
  l: r.x,
  b: r.y,
  r: r.x + r.width,
  t: r.y + r.height,
});

async function redactObjects(bytes: Uint8Array, marks: PageRedaction[]) {
  const content = redactContent(m, bytes, marks).bytes;
  const objs = await PdfObjects.read(qpdf, content);
  const report = removeUnderMarks(objs, marks);
  return { bytes: await rewrite(qpdf, content, objs), report };
}

describe("annotations and fields under a box", () => {
  it("SSN fixture: sticky note and the SSN field go, nothing else", async () => {
    const original = new Uint8Array(readFileSync(join(OUT_DIR, "ssn-redaction.pdf")));
    const marks: PageRedaction[] = [
      { pageIndex: 0, rects: [{ l: 70, b: 684, r: 180, t: 706 }, box(SSN_LAYOUT.formField.rect)] },
    ];
    const { bytes, report } = await redactObjects(original, marks);
    expect(report.annotationsRemoved).toBe(2);
    expect(report.fieldsRemoved).toEqual([SSN_LAYOUT.formField.name]);
    const view = await pdfjsView(bytes);
    expect(view.annotations.flatMap((a) => a.strings).join(" ")).not.toContain(FAKE_SSN);
    const info = await inspectPdf(bytes);
    expect(info.fields).toEqual([]);
    expect(info.checkError).toBeNull();
    // Still there: the text outside the boxes.
    expect(view.pageText.join("")).toContain("KEEP-THIS-LINE");
  });

  it("one radio button under a box removes the whole radio field, every widget", async () => {
    const original = new Uint8Array(readFileSync(join(OUT_DIR, "acroform.pdf")));
    const before = await inspectPdf(original);
    const marks: PageRedaction[] = [
      {
        pageIndex: 0,
        rects: [
          { l: 282, b: 622, r: 294, t: 634 },
          { l: 205, b: 705, r: 260, t: 715 },
        ],
      },
    ];
    const { bytes, report } = await redactObjects(original, marks);
    expect(report.fieldsRemoved.sort()).toEqual(["filing.status", "taxpayer.name"]);
    expect(report.annotationsRemoved).toBe(4);
    const after = await inspectPdf(bytes);
    const names = (f: { name: string }[]) => f.map((x) => x.name).sort();
    expect(names(after.fields)).toEqual(
      names(before.fields).filter((n) => !n.startsWith("filing.") && !n.startsWith("taxpayer.")),
    );
    expect(after.annotations.filter((a) => a.subtype === "Widget")).toHaveLength(3);
    expect(after.checkError).toBeNull();
  });

  it("/Redact marks themselves are gone after applying", async () => {
    // A pending /Redact mark (as the review panel leaves them), away from the box.
    const original = editRaw(m, new Uint8Array(readFileSync(join(OUT_DIR, "text-1p.pdf"))), (doc) =>
      doc.withPage(0, (page) => m.FPDFPage_CloseAnnot(m.FPDFPage_CreateAnnot(page, 28))),
    );
    expect((await pdfjsView(original)).annotations.some((a) => a.subtype === "Redact")).toBe(true);
    const { bytes } = await redactObjects(original, [
      { pageIndex: 0, rects: [{ l: 0, b: 0, r: 1, t: 1 }] },
    ]);
    expect((await pdfjsView(bytes)).annotations.some((a) => a.subtype === "Redact")).toBe(false);
  });
});
