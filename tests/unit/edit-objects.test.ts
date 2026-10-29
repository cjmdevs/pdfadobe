// B3 stage 2 step 4: the Objects panel's edits. Flip, crop (pixels outside removed),
// drawing order (images and text boxes), align, and an image exported for another
// program.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import {
  addImageToPage,
  alignObjects,
  arrangeBox,
  editImage,
  editPageInfo,
  exportImage,
  type EditImage,
  type EditTextBox,
} from "../../src/engine/edit";
import {
  flipped,
  imageFileSize,
  matrixToPlacement,
  placementToMatrix,
} from "../../src/engine/edit/images";
import { decodePng } from "../../src/engine/pages/png";

const require = createRequire(import.meta.url);
const BASE = join(__dirname, "..", "corpus", "edit", "memo.pdf");
const JPEG = new Uint8Array(
  readFileSync(join(__dirname, "..", "corpus", "fixtures", "photo-rgb.jpg")),
);
const at = { cx: 300, cy: 150, width: 120, height: 80, rotation: 0 };

let m: PdfiumModule;
beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const info = (bytes: Uint8Array) => editPageInfo(m, bytes, 0);
const iref = (img: EditImage) => ({ page: 0, id: img.id, rect: img.rect });
const bref = (b: EditTextBox) => ({ page: 0, id: b.id, preview: b.preview });
const withJpeg = () => addImageToPage(m, new Uint8Array(readFileSync(BASE)), 0, JPEG, at);
/** Drawing order of the page's objects: their types (1 text, 3 image). */
function order(bytes: Uint8Array): number[] {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(0, (p) =>
      Array.from({ length: m.FPDFPage_CountObjects(p) }, (_, i) =>
        m.FPDFPageObj_GetType(m.FPDFPage_GetObject(p, i)),
      ),
    );
  } finally {
    doc.close();
  }
}

describe("flip", () => {
  it("a mirrored placement round-trips through the matrix", () => {
    const p = { ...at, rotation: 30, flip: true };
    const back = matrixToPlacement(placementToMatrix(p));
    for (const k of ["cx", "cy", "width", "height", "rotation"] as const)
      expect(back[k]).toBeCloseTo(p[k], 4);
    expect(back.flip).toBe(true);
    // Flipping twice is no flip; a vertical flip turns 180 degrees.
    expect(flipped(flipped(at, "h"), "h")).toMatchObject({ flip: false, rotation: 0 });
    expect(Math.abs(flipped(at, "v").rotation)).toBe(180);
  });

  it("flips an image on the page, keeping its place", () => {
    let bytes = withJpeg();
    bytes = editImage(m, bytes, iref(info(bytes).images[0]!), { kind: "flip", axis: "h" });
    const p = info(bytes).images[0]!.placement as { flip?: boolean } & typeof at;
    expect(p.flip).toBe(true);
    expect(p.cx).toBeCloseTo(at.cx, 2);
    expect(p.width).toBeCloseTo(at.width, 2);
  });
});

describe("crop", () => {
  it("keeps the part, removes the rest of the pixels, and stays in place", () => {
    let bytes = withJpeg();
    const before = info(bytes).images[0]!;
    bytes = editImage(m, bytes, iref(before), {
      kind: "crop",
      part: { x0: 0.25, y0: 0, x1: 0.75, y1: 0.5 },
    });
    const after = info(bytes).images[0]!;
    // The left edge moved a quarter in, the top came down half way.
    expect(after.rect.l).toBeCloseTo(before.rect.l + at.width * 0.25, 0);
    expect(after.rect.t).toBeCloseTo(before.rect.b + at.height * 0.5, 0);
    expect(after.rect.r - after.rect.l).toBeCloseTo(at.width / 2, 0);
    // The stored picture is the kept part only.
    const out = exportImage(m, bytes, iref(after));
    expect(out.ext).toBe("png");
    const src = exportImage(m, withJpeg(), iref(info(withJpeg()).images[0]!));
    expect(src.ext).toBe("jpg");
    const full = imageFileSize(JPEG);
    const png = decodePng(out.data);
    expect(png.width).toBeCloseTo(full.width / 2, -1);
    expect(png.height).toBeCloseTo(full.height / 2, -1);
  });
});

describe("arrange", () => {
  it("sends an image to the back and brings it to the front", () => {
    let bytes = withJpeg();
    expect(order(bytes).at(-1)).toBe(3);
    bytes = editImage(m, bytes, iref(info(bytes).images[0]!), { kind: "arrange", how: "back" });
    expect(order(bytes)[0]).toBe(3);
    bytes = editImage(m, bytes, iref(info(bytes).images[0]!), { kind: "arrange", how: "front" });
    expect(order(bytes).at(-1)).toBe(3);
  });

  it("brings a text box in front of an image it overlaps", () => {
    const base = new Uint8Array(readFileSync(BASE));
    const box = info(base).boxes.find((b) => b.preview.startsWith("We selected"))!;
    const over = {
      cx: (box.rect.l + box.rect.r) / 2,
      cy: (box.rect.b + box.rect.t) / 2,
      width: 100,
      height: 40,
      rotation: 0,
    };
    let bytes = addImageToPage(m, base, 0, JPEG, over);
    expect(order(bytes).at(-1)).toBe(3);
    const b2 = info(bytes).boxes.find((b) => b.preview.startsWith("We selected"))!;
    bytes = arrangeBox(m, bytes, bref(b2), "forward");
    expect(order(bytes).at(-1)).toBe(1);
    expect(info(bytes).boxes.find((b) => b.preview.startsWith("We selected"))!.paragraphs).toEqual(
      b2.paragraphs,
    );
  });
});

describe("align", () => {
  it("lines an image and a text box up on their left edges", () => {
    let bytes = withJpeg();
    const box = info(bytes).boxes.find((b) => b.preview.startsWith("Two invoices"))!;
    const img = info(bytes).images[0]!;
    bytes = alignObjects(
      m,
      bytes,
      0,
      [
        { kind: "text", ref: bref(box) },
        { kind: "image", ref: iref(img) },
      ],
      "left",
    );
    const after = info(bytes);
    const left = Math.min(box.rect.l + 1, img.rect.l);
    expect(after.images[0]!.rect.l).toBeCloseTo(left, 0);
    expect(after.boxes.find((b) => b.preview.startsWith("Two invoices"))!.rect.l + 1).toBeCloseTo(
      left,
      0,
    );
  });
});
