// B3 Edit PDF: images. Add (JPEG unchanged, PNG with alpha), move, resize, rotate,
// replace and delete; results checked after save + reopen, with qpdf for the image
// streams themselves (a JPEG must stay byte-for-byte the same DCTDecode stream).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import {
  addImage,
  deleteImage,
  imageFileSize,
  matrixToPlacement,
  pageImages,
  placeImage,
  placementToMatrix,
  replaceImage,
  type Placement,
} from "../../src/engine/edit/images";
import { EditRefused } from "../../src/engine/edit";
import { qpdfBin } from "../corpus/generate.mjs";
import { changedOutside, renderPage, type Render } from "../helpers/edit-render";

const require = createRequire(import.meta.url);
const BASE = join(__dirname, "..", "corpus", "edit", "two-column.pdf");
const JPEG = new Uint8Array(
  readFileSync(join(__dirname, "..", "corpus", "fixtures", "photo-rgb.jpg")),
);

let m: PdfiumModule;
beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

/** A small RGBA PNG: left half opaque red, right half fully transparent. */
function png(w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      if (x < w / 2) raw.set([220, 20, 20, 255], o);
    }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Runs `fn` on page 1 of `bytes`, saves, returns the new bytes. */
function edit<T>(
  bytes: Uint8Array,
  fn: (doc: number, page: number) => T,
): { bytes: Uint8Array; value: T } {
  const doc = RawDoc.open(m, bytes);
  try {
    const value = doc.withPage(0, (page) => fn(doc.ptr, page));
    return { bytes: doc.save(), value };
  } finally {
    doc.close();
  }
}

function imagesOf(bytes: Uint8Array) {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(0, (page) => pageImages(m, page).map((img) => ({ ...img, obj: 0 })));
  } finally {
    doc.close();
  }
}

function render(bytes: Uint8Array): Render {
  const doc = RawDoc.open(m, bytes);
  try {
    return renderPage(m, doc, 0, 1);
  } finally {
    doc.close();
  }
}

function pixel(r: Render, x: number, y: number): number[] {
  const i = ((r.height - Math.round(y * r.scale)) * r.width + Math.round(x * r.scale)) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!];
}

