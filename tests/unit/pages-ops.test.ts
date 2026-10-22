// Every page operation, checked with qpdf and pdf.js.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as UTIF from "utif2";
import { OUT_DIR } from "../corpus/generate.mjs";
import { inspectPdf, outlineLines } from "../helpers/pdf-inspect";
import { nodePagesCtx } from "../helpers/pages-ctx";
import {
  bookmarkPages,
  cleanAfterRestructure,
  cropPages,
  deleteBookmarkWithPages,
  deletePages,
  duplicatePages,
  extractBookmarkPages,
  extractPages,
  imagePages,
  imagesToPdf,
  insertBlankPages,
  insertPages,
  moveBookmarkWithPages,
  partsByCount,
  replacePages,
  rotatePages,
  setPageSize,
  splitBySize,
  splitParts,
  type PagesCtx,
} from "../../src/engine/pages";

const FIX = join(OUT_DIR, "..", "fixtures");
const IRS = join(OUT_DIR, "..", "irs");
let ctx: PagesCtx;
let wpA: Uint8Array;
let wpB: Uint8Array;
let nav: Uint8Array;
const read = (dir: string, f: string) => new Uint8Array(readFileSync(join(dir, f)));
const pageIds = (t: string[]) =>
  t.map((s) => /Workpaper (\w) - page (\d)/.exec(s)?.slice(1).join("") ?? "?");

beforeAll(async () => {
  ctx = await nodePagesCtx();
  wpA = read(OUT_DIR, "workpaper-a.pdf");
  wpB = read(OUT_DIR, "workpaper-b.pdf");
  nav = read(OUT_DIR, "navigation.pdf");
});

describe("structure", () => {
  it("deletes pages; bookmarks to deleted pages go, parents re-point to children", async () => {
    const i = await inspectPdf(await deletePages(ctx, wpA, [0]));
    expect(i.checkError).toBeNull();
    expect(pageIds(i.pageText)).toEqual(["A2", "A3"]);
    expect(outlineLines(i.outline)).toEqual(["A Cover@1", ".A Detail@1", "A Summary@2"]);
    // The text field lived on the deleted page: it is gone from /Fields too.
    expect(i.fields.some((f) => f.name.includes("client"))).toBe(false);
    await expect(deletePages(ctx, wpA, [0, 1, 2])).rejects.toThrow(/every page/);
  });

  it("duplicates pages right after the selection, with independent field copies", async () => {
    const i = await inspectPdf(await duplicatePages(ctx, wpA, [0]));
    expect(pageIds(i.pageText)).toEqual(["A1", "A1", "A2", "A3"]);
    const client = i.fields.filter((f) => f.name.includes("client"));
    expect(client).toHaveLength(2);
    expect(new Set(client.map((f) => f.name)).size).toBe(2);
    expect(client.every((f) => f.value === "Sample Client A")).toBe(true);
    expect(outlineLines(i.outline)[0]).toBe("A Cover@1");
  });

  it("extracts pages with only their bookmarks", async () => {
    const i = await inspectPdf(await extractPages(ctx, wpA, [2, 1]));
    expect(pageIds(i.pageText)).toEqual(["A3", "A2"]);
    expect(outlineLines(i.outline)).toEqual(["A Cover@2", ".A Detail@2", "A Summary@1"]);
    expect(i.annotations.filter((a) => a.subtype === "Square").map((a) => a.page)).toEqual([2]);
  });

  it("inserts pages from another PDF, bringing its bookmarks and renamed fields", async () => {
    const i = await inspectPdf(await insertPages(ctx, wpA, wpB, [0, 1], 1));
    expect(i.checkError).toBeNull();
    expect(pageIds(i.pageText)).toEqual(["A1", "B1", "B2", "A2", "A3"]);
    expect(outlineLines(i.outline)).toEqual([
      "A Cover@1",
      ".A Detail@4",
      "B Cover@2",
      ".B Detail@3",
      "A Summary@5",
    ]);
    const client = i.fields.filter((f) => f.name.includes("client"));
    expect(client.map((f) => [f.page, f.value])).toEqual([
      [1, "Sample Client A"],
      [2, "Sample Client B"],
    ]);
    expect(new Set(client.map((f) => f.name)).size).toBe(2);
  });

  it("replaces pages one for one; bookmarks point at the replacements", async () => {
    const i = await inspectPdf(await replacePages(ctx, wpA, [1], wpB, [1]));
    expect(pageIds(i.pageText)).toEqual(["A1", "B2", "A3"]);
    expect(outlineLines(i.outline)).toEqual(["A Cover@1", ".A Detail@2", "A Summary@3"]);
    await expect(replacePages(ctx, wpA, [1, 2], wpB, [0])).rejects.toThrow(/same number/);
  });

  it("removes stale XFA and usage rights from IRS forms after a page change", async () => {
    const w9 = read(IRS, "fw9.pdf");
    const out = await extractPages(ctx, w9, [0]);
    const raw = Buffer.from(await cleanAfterRestructure(ctx, out)).toString("latin1");
    const i = await inspectPdf(out);
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(1);
    expect(i.fields.length).toBeGreaterThan(5);
    // Uncompressed check through qpdf's JSON: neither key remains.
    const json = JSON.stringify(
      await ctx.qpdf
        .run({
          inputs: { "in0.pdf": out },
          args: ["--json=2", "--json-key=qpdf", "in0.pdf", "-"],
          outputs: [],
        })
        .then((r) => r.stdout),
    );
    expect(json).not.toContain('\\"/XFA\\"');
    expect(json).not.toContain('\\"/Perms\\"');
    expect(raw.length).toBeGreaterThan(0);
  });
});

