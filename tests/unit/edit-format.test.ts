// B3 stage 2 step 3: formatting inside a paragraph. Character runs (font, size, colour,
// B/I/U), superscript, horizontal scaling, character and word spacing and kerning;
// the spacing is written by the content-stream pass (qpdf) and must land where the
// layout put it. Right indent and space after a paragraph.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import {
  applySpacing,
  createKerner,
  editBoxText,
  editPageInfo,
  groupPage,
  type Kerner,
  type PlainStyle,
  type RichText,
} from "../../src/engine/edit";
import { patchContent } from "../../src/engine/edit/spacing";
import { createSubsetter, type Subsetter } from "../../src/engine/edit/fonts/subset";
import { nodeQpdf } from "../helpers/qpdf-node";

const require = createRequire(import.meta.url);
const MEMO = join(__dirname, "..", "corpus", "edit", "memo.pdf");
const read = (p: string) => new Uint8Array(readFileSync(p));

let m: PdfiumModule;
let subset: Subsetter;
let kerner: Kerner;
beforeAll(async () => {
  m = (await createPdfium(read(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  subset = await createSubsetter(read(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")));
  kerner = await createKerner(read(require.resolve("harfbuzzjs/dist/harfbuzz.wasm")));
});

const qpdf = nodeQpdf();
const boxOf = (bytes: Uint8Array, start: string) =>
  editPageInfo(m, bytes, 0).boxes.find((b) => b.preview.startsWith(start))!;
const ref = (bytes: Uint8Array, start: string) => {
  const b = boxOf(bytes, start);
  return { page: 0, id: b.id, preview: b.preview };
};
const TIMES: Partial<PlainStyle> = { font: { kind: "standard", name: "Times-Roman" } };

/** Glyphs of the page after an edit, by letter, in order. */
function glyphs(bytes: Uint8Array) {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(0, (p) => groupPage(m, p).chars.filter((c) => !c.generated && c.ch.trim()));
  } finally {
    doc.close();
  }
}

async function edit(
  paras: (string | RichText)[],
  style: Partial<PlainStyle>,
  start = "We selected",
) {
  const bytes = read(MEMO);
  const out = editBoxText(
    m,
    bytes,
    ref(bytes, start),
    paras,
    { subset, kerner },
    paras.map(() => style),
  );
  const final = out.result?.spaced ? await applySpacing(qpdf, out.bytes, [0]) : out.bytes;
  return { ...out, final };
}

describe("character runs", () => {
  it("writes a bold, red, bigger word and a superscript inside one paragraph", async () => {
    const text = "Revenue was tested in 2024 and found fine.";
    const bold = { start: 0, end: 7 };
    const sup = { start: 25, end: 26 }; // the "4" of 2024
    const o = await edit(
      [
        {
          text,
          runs: [
            {
              ...bold,
              style: {
                font: { kind: "standard", name: "Times-Bold" },
                bold: true,
                size: 14,
                color: { r: 200, g: 0, b: 0, a: 255 },
              },
            },
            { ...sup, style: { script: "super" } },
          ],
        },
      ],
      { ...TIMES, size: 11 },
    );
    // Only the new text (the memo's own text is in Liberation Sans).
    const g = glyphs(o.final).filter((c) => c.font.startsWith("Times"));
    const at = (s: string, n = 0) => g.filter((c) => c.ch === s)[n]!;
    expect(at("R").font).toMatch(/Bold/);
    expect(at("R").size).toBeCloseTo(14, 1);
    expect(at("w").font).not.toMatch(/Bold/);
    // The superscript 4 is smaller and above the baseline of the other digits.
    const two = at("2");
    const four = g.find((c) => c.ch === "4")!;
    expect(four.size).toBeCloseTo(11 * 0.6, 1);
    expect(four.y).toBeGreaterThan(two.y + 2);
    // Still one box, one paragraph, and the text reads back in order.
    expect(boxOf(o.final, "Revenue").paragraphs).toEqual([
      "Revenue was tested in 2024 and found fine.",
    ]);
  });
});

describe("spacing", () => {
  const word = (bytes: Uint8Array, w: string) => {
    const g = glyphs(bytes);
    const i = g.findIndex(
      (_, k) =>
        g
          .slice(k, k + w.length)
          .map((c) => c.ch)
          .join("") === w,
    );
    return g.slice(i, i + w.length);
  };

  it("character spacing (Tc) lands where the layout put it", async () => {
    const plain = await edit(["Wide letters here."], { ...TIMES, size: 12 });
    const wide = await edit(["Wide letters here."], { ...TIMES, size: 12, charSpacing: 200 });
    expect(wide.result?.spaced).toBe(true);
    const a = word(plain.final, "letters");
    const b = word(wide.final, "letters");
    // 200/1000 em at 12 pt = 2.4 pt more per letter.
    const gap = (g: typeof a) => (g.at(-1)!.x - g[0]!.x) / (g.length - 1);
    expect(gap(b) - gap(a)).toBeCloseTo(2.4, 1);
    // The box the engine laid out matches what PDFium reads back (the layout also
    // counts the spacing after the last letter).
    const box = boxOf(wide.final, "Wide");
    const laid = wide.result!.bounds.r - wide.result!.bounds.l;
    expect(laid - (box.rect.r - box.rect.l - 2)).toBeGreaterThanOrEqual(-0.5);
    expect(laid - (box.rect.r - box.rect.l - 2)).toBeLessThanOrEqual(2.4 + 0.5);
  });

  it("word spacing widens only the spaces", async () => {
    const plain = await edit(["one two three"], { ...TIMES, size: 12 });
    const wide = await edit(["one two three"], { ...TIMES, size: 12, wordSpacing: 500 });
    const o = (bytes: Uint8Array) => word(bytes, "one")[0]!.x;
    const t = (bytes: Uint8Array) => word(bytes, "three")[0]!.x;
    // Two spaces, 6 pt each.
    expect(t(wide.final) - o(wide.final) - (t(plain.final) - o(plain.final))).toBeCloseTo(12, 1);
    // Inside a word nothing changed.
    const w1 = word(plain.final, "three");
    const w2 = word(wide.final, "three");
    expect(w2[2]!.x - w2[0]!.x).toBeCloseTo(w1[2]!.x - w1[0]!.x, 2);
  });

  it("kerns standard fonts from their AFM pairs (AV closer)", async () => {
    const plain = await edit(["AVAVA"], { ...TIMES, size: 20 });
    const kerned = await edit(["AVAVA"], { ...TIMES, size: 20, kerning: true });
    const span = (bytes: Uint8Array) => {
      const g = word(bytes, "AVAVA");
      return g.at(-1)!.x - g[0]!.x;
    };
    expect(span(kerned.final)).toBeLessThan(span(plain.final) - 5);
  });

  it("kerns fonts from files with HarfBuzz", () => {
    const font = read(
      join(
        require.resolve("pdfjs-dist/package.json"),
        "..",
        "standard_fonts",
        "LiberationSans-Regular.ttf",
      ),
    );
    const k = kerner(font, 0)("AVATAR");
    expect(k[0]).toBeLessThan(0);
    expect(k.at(-1)).toBe(0);
  });

  it("horizontal scaling narrows the text through its matrix", async () => {
    const plain = await edit(["Narrow text"], { ...TIMES, size: 12 });
    const narrow = await edit(["Narrow text"], { ...TIMES, size: 12, hScale: 80 });
    expect(narrow.result?.spaced).toBeFalsy();
    const w = (bytes: Uint8Array) => {
      const g = word(bytes, "Narrow");
      return g.at(-1)!.r - g[0]!.l;
    };
    expect(w(narrow.final) / w(plain.final)).toBeCloseTo(0.8, 1);
  });
});

describe("paragraph spacing and indents", () => {
  it("keeps space after a paragraph and wraps inside a right indent", async () => {
    const long =
      "This paragraph is long enough to wrap onto several lines inside the box once the right indent takes some of its width away.";
    const plain = await edit([long, "Next."], { ...TIMES, size: 11 });
    const indented = await edit([long, "Next."], {
      ...TIMES,
      size: 11,
      indent: { first: 0, left: 0, right: 250 },
      spaceAfter: 12,
    });
    const b1 = boxOf(plain.final, "This paragraph");
    const b2 = boxOf(indented.final, "This paragraph");
    expect(b2.lines.length).toBeGreaterThan(b1.lines.length);
    const last = (b: typeof b1) => b.lines.at(-2)!.b; // "Next." is the last line
    const next = (bytes: Uint8Array) =>
      glyphs(bytes).find((c) => c.ch === "N" && c.font.startsWith("Times"))!.y;
    // "Next." sits 12 points further below its paragraph.
    expect(next(indented.final) - last(b2)).toBeLessThan(next(plain.final) - last(b1));
  });
});

describe("content-stream pass", () => {
  it("rewrites only our marked runs and drops the spacing keys", () => {
    const src =
      "q BT /F1 12 Tf (keep) Tj ET Q " +
      "/PWBox <</id 3 /Tc .5 /N 4 /K (1:-40)>> BDC q BT /F2 12 Tf <0024004500460047> Tj ET Q EMC";
    const out = new TextDecoder().decode(patchContent(new TextEncoder().encode(src))!);
    expect(out).toContain("(keep) Tj");
    expect(out).toContain(".5 Tc [<00240045> -40 <00460047>] TJ");
    expect(out).toMatch(/\/PWBox <<\/id 3\s*>> BDC/);
    expect(patchContent(new TextEncoder().encode("q BT (a) Tj ET Q"))).toBeNull();
    // An inline image: left alone.
    expect(
      patchContent(new TextEncoder().encode("/PWBox <</id 1 /N 1>> BDC BI /W 1 ID x EI EMC")),
    ).toBeNull();
  });
});

describe("lists", () => {
  it("numbers and letters count up; romans; bullets; a list keeps its start", async () => {
    const { numberLists, listOf } = await import("../../src/engine/edit/lists");
    const n = { kind: "number", format: "1." } as const;
    expect(numberLists([n, n, null, n])).toEqual(["1.", "2.", null, "1."]);
    expect(
      numberLists([
        { kind: "number", format: "a." },
        { kind: "number", format: "a." },
      ]),
    ).toEqual(["a.", "b."]);
    expect(
      numberLists([
        { kind: "number", format: "I." },
        { kind: "number", format: "I." },
        { kind: "number", format: "I." },
        { kind: "number", format: "I." },
      ]),
    ).toEqual(["I.", "II.", "III.", "IV."]);
    expect(numberLists([listOf("3."), listOf("4.")])).toEqual(["3.", "4."]);
    expect(listOf("•")).toEqual({ kind: "bullet", glyph: "•" });
    expect(listOf("ii.")).toMatchObject({ format: "i." });
  });

  it("turns paragraphs into a numbered list with a hanging indent, and back", async () => {
    const bytes = read(MEMO);
    const box = boxOf(bytes, "We selected");
    const texts = [
      "First thing to check carefully before the year end closes for good.",
      "Second thing.",
    ];
    const num = { kind: "number", format: "1." } as const;
    const on = editBoxText(m, bytes, ref(bytes, "We selected"), texts, { subset }, [
      { ...TIMES, list: num },
      { ...TIMES, list: num },
    ]);
    const listed = boxOf(on.bytes, "1. First");
    expect(listed.paragraphs.map((p) => p.slice(0, 3))).toEqual(["1. ", "2. "]);
    expect(listed.styles[0]?.list).toMatchObject({ kind: "number" });
    // The text hangs: the first line's text starts right of the marker.
    expect(listed.styles[0]!.indent!.first).toBeGreaterThan(listed.styles[0]!.marker!.at + 10);
    void box;
    // Off again: no marker, the text back at the left edge.
    const off = editBoxText(m, on.bytes, ref(on.bytes, "1. First"), listed.paragraphs, { subset }, [
      { list: null },
      { list: null },
    ]);
    const plain = boxOf(off.bytes, "First thing");
    expect(plain.paragraphs[0]).toMatch(/^First thing/);
    expect(plain.styles[0]?.marker).toBeUndefined();
  });
});

describe("runs found on the page", () => {
  const K1 = join(__dirname, "..", "corpus", "edit", "real-format", "k1-supplemental.pdf");

  it("finds a bold run-in head and keeps it bold through an edit", () => {
    const bytes = read(K1);
    const box = boxOf(bytes, "Box 1 - Ordinary");
    const head = box.runs[0]?.[0];
    expect(head).toMatchObject({ start: 0, bold: true });
    expect(box.paragraphs[0]!.slice(head!.start, head!.end)).toMatch(
      /^Box 1 - Ordinary business income \(loss\)\.?/,
    );
    const rich = box.paragraphs.map((text, i) => ({
      text: text + (i === 0 ? " Added." : ""),
      runs: box.runs[i]!.map((r) => ({
        start: r.start,
        end: r.end,
        style: {
          font: { kind: "original" as const, name: r.fontName },
          bold: r.bold,
          size: r.size,
        },
      })),
    }));
    const out = editBoxText(m, bytes, ref(bytes, "Box 1 - Ordinary"), rich, { subset });
    const again = boxOf(out.bytes, "Box 1 - Ordinary");
    expect(again.runs[0]?.[0]).toMatchObject({ start: 0, bold: true });
    expect(again.paragraphs[0]).toMatch(/Added\.$/);
  });
});