/** Image XObject streams as written in the file (raw, not decoded), via qpdf. */
function imageStreams(bytes: Uint8Array): { filter: unknown; smask: boolean; data: Buffer }[] {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-img-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, bytes);
    const json = JSON.parse(
      execFileSync(
        qpdfBin(),
        ["--json=2", "--json-key=qpdf", "--json-stream-data=inline", "--decode-level=none", file],
        { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
      ),
    ) as {
      qpdf: [
        unknown,
        Record<string, { stream?: { dict: Record<string, unknown>; data?: string } }>,
      ];
    };
    return Object.values(json.qpdf[1])
      .map((o) => o.stream)
      .filter(
        (s): s is { dict: Record<string, unknown>; data?: string } =>
          s?.dict["/Subtype"] === "/Image",
      )
      .map((s) => ({
        filter: s.dict["/Filter"],
        smask: "/SMask" in s.dict,
        data: Buffer.from(s.data ?? "", "base64"),
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const at: Placement = { cx: 400, cy: 200, width: 120, height: 80, rotation: 0 };
const close = (a: Placement, b: Placement) => {
  for (const k of ["cx", "cy", "width", "height", "rotation"] as const)
    expect(a[k]).toBeCloseTo(b[k], 2);
};

describe("placement", () => {
  it("converts between centre/size/rotation and the image matrix", () => {
    for (const rotation of [0, 15, 90, -30, 180]) {
      const p = { ...at, rotation };
      close(matrixToPlacement(placementToMatrix(p)), p);
    }
    expect(placementToMatrix(at)).toEqual([120, 0, -0, 80, 340, 160]);
  });

  it("reads pixel sizes from JPEG and PNG headers", () => {
    expect(imageFileSize(png(6, 4))).toEqual({ width: 6, height: 4 });
    const j = imageFileSize(JPEG);
    expect(j.width).toBeGreaterThan(0);
    expect(j.height).toBeGreaterThan(0);
  });
});

describe("images", () => {
  it("adds a JPEG unchanged (same DCTDecode bytes) where it was asked", () => {
    const base = new Uint8Array(readFileSync(BASE));
    const { bytes } = edit(base, (doc, page) => addImage(m, doc, page, JPEG, at));
    const [img] = imagesOf(bytes);
    close(img!.placement, at);
    expect(img!.filters).toEqual(["DCTDecode"]);
    const streams = imageStreams(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.filter).toBe("/DCTDecode");
    expect(streams[0]!.data.equals(Buffer.from(JPEG))).toBe(true);
    // Nothing else on the page moved.
    expect(changedOutside(render(base), render(bytes), { l: 339, r: 461, b: 159, t: 241 })).toBe(0);
  });

  it("moves, resizes and rotates without re-encoding the JPEG", () => {
    const base = edit(new Uint8Array(readFileSync(BASE)), (doc, page) =>
      addImage(m, doc, page, JPEG, at),
    ).bytes;
    let bytes = base;
    for (const p of [
      { ...at, cx: 300, cy: 150 }, // move
      { ...at, cx: 300, cy: 150, width: 180, height: 120 }, // resize
      { ...at, cx: 300, cy: 150, width: 180, height: 120, rotation: 15 }, // rotate
    ]) {
      bytes = edit(bytes, (_doc, page) =>
        placeImage(m, page, pageImages(m, page)[0]!.obj, p),
      ).bytes;
      close(imagesOf(bytes)[0]!.placement, p);
    }
    const streams = imageStreams(bytes);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.data.equals(Buffer.from(JPEG))).toBe(true);
  });

  it("adds a PNG with its transparency", () => {
    const base = new Uint8Array(readFileSync(BASE));
    // Over empty page area, so the transparent half shows white page.
    const p: Placement = { cx: 306, cy: 100, width: 100, height: 50, rotation: 0 };
    const { bytes } = edit(base, (doc, page) => addImage(m, doc, page, png(8, 4), p));
    const [img] = imagesOf(bytes);
    expect(img!.pixels).toEqual({ width: 8, height: 4 });
    const streams = imageStreams(bytes);
    expect(streams.some((s) => s.smask)).toBe(true);
    // PDFium stores the pixels and the alpha Flate-compressed.
    expect(streams.map((s) => s.filter)).toEqual(["/FlateDecode", "/FlateDecode"]);
    const r = render(bytes);
    const [red, green, blue] = pixel(r, 280, 100);
    expect(red).toBeGreaterThan(180);
    expect(green! + blue!).toBeLessThan(120);
    expect(pixel(r, 335, 100)).toEqual([255, 255, 255]);
  });

  it("replaces a picture in place, fitting its proportions, keeping rotation and order", () => {
    const rotated = { ...at, rotation: 30 };
    const base = edit(new Uint8Array(readFileSync(BASE)), (doc, page) =>
      addImage(m, doc, page, JPEG, rotated),
    ).bytes;
    const { bytes, value } = edit(base, (_doc, page) =>
      replaceImage(m, page, pageImages(m, page)[0]!.obj, png(10, 10)),
    );
    // A square picture in a 120 x 80 box: 80 x 80, same centre and rotation.
    close(value, { ...rotated, width: 80, height: 80 });
    const imgs = imagesOf(bytes);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.pixels).toEqual({ width: 10, height: 10 });
    expect(imageStreams(bytes).some((s) => s.filter === "/DCTDecode")).toBe(false);
  });

  it("deletes an image and leaves the rest of the page as it was", () => {
    const original = new Uint8Array(readFileSync(BASE));
    const withImage = edit(original, (doc, page) => addImage(m, doc, page, JPEG, at)).bytes;
    const { bytes } = edit(withImage, (_doc, page) =>
      deleteImage(m, page, pageImages(m, page)[0]!.obj),
    );
    expect(imagesOf(bytes)).toEqual([]);
    expect(imageStreams(bytes)).toEqual([]);
    expect(changedOutside(render(original), render(bytes), { l: 0, r: 0, b: 0, t: 0 })).toBe(0);
  });

  it("refuses files that are not JPEG or PNG", () => {
    const base = new Uint8Array(readFileSync(BASE));
    expect(() =>
      edit(base, (doc, page) => addImage(m, doc, page, new TextEncoder().encode("GIF89a..."), at)),
    ).toThrow(EditRefused);
    expect(() =>
      edit(base, (doc, page) =>
        addImage(m, doc, page, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), at),
      ),
    ).toThrow(EditRefused);
  });
});
