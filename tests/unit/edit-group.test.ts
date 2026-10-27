// B3 Edit PDF: paragraph grouping. Every synthetic sample in tests/corpus/edit/
// (and real-format/, and local/ when generated) must group into the paragraphs its
// `.expected.json` lists; plus small hand-made cases for each rule.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { groupChars, groupPage, type PageChar, type TextBox } from "../../src/engine/edit";

const require = createRequire(import.meta.url);
const EDIT = join(__dirname, "..", "corpus", "edit");
const FOLDERS = [EDIT, join(EDIT, "real-format"), join(EDIT, "local")].filter(existsSync);

interface Expected {
  kind: string;
  text: string;
  lines: number;
  box?: boolean;
}

let m: PdfiumModule;
beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

// List markers are part of the box but not of the expected text.
const norm = (s: string) =>
  s
    .replace(/^[•▪●]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

/** Expected entries that grouping did not find (as text + line count). */
function misses(boxes: TextBox[], expected: Expected[]): string[] {
  const paras = boxes.flatMap((b) =>
    b.paragraphs.map((p) => ({ text: norm(p.text), lines: p.lines.length })),
  );
  const whole = boxes.map((b) => ({
    text: norm(b.paragraphs.map((p) => p.text).join(" ")),
    lines: b.lines.length,
  }));
  return expected
    .filter((e) => {
      const hit = (e.box ? whole : paras).find((f) => f.text === norm(e.text));
      return !hit || hit.lines !== e.lines;
    })
    .map((e) => `${e.kind}: ${e.text} (${e.lines})`);
}

describe("grouping matches the corpus expectations", () => {
  const files = FOLDERS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => ({ dir, name: f.replace(/\.pdf$/, "") })),
  );
  it.each(files)("$name ($dir)", ({ dir, name }) => {
    const expected = JSON.parse(
      readFileSync(join(dir, `${name}.expected.json`), "utf8"),
    ) as Expected[];
    const doc = RawDoc.open(m, new Uint8Array(readFileSync(join(dir, `${name}.pdf`))));
    try {
      const boxes = doc.withPage(0, (page) => groupPage(m, page).boxes);
      expect(misses(boxes, expected)).toEqual([]);
    } finally {
      doc.close();
    }
  });
});

/** Hand-made chars: one glyph per letter at a fixed advance, spaces skipped. */
function line(text: string, x: number, y: number, size = 10, obj = 1, adv = 0.5): PageChar[] {
  const out: PageChar[] = [];
  let cx = x;
  for (const ch of text) {
    if (ch !== " ")
      out.push({
        index: 0,
        ch,
        generated: false,
        x: cx,
        y,
        l: cx,
        r: cx + adv * size,
        b: y - 0.2 * size,
        t: y + 0.8 * size,
        size,
        font: "Helvetica",
        obj,
      });
    cx += adv * size;
  }
  return out;
}

function group(...chars: PageChar[][]): TextBox[] {
  const all = chars.flat().map((c, index) => ({ ...c, index }));
  return groupChars(all, { h: [], v: [] });
}

const texts = (boxes: TextBox[]) => boxes.flatMap((b) => b.paragraphs.map((p) => p.text));

describe("grouping rules", () => {
  it("wraps lines with the same left edge and leading into one paragraph", () => {
    const boxes = group(
      line("the first line of a paragraph runs", 72, 700),
      line("on to the second line here", 72, 688),
    );
    expect(texts(boxes)).toEqual(["the first line of a paragraph runs on to the second line here"]);
  });

  it("splits dot leaders off a label", () => {
    const boxes = group(line("Taxable interest . . . . . . . .", 72, 700));
    expect(texts(boxes)).toEqual(["Taxable interest", ". . . . . . . ."]);
  });

  it("keeps an ellipsis of three dots in the text", () => {
    expect(texts(group(line("and so on...", 72, 700)))).toEqual(["and so on..."]);
  });

  it("treats a typed rule as a separator between boxes", () => {
    const boxes = group(
      line("DESCRIPTION", 72, 700),
      line("----------", 72, 689),
      line("FIRST SAMPLE BANK", 72, 678),
    );
    expect(boxes.map((b) => b.paragraphs.map((p) => p.text))).toEqual([
      ["DESCRIPTION"],
      ["----------"],
      ["FIRST SAMPLE BANK"],
    ]);
  });

  it("keeps a column of amounts one per paragraph", () => {
    const boxes = group(line("812.", 500, 700), line("422.", 500, 689));
    expect(texts(boxes)).toEqual(["812.", "422."]);
  });

  it("cuts a row at a wide gap, keeping both parts on the same text object", () => {
    // One Tj holding a description and an amount (Courier statements).
    const boxes = group(line("FIRST SAMPLE BANK                     812.", 72, 700, 10, 7, 0.6));
    expect(texts(boxes)).toEqual(["FIRST SAMPLE BANK", "812."]);
    expect(boxes.map((b) => b.objects)).toEqual([[7], [7]]);
  });

  it("starts a new paragraph at a bullet and after a label", () => {
    const boxes = group(line("Date: February 3, 2025", 72, 700), line("• first item", 72, 688));
    expect(texts(boxes)).toEqual(["Date: February 3, 2025", "• first item"]);
  });
});
