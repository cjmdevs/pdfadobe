// B3 Edit PDF: image edits as the app runs them (bytes in, bytes out, by id): add,
// move/resize/rotate, replace, delete, stale refusal. JPEGs stay byte-identical.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import {
  addImageToPage,
  editImage,
  editPageInfo,
  EditRefused,
  type EditImage,
} from "../../src/engine/edit";

const require = createRequire(import.meta.url);
const BASE = join(__dirname, "..", "corpus", "edit", "two-column.pdf");
const JPEG = new Uint8Array(
  readFileSync(join(__dirname, "..", "corpus", "fixtures", "photo-rgb.jpg")),
);
const at = { cx: 300, cy: 150, width: 120, height: 80, rotation: 0 };

let m: PdfiumModule;
beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const images = (bytes: Uint8Array) => editPageInfo(m, bytes, 0).images;
const ref = (img: EditImage) => ({ page: 0, id: img.id, rect: img.rect });
/** The JPEG's bytes appear unchanged in the file (a DCTDecode stream, never re-encoded). */
const holdsJpeg = (bytes: Uint8Array) => Buffer.from(bytes).indexOf(Buffer.from(JPEG)) >= 0;

describe("image edits by id", () => {
  it("adds, moves, resizes and rotates; the JPEG stays byte-identical", () => {
    let bytes = addImageToPage(m, new Uint8Array(readFileSync(BASE)), 0, JPEG, at);
    expect(images(bytes)).toHaveLength(1);
    expect(holdsJpeg(bytes)).toBe(true);
    for (const placement of [
      { ...at, cx: 250 },
      { ...at, cx: 250, width: 180, height: 120 },
      { ...at, cx: 250, width: 180, height: 120, rotation: 30 },
    ]) {
      bytes = editImage(m, bytes, ref(images(bytes)[0]!), { kind: "place", placement });
      const p = images(bytes)[0]!.placement;
      for (const k of ["cx", "cy", "width", "height", "rotation"] as const)
        expect(p[k]).toBeCloseTo(placement[k], 2);
      expect(holdsJpeg(bytes)).toBe(true);
    }
  });

  it("replaces and deletes", () => {
    let bytes = addImageToPage(m, new Uint8Array(readFileSync(BASE)), 0, JPEG, at);
    bytes = editImage(m, bytes, ref(images(bytes)[0]!), { kind: "replace", data: JPEG });
    expect(images(bytes)).toHaveLength(1);
    bytes = editImage(m, bytes, ref(images(bytes)[0]!), { kind: "delete" });
    expect(images(bytes)).toEqual([]);
  });

  it("refuses an image that is no longer where it was selected", () => {
    const bytes = addImageToPage(m, new Uint8Array(readFileSync(BASE)), 0, JPEG, at);
    const img = images(bytes)[0]!;
    expect(() =>
      editImage(
        m,
        bytes,
        { ...ref(img), rect: { ...img.rect, l: img.rect.l + 20 } },
        {
          kind: "delete",
        },
      ),
    ).toThrow(EditRefused);
  });
});
