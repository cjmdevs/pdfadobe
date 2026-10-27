// B3 Edit PDF: font tables, embedding permission, coverage, widths, subsetting, the
// font index cache and font matching. Uses only fonts shipped in node_modules
// (Liberation Sans from pdfjs-dist and Noto Sans from @embedpdf/fonts-latin, both
// OFL-1.1); Windows fonts are optional extras when present.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  describeFont,
  embeddingOf,
  FaceMetrics,
  tableDirectory,
  withPostScriptName,
} from "../../src/engine/edit/fonts/sfnt";
import { createSubsetter, type Subsetter } from "../../src/engine/edit/fonts/subset";
import {
  findStyle,
  indexedFaces,
  matchFont,
  parsePdfFontName,
  updateFontIndex,
  type FontFileEntry,
  type IndexedFace,
} from "../../src/engine/edit/fonts";

const require = createRequire(import.meta.url);
const STD = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
const NOTO = join(__dirname, "..", "..", "node_modules", "@embedpdf", "fonts-latin", "fonts");
const LIB = join(STD, "LiberationSans-Regular.ttf");
const LIB_BOLD = join(STD, "LiberationSans-Bold.ttf");
const NOTO_REG = join(NOTO, "NotoSans-Regular.ttf");
const RESTRICTED = "restricted-copy.ttf";
const read = (p: string) => new Uint8Array(readFileSync(p));

