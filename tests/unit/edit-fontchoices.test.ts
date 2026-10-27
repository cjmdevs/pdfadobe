// B3 Edit PDF: the font picker's sections and what a pick resolves to, with warnings.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  indexedFaces,
  updateFontIndex,
  type FontFileEntry,
  type IndexedFace,
} from "../../src/engine/edit/fonts";
import { FaceMetrics, tableDirectory } from "../../src/engine/edit/fonts/sfnt";
import {
  fontOptions,
  inWinAnsi,
  resolveFont,
  type FontOption,
} from "../../src/ui/edit/fontChoices";

const require = createRequire(import.meta.url);
const STD = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
const NOTO = join(__dirname, "..", "..", "node_modules", "@embedpdf", "fonts-latin", "fonts");
const LIB = join(STD, "LiberationSans-Regular.ttf");
const LIB_BOLD = join(STD, "LiberationSans-Bold.ttf");
const NOTO_REG = join(NOTO, "NotoSans-Regular.ttf");
const RESTRICTED = "Restricted.ttf";

function bytes(path: string): Uint8Array {
  if (path !== RESTRICTED) return new Uint8Array(readFileSync(path));
  const b = new Uint8Array(readFileSync(NOTO_REG));
  // A firm font marked Restricted License (and renamed so it is its own family).
  new DataView(b.buffer).setUint16(tableDirectory(b).get("OS/2")!.off + 8, 0x0002);
  return b;
}

let faces: IndexedFace[];
const deps = {
  metrics: async (f: IndexedFace) => new FaceMetrics(bytes(f.path), f.index),
  bytes: async (f: IndexedFace) => bytes(f.path),
};
const entry = (path: string, source: FontFileEntry["source"]): FontFileEntry => ({
  path,
  source,
  size: 1,
  mtime: 1,
});

beforeAll(async () => {
  faces = indexedFaces(
    await updateFontIndex(
      null,
      [entry(LIB, "firm"), entry(LIB_BOLD, "firm"), entry(NOTO_REG, "windows")],
      async (p) => bytes(p),
    ),
  );
});

const opt = (options: FontOption[], key: string) => options.find((o) => o.key === key)!;

describe("fontOptions", () => {
  it("lists this page's fonts, standard fonts, then firm, then Windows families, once each", () => {
    const options = fontOptions(
      ["ABCDEF+Calibri", "ABCDEF+Calibri-Bold", "Helvetica", "TimesNewRomanPS-BoldMT"],
      faces,
    );
    expect(options.map((o) => [o.section, o.label])).toEqual([
      ["document", "Calibri"],
      ["document", "Helvetica"],
      ["document", "Times New Roman"],
      // Standard fonts the page doesn't already list (Helvetica is in the document).
      ["standard", "Times"],
      ["standard", "Courier"],
      ["firm", "Liberation Sans"],
      ["windows", "Noto Sans"],
    ]);
  });
});

describe("resolveFont", () => {
  const options = () =>
    fontOptions(["ABCDEF+Calibri", "Helvetica", "ABCDEF+LiberationSans"], faces);

  it("keeps the paragraph's own font when nothing about it changes", async () => {
    const r = await resolveFont({
      option: opt(options(), "document:calibri"),
      bold: false,
      italic: false,
      text: "Total",
      ownFont: "ABCDEF+Calibri",
      faces,
      ...deps,
    });
    expect(r.font).toEqual({ kind: "original" });
    expect(r.warnings).toEqual([]);
  });

  it("uses the standard 14 font by style, not embedded, and flags letters outside WinAnsi", async () => {
    const base = { option: opt(options(), "document:helvetica"), ownFont: null, faces, ...deps };
    const bold = await resolveFont({ ...base, bold: true, italic: true, text: "Total €5" });
    expect(bold.font).toEqual({ kind: "standard", name: "Helvetica-BoldOblique" });
    expect(bold.warnings).toEqual([]);
    const bad = await resolveFont({ ...base, bold: false, italic: false, text: "≥ 10" });
    expect(bad.warnings).toEqual([{ level: "error", text: "Helvetica has no ≥." }]);
    expect(inWinAnsi("’")).toBe(true);
    expect(inWinAnsi("Ł")).toBe(false);
  });

  it("maps another embedded font to the installed one, or says what replaces it", async () => {
    const same = await resolveFont({
      option: opt(options(), "document:liberationsans"),
      bold: true,
      italic: false,
      text: "Total",
      ownFont: "ABCDEF+Calibri",
      faces,
      ...deps,
    });
    expect(same.font).toMatchObject({ kind: "file", face: { path: LIB_BOLD } });
    expect(same.warnings[0]?.text).toMatch(/Uses the installed Liberation Sans Bold/);

    const closest = await resolveFont({
      option: opt(options(), "document:calibri"),
      bold: true,
      italic: false,
      text: "Total",
      ownFont: "ABCDEF+Calibri",
      faces,
      ...deps,
    });
    expect(closest.font?.kind).toBe("file");
    expect(closest.warnings[0]?.text).toMatch(/Calibri isn't installed: uses the closest font/);
  });

  it("uses the family's real bold face, and simulates bold and italic it lacks", async () => {
    const o = opt(options(), "firm:liberationsans");
    const realBold = await resolveFont({
      option: o,
      bold: true,
      italic: false,
      text: "A",
      ownFont: null,
      faces,
      ...deps,
    });
    expect(realBold).toMatchObject({ fakeBold: false, font: { face: { path: LIB_BOLD } } });
    const fake = await resolveFont({
      option: o,
      bold: true,
      italic: true,
      text: "A",
      ownFont: null,
      faces,
      ...deps,
    });
    expect(fake).toMatchObject({ fakeBold: false, fakeItalic: true });
    expect(fake.warnings.map((w) => w.text)).toContain(
      "Liberation Sans has no italic: italic is simulated.",
    );
  });

  it("warns about missing letters and refuses restricted fonts", async () => {
    const noto = opt(options(), "windows:notosans");
    const missing = await resolveFont({
      option: noto,
      bold: false,
      italic: false,
      text: "Total 中",
      ownFont: null,
      faces,
      ...deps,
    });
    expect(missing.warnings).toContainEqual({
      level: "error",
      text: "Noto Sans Regular has no 中.",
    });

    const withRestricted = indexedFaces(
      await updateFontIndex(null, [entry(RESTRICTED, "firm")], async (p) => bytes(p)),
    );
    const r = await resolveFont({
      option: { key: "firm:notosans", section: "firm", label: "Noto Sans" },
      bold: false,
      italic: false,
      text: "A",
      ownFont: null,
      faces: withRestricted,
      ...deps,
    });
    expect(r.font).toBeNull();
    expect(r.warnings).toEqual([
      { level: "error", text: "This font's license does not allow embedding." },
    ]);
  });
});