describe("geometry", () => {
  it("rotates on top of the existing rotation", async () => {
    // navigation.pdf page 6 already has /Rotate 90.
    const i = await inspectPdf(rotatePages(ctx.module, nav, [0, 5], 1));
    expect(i.pageSizes[0]!.rotate).toBe(90);
    expect(i.pageSizes[5]!.rotate).toBe(180);
    expect(i.pageSizes[1]!.rotate).toBe(0);
    expect(outlineLines(i.outline)).toEqual(outlineLines((await inspectPdf(nav)).outline));
  });

  it("crops with margins as seen, including on rotated pages", async () => {
    const out = cropPages(ctx.module, nav, [0, 5], { left: 36, top: 72, right: 0, bottom: 0 });
    const before = await inspectPdf(nav);
    const after = await inspectPdf(out);
    expect(after.pageSizes[0]).toMatchObject({
      width: before.pageSizes[0]!.width - 36,
      height: before.pageSizes[0]!.height - 72,
    });
    // Rotated 90°: "top" as seen is the box's left edge, so width shrinks by 72.
    expect(after.pageSizes[5]).toMatchObject({
      width: before.pageSizes[5]!.width - 72,
      height: before.pageSizes[5]!.height - 36,
    });
    // The page itself shrinks too (MediaBox), so viewers that ignore the CropBox and
    // printers see the crop (owner report: "cropping does not apply to other software").
    for (const i of [0, 5]) {
      const s = after.pageSizes[i]!;
      expect([s.mediaWidth, s.mediaHeight]).toEqual([s.width, s.height]);
    }
    expect(after.pageSizes[1]).toEqual(before.pageSizes[1]);
    expect(() =>
      cropPages(ctx.module, nav, [0], { left: 400, right: 400, top: 0, bottom: 0 }),
    ).toThrow(/nothing/);
  });

  it("sets page size, scaling content and annotations, keeping fields", async () => {
    const out = setPageSize(ctx.module, wpA, [0], { width: 842, height: 1191 }); // A3-ish
    const i = await inspectPdf(out);
    expect(i.checkError).toBeNull();
    expect(i.pageSizes[0]).toMatchObject({ width: 842, height: 1191 });
    expect(i.pageText[0]).toContain("Workpaper A - page 1");
    expect(i.fields.find((f) => f.name === "client.name")?.value).toBe("Sample Client A");
  });

  it("set page size after a crop keeps the crop (owner report: crop lost in Acrobat)", async () => {
    // Crop 1.5 in off the top of page 1 (removes the "Workpaper A" heading at y=720),
    // then make it Legal. The heading must stay hidden.
    const cropped = cropPages(ctx.module, wpA, [0], { left: 0, top: 108, right: 0, bottom: 0 });
    const legal = setPageSize(ctx.module, cropped, [0], { width: 612, height: 1008 });
    const i = await inspectPdf(legal);
    expect(i.pageSizes[0]).toMatchObject({ width: 612, height: 1008 });
    // Render and look for ink in the band above the placed (cropped) area: the content is
    // 684 pt tall, centred on 1008, so the top 162 pt must be blank.
    const doc = await ctx.engine
      .openDocumentBuffer({ id: "crop-size", content: legal.slice().buffer })
      .toPromise();
    try {
      const img = await ctx.engine
        .renderPageRaw(doc, doc.pages[0]!, { scaleFactor: 1 })
        .toPromise();
      let ink = 0;
      for (let y = 0; y < 150; y++) {
        for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4]! < 200) ink++;
      }
      expect(ink).toBe(0);
    } finally {
      await ctx.engine.closeDocument(doc).toPromise();
    }
  });

  it("inserts blank pages sized like their neighbour", async () => {
    const i = await inspectPdf(insertBlankPages(ctx.module, nav, 2, 2));
    expect(i.pages).toBe(10);
    expect(i.pageSizes[2]).toMatchObject({
      width: i.pageSizes[1]!.width,
      height: i.pageSizes[1]!.height,
    });
    // Bookmarks keep pointing at the same pages, now shifted.
    expect(outlineLines(i.outline).find((l) => l.startsWith("Part II"))).toBe(
      "Part II - Schedules@9",
    );
  });
});

