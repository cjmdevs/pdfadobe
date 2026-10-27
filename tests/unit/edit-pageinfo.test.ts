// B3 Edit PDF: the page summary the Edit tool outlines (text boxes and images) and
// hit-testing on it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { addImage, editPageInfo, hitTest } from "../../src/engine/edit";

const require = createRequire(import.meta.url);
const EDIT = join(__dirname, "..", "corpus", "edit");
const JPEG = new Uint8Array(
  readFileSync(join(__dirname, "..", "corpus", "fixtures", "photo-rgb.jpg")),
);

let m: PdfiumModule;
beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

describe("editPageInfo", () => {
  it("lists the memo's boxes in reading order with padded rects", () => {
    const info = editPageInfo(m, new Uint8Array(readFileSync(join(EDIT, "memo.pdf"))), 0);
    expect(info).toMatchObject({ width: 612, height: 792, images: [] });
    expect(info.boxes[0]).toMatchObject({ kind: "text", id: 0, preview: "MEMORANDUM" });
    const body = info.boxes.find((b) => b.preview.startsWith("We selected sales"))!;
    expect(body.lines).toHaveLength(3);
    for (const l of body.lines) {
      expect(l.l).toBeGreaterThanOrEqual(body.rect.l);
      expect(l.t).toBeLessThanOrEqual(body.rect.t);
    }
  });

  it("hit-tests text boxes, images and empty page", () => {
    const base = new Uint8Array(readFileSync(join(EDIT, "two-column.pdf")));
    const doc = RawDoc.open(m, base);
    let bytes: Uint8Array;
    try {
      doc.withPage(0, (page) =>
        addImage(m, doc.ptr, page, JPEG, { cx: 300, cy: 100, width: 100, height: 60, rotation: 0 }),
      );
      bytes = doc.save();
    } finally {
      doc.close();
    }
    const info = editPageInfo(m, bytes, 0);
    expect(info.images).toHaveLength(1);
    const box = info.boxes.find((b) => b.preview.startsWith("Estimated tax"))!;
    const mid = (r: { l: number; r: number; b: number; t: number }) => [
      (r.l + r.r) / 2,
      (r.b + r.t) / 2,
    ];
    const [bx, by] = mid(box.rect);
    expect(hitTest(info, bx!, by!)).toMatchObject({ kind: "text", id: box.id });
    expect(hitTest(info, 300, 100)).toMatchObject({ kind: "image", id: 0 });
    expect(hitTest(info, 590, 20)).toBeNull();
  });
});