let subset: Subsetter;
beforeAll(async () => {
  subset = await createSubsetter(read(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")));
});

/** Copy of a font with a different fsType (test fixtures only; never saved). */
function withFsType(bytes: Uint8Array, fsType: number): Uint8Array {
  const b = bytes.slice();
  const os2 = tableDirectory(b).get("OS/2")!;
  new DataView(b.buffer).setUint16(os2.off + 8, fsType);
  return b;
}

describe("sfnt tables", () => {
  it("describes Liberation Sans", () => {
    const [f] = describeFont(read(LIB));
    expect(f).toMatchObject({
      family: "Liberation Sans",
      postscript: "LiberationSans",
      weight: 400,
      italic: false,
      monospace: false,
      cff: false,
      unitsPerEm: 2048,
    });
    expect(describeFont(read(LIB_BOLD))[0]?.weight).toBe(700);
  });

  it("gives nothing for a file that is not a font", () => {
    expect(describeFont(new TextEncoder().encode("not a font at all"))).toEqual([]);
  });

  it("reads embedding permission from fsType", () => {
    expect(embeddingOf(0)).toMatchObject({ allowed: true, subsetAllowed: true, note: null });
    expect(embeddingOf(0x0002)).toMatchObject({ allowed: false, level: "restricted" });
    expect(embeddingOf(0x0002).note).toMatch(/does not allow embedding/);
    expect(embeddingOf(0x0004)).toMatchObject({ allowed: true, level: "preview-print" });
    expect(embeddingOf(0x0008)).toMatchObject({ allowed: true, level: "editable", note: null });
    expect(embeddingOf(0x0100).subsetAllowed).toBe(false);
    expect(embeddingOf(0x0200).allowed).toBe(false);
    const restricted = describeFont(withFsType(read(NOTO_REG), 0x0002))[0]!;
    expect(embeddingOf(restricted.fsType).allowed).toBe(false);
  });

  it("knows which letters a face has and measures like the font's advances", () => {
    const m = new FaceMetrics(read(LIB));
    expect(m.missing("Taxable interest (Q4) \u2265 \u0141 \u4e2d")).toEqual(["\u4e2d"]);
    // Liberation Sans is metric-compatible with Helvetica: "a" = 556/1000 em.
    expect(m.width("a", 1000)).toBeCloseTo(556, 0);
    expect(m.width("Hello world", 10)).toBeCloseTo(
      new FaceMetrics(read(LIB)).width("Hello world", 10),
    );
  });
});

describe("subsetting", () => {
  it("keeps exactly the needed letters (plus space) and shrinks the file", () => {
    const full = read(LIB);
    const out = subset(full, 0, "Taxable interest");
    expect(out.byteLength).toBeLessThan(full.byteLength / 10);
    const m = new FaceMetrics(out);
    expect(m.missing("Taxable interest")).toEqual([]);
    expect(m.missing("Z")).toEqual(["Z"]);
    // Advances survive subsetting.
    expect(m.width("Taxable", 12)).toBeCloseTo(new FaceMetrics(full).width("Taxable", 12), 5);
  });

  it("renames a subset for its ABCDEF+ tag", () => {
    const out = withPostScriptName(
      subset(read(LIB), 0, "abc"),
      "ABCDEF+LiberationSans",
      "Liberation Sans",
    );
    const [f] = describeFont(out);
    expect(f?.postscript).toBe("ABCDEF+LiberationSans");
    expect(new FaceMetrics(out).missing("abc")).toEqual([]);
  });
});

const entry = (path: string, source: FontFileEntry["source"] = "firm"): FontFileEntry => {
  const st = statSync(path);
  return { path, source, size: st.size, mtime: st.mtimeMs };
};

describe("font index", () => {
  it("reads new files and reuses unchanged ones from the cache", async () => {
    const reads: string[] = [];
    const reader = async (p: string) => (reads.push(p), read(p));
    const listing = [entry(LIB), entry(LIB_BOLD), entry(NOTO_REG, "windows")];
    const first = await updateFontIndex(null, listing, reader);
    expect(reads).toHaveLength(3);
    const again = await updateFontIndex(JSON.parse(JSON.stringify(first)), listing, reader);
    expect(reads).toHaveLength(3); // nothing re-read
    expect(again).toEqual(first);
    // A changed file is read again; a file no longer listed is dropped.
    const changed = [{ ...entry(LIB), mtime: 1 }];
    const third = await updateFontIndex(again, changed, reader);
    expect(reads).toHaveLength(4);
    expect(third.files.map((f) => f.path)).toEqual([LIB]);
  });

  it("skips files it can't read and files that aren't fonts", async () => {
    const listing = [entry(LIB), { ...entry(LIB_BOLD), path: "Z:\\offline\\Missing.ttf" }];
    const cache = await updateFontIndex(
      null,
      [...listing, { ...entry(LIB), path: "notes.txt" }],
      async (p) => {
        if (p.startsWith("Z:")) throw new Error("share offline");
        return read(p);
      },
    );
    expect(cache.files.map((f) => f.path)).toEqual([LIB]);
  });

  it("lists firm faces first and finds a family's bold face", async () => {
    const cache = await updateFontIndex(
      null,
      [entry(NOTO_REG, "windows"), entry(LIB), entry(LIB_BOLD)],
      async (p) => read(p),
    );
    const faces = indexedFaces(cache);
    expect(faces.map((f) => f.source)).toEqual(["firm", "firm", "windows"]);
    expect(findStyle(faces, "Liberation Sans", true, false)?.path).toBe(LIB_BOLD);
    expect(findStyle(faces, "Liberation Sans", false, true)).toBeNull(); // -> fake oblique
  });
});

describe("matching a PDF font", () => {
  let faces: IndexedFace[];
  const metricsCache = new Map<string, FaceMetrics>();
  const metrics = async (f: IndexedFace) => {
    const key = `${f.path}#${f.index}`;
    const bytes = f.path === RESTRICTED ? withFsType(read(NOTO_REG), 0x0002) : read(f.path);
    if (!metricsCache.has(key)) metricsCache.set(key, new FaceMetrics(bytes, f.index));
    return metricsCache.get(key)!;
  };
  beforeAll(async () => {
    const restricted = { ...entry(NOTO_REG), path: RESTRICTED };
    const cache = await updateFontIndex(
      null,
      [entry(LIB), entry(LIB_BOLD), entry(NOTO_REG), restricted],
      async (p) => (p === RESTRICTED ? withFsType(read(NOTO_REG), 0x0002) : read(p)),
    );
    faces = indexedFaces(cache);
  });

  it("parses PDF font names", () => {
    expect(parsePdfFontName("ABCDEF+Calibri-Bold")).toMatchObject({
      family: "Calibri",
      bold: true,
    });
    expect(parsePdfFontName("Times-Roman")).toMatchObject({ family: "Times", bold: false });
    expect(parsePdfFontName("Arial,BoldItalic")).toMatchObject({ bold: true, italic: true });
    expect(parsePdfFontName("TimesNewRomanPS-BoldMT")).toMatchObject({
      family: "TimesNewRoman",
      bold: true,
    });
    expect(parsePdfFontName("LiberationSans-Bold-6940").postscript).toBe("LiberationSans-Bold");
  });

  it("finds the same font by name", async () => {
    const r = await matchFont(faces, "QWERTY+LiberationSans-Bold", { metrics });
    expect(r.exact?.path).toBe(LIB_BOLD);
    expect(r.twin).toBe(false);
  });

  it("uses the metric twin for a standard 14 font", async () => {
    const r = await matchFont(faces, "Helvetica", { metrics });
    expect(r).toMatchObject({ twin: true });
    expect(r.exact?.path).toBe(LIB);
    expect((await matchFont(faces, "Helvetica-Bold", { metrics })).exact?.path).toBe(LIB_BOLD);
  });

  it("proposes the closest faces by width, never a restricted one", async () => {
    const lib = await metrics(faces.find((f) => f.path === LIB)!);
    const text = "The amount shown is your share of the income";
    const r = await matchFont(faces, "ABCDEF+SomeSans", {
      metrics,
      needs: "Q4",
      sample: { text, width: lib.width(text, 1000) },
    });
    expect(r.exact).toBeNull();
    expect(r.proposals[0]?.face.path).toBe(LIB);
    expect(r.proposals[0]?.widthRatio).toBeCloseTo(1, 5);
    expect(r.proposals.some((p) => !p.face.embedding.allowed)).toBe(false);
  });

  it("leaves out faces that lack a needed letter", async () => {
    const r = await matchFont(faces, "ABCDEF+SomeSans", { metrics, needs: "\u4e2d" });
    expect(r.proposals).toEqual([]);
  });
});

// Windows fonts, when this machine has them: every face in the folder parses.
const WIN = join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
describe.runIf(existsSync(join(WIN, "arial.ttf")))("Windows fonts folder", () => {
  it("describes every TrueType face without throwing, Arial as expected", () => {
    const files = readdirSync(WIN).filter((f) => /\.(ttf|ttc)$/i.test(f));
    for (const f of files) describeFont(read(join(WIN, f)));
    const [arial] = describeFont(read(join(WIN, "arial.ttf")));
    expect(arial).toMatchObject({ family: "Arial", weight: 400 });
    expect(new FaceMetrics(read(join(WIN, "arial.ttf"))).width("a", 1000)).toBeCloseTo(556, 0);
  });
});