describe("images", () => {
  /** Share of dark pixels in a page rendered by PDFium (catches inverted scans). */
  const renderedDark = async (pdf: Uint8Array, page = 0) => {
    const doc = await ctx.engine
      .openDocumentBuffer({ id: `img-${Math.random()}`, content: pdf.slice().buffer })
      .toPromise();
    try {
      const img = await ctx.engine
        .renderPageRaw(doc, doc.pages[page]!, { scaleFactor: 0.5 })
        .toPromise();
      return darkShare(img.data);
    } finally {
      await ctx.engine.closeDocument(doc).toPromise();
    }
  };
  const darkShare = (rgba: ArrayLike<number>) => {
    let dark = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! < 128) dark++;
    return dark / (rgba.length / 4);
  };
  /** Reference: the TIFF decoded independently by UTIF. */
  const sourceDark = (file: string, page = 0) => {
    const b = read(FIX, file);
    const buf = b.slice().buffer;
    const ifd = UTIF.decode(buf)[page]!;
    UTIF.decodeImage(buf, ifd);
    return darkShare(UTIF.toRGBA8(ifd));
  };

  it("embeds a 3-page MinIsWhite CCITT G4 scan unchanged, on Letter pages, not inverted", async () => {
    const pages = imagePages(read(FIX, "scan-g4-3p.tif"));
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({
      width: 1700,
      height: 2200,
      dpi: { x: 200, y: 200 },
      filter: "CCITTFaxDecode",
    });
    const pdf = imagesToPdf(pages);
    const i = await inspectPdf(pdf);
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(3);
    expect(i.pageSizes[0]!.width).toBeCloseTo(612, 0);
    expect(i.pageSizes[0]!.height).toBeCloseTo(792, 0);
    expect(pdf.byteLength).toBeLessThan(read(FIX, "scan-g4-3p.tif").byteLength + 3000);
    const src = sourceDark("scan-g4-3p.tif");
    expect(src).toBeGreaterThan(0.005);
    expect(src).toBeLessThan(0.2);
    expect(Math.abs((await renderedDark(pdf)) - src)).toBeLessThan(0.02);
  });

  it("handles MinIsBlack G4 and multi-strip G4 (decoded to 1-bit Flate)", async () => {
    for (const f of ["scan-g4-minisblack.tif", "scan-g4-strips.tif"]) {
      const pages = imagePages(read(FIX, f));
      const pdf = imagesToPdf(pages);
      expect((await inspectPdf(pdf)).checkError).toBeNull();
      expect(Math.abs((await renderedDark(pdf)) - sourceDark(f))).toBeLessThan(0.02);
    }
    expect(imagePages(read(FIX, "scan-g4-strips.tif"))[0]).toMatchObject({
      filter: "FlateDecode",
      bitsPerComponent: 1,
    });
  });

  it("embeds JPEG unchanged and gray TIFF as 8-bit gray, at their DPI", async () => {
    const jpg = imagePages(read(FIX, "photo-rgb.jpg"));
    expect(jpg[0]).toMatchObject({
      filter: "DCTDecode",
      width: 900,
      height: 600,
      dpi: { x: 150, y: 150 },
    });
    const gray = imagePages(read(FIX, "gray-lzw.tif"));
    expect(gray[0]).toMatchObject({ colorSpace: "DeviceGray", bitsPerComponent: 8 });
    const pdf = imagesToPdf([...jpg, ...gray]);
    const i = await inspectPdf(pdf);
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(2);
    expect(i.pageSizes[0]).toMatchObject({ width: 432, height: 288 });
    expect(i.pageSizes[1]!.width).toBeCloseTo(612, 0);
    expect(Math.abs((await renderedDark(pdf, 1)) - sourceDark("gray-lzw.tif"))).toBeLessThan(0.02);
  });

  it("decodes PNG (with transparency) and keeps the mask", async () => {
    const png = read(OUT_DIR, "stamp-reviewed.png");
    const [p] = imagePages(png);
    expect(p!.filter).toBe("FlateDecode");
    const pdf = imagesToPdf([p!]);
    expect((await inspectPdf(pdf)).checkError).toBeNull();
    expect(Buffer.from(pdf).toString("latin1")).toContain(p!.alpha ? "/SMask" : "/Image");
  });

  it("inserts image pages into a document at a position", async () => {
    const imgPdf = imagesToPdf(imagePages(read(FIX, "scan-g4-3p.tif")));
    const i = await inspectPdf(await insertPages(ctx, wpA, imgPdf, [0, 1, 2], 3));
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(6);
    expect(pageIds(i.pageText).slice(0, 3)).toEqual(["A1", "A2", "A3"]);
  });
});

describe("split", () => {
  it("by page count", async () => {
    const long = read(OUT_DIR, "long-200p.pdf");
    const parts = await splitParts(ctx, long, partsByCount(200, 75));
    expect(parts.map((p) => p.pages.length)).toEqual([75, 75, 50]);
    expect((await inspectPdf(parts[2]!.bytes)).pageText[0]).toContain("Page 151 of 200");
  });

  it("by file size, every part under the limit", async () => {
    const long = read(OUT_DIR, "long-200p.pdf");
    const limit = Math.ceil(long.byteLength / 3);
    const parts = await splitBySize(ctx, long, limit);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.every((p) => p.bytes.byteLength <= limit)).toBe(true);
    expect(parts.flatMap((p) => p.pages)).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it("flags a single page that is over the limit on its own", async () => {
    const parts = await splitBySize(ctx, wpA, 1000);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.oversize)).toBe(true);
  });
});

describe("bookmark-driven page operations", () => {
  // navigation.pdf: Cover p1; Part I - Sizes p2 (children); Part II - Schedules p7 (children)
  it("finds a bookmark's pages", async () => {
    expect(await bookmarkPages(ctx, nav, [1])).toEqual([1, 2, 3, 4, 5]);
  });

  it("deletes a bookmark together with its pages", async () => {
    const i = await inspectPdf(await deleteBookmarkWithPages(ctx, nav, [1]));
    expect(i.pages).toBe(3);
    expect(i.outline.map((b) => `${b.title}@${b.page}`)).toEqual([
      "Cover@1",
      "Part II - Schedules@2",
    ]);
  });

  it("extracts a bookmark's pages with its child bookmarks", async () => {
    const i = await inspectPdf(await extractBookmarkPages(ctx, nav, [2]));
    expect(i.pages).toBe(2);
    expect(i.outline).toHaveLength(1);
    expect(i.outline[0]!.title).toBe("Part II - Schedules");
    expect(i.outline[0]!.page).toBe(1);
    expect(i.outline[0]!.kids.length).toBeGreaterThan(0);
  });

  it("moves a bookmark's pages and children when the bookmark is dragged", async () => {
    const before = await inspectPdf(nav);
    // Drag "Part II" (pages 7-8) above "Part I".
    const i = await inspectPdf(await moveBookmarkWithPages(ctx, nav, [2], [], 1));
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(8);
    expect(i.outline.map((b) => `${b.title}@${b.page}`)).toEqual([
      "Cover@1",
      "Part II - Schedules@2",
      "Part I - Sizes@4",
    ]);
    // Page content moved with the bookmark: old page 7 is now page 2.
    expect(i.pageText[1]).toBe(before.pageText[6]);
    expect(i.pageText[3]).toBe(before.pageText[1]);
    // Children moved and re-pointed.
    const kidsBefore = before.outline[2]!.kids.map((k) => [k.title, k.page! - 5]);
    expect(i.outline[1]!.kids.map((k) => [k.title, k.page])).toEqual(kidsBefore);
  });
});
