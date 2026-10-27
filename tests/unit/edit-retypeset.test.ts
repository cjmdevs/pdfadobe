// B3 Edit PDF: re-typesetting a paragraph. On the synthetic corpus (Liberation subsets,
// standard 14 not embedded), checks what the spike checked: nothing outside the edit
// changes, pdf.js finds the new text, our grouping finds it again as one paragraph,
// new fonts are Type0 + ToUnicode with an ABCDEF+ subset name, and refusals leave
// the page exactly as it was.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import {
  detectStyle,
  EditRefused,
  groupPage,
  retypeset,
  type EditParagraph,
  type ParagraphStyle,
  type Rect,
  type RetypesetResult,
  type TextBox,
} from "../../src/engine/edit";
import { createSubsetter, type Subsetter } from "../../src/engine/edit/fonts/subset";
import { indexedFaces, updateFontIndex, type IndexedFace } from "../../src/engine/edit/fonts";
import { tableDirectory } from "../../src/engine/edit/fonts/sfnt";
import { qpdfBin } from "../corpus/generate.mjs";
import { pdfjsView } from "../helpers/leak-scan";
import { changedOutside, renderPage } from "../helpers/edit-render";

const require = createRequire(import.meta.url);
const EDIT = join(__dirname, "..", "corpus", "edit");
const REAL = join(EDIT, "real-format");
const STD = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
const NOTO = join(__dirname, "..", "..", "node_modules", "@embedpdf", "fonts-latin", "fonts");
const read = (p: string) => new Uint8Array(readFileSync(p));

let m: PdfiumModule;
let subset: Subsetter;
let faces: IndexedFace[];
const RESTRICTED = "restricted.ttf";

beforeAll(async () => {
  m = (await createPdfium(read(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  subset = await createSubsetter(read(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")));
  const files = [
    join(STD, "LiberationSans-Regular.ttf"),
    join(STD, "LiberationSans-Bold.ttf"),
    join(NOTO, "NotoSans-Regular.ttf"),
    RESTRICTED,
  ];
  const cache = await updateFontIndex(
    null,
    files.map((path) => ({ path, source: "firm" as const, size: 1, mtime: 1 })),
    async (p) => fontBytes(p),
  );
  faces = indexedFaces(cache);
});

function fontBytes(path: string): Uint8Array {
  if (path !== RESTRICTED) return read(path);
  const b = read(join(NOTO, "NotoSans-Regular.ttf"));
  new DataView(b.buffer).setUint16(tableDirectory(b).get("OS/2")!.off + 8, 0x0002);
  return b;
}

const face = (family: string, bold = false) =>
  faces.find((f) => f.family === family && f.weight >= 600 === bold && f.path !== RESTRICTED)!;
const fileFont = (f: IndexedFace) => ({ kind: "file" as const, face: f, bytes: fontBytes(f.path) });

interface Outcome {
  bytes: Uint8Array;
  result: RetypesetResult;
  box: TextBox;
  changedOutside: number;
  /** The page regrouped after the edit. */
  boxes: TextBox[];
  pdfjs: string;
}

/**
 * Edits the box holding a paragraph that starts with `target`. `make` gets the box's
 * current text and styles and returns the new paragraphs.
 */
async function edit(
  file: string,
  target: string,
  make: (text: string[], styles: ParagraphStyle[]) => EditParagraph[],
): Promise<Outcome> {
  const doc = RawDoc.open(m, read(file));
  try {
    const before = renderPage(m, doc);
    let box: TextBox | undefined;
    let result: RetypesetResult | undefined;
    doc.withPage(0, (page) => {
      const g = groupPage(m, page);
      box = g.boxes.find((b) => b.paragraphs.some((p) => p.text.startsWith(target)));
      if (!box) throw new Error(`no box for ${target}`);
      const styles = detectStyle(m, box, g.rules);
      const paras = make(
        box.paragraphs.map((p) => p.text),
        styles,
      );
      result = retypeset(
        m,
        doc.ptr,
        page,
        { kind: "box", box, chars: g.chars, rules: g.rules, others: g.boxes },
        paras,
        { subset },
      );
    });
    const bytes = doc.save();
    const after = RawDoc.open(m, bytes);
    try {
      const b = box!;
      const r = result!;
      // Pixels may change only where the old and new text are.
      const keep = grow(unionRect([b, r.bounds]), 1.5);
      return {
        bytes,
        result: r,
        box: b,
        changedOutside: changedOutside(before, renderPage(m, after), keep),
        boxes: after.withPage(0, (page) => groupPage(m, page).boxes),
        // pdf.js joins items without separators
        pdfjs: (await pdfjsView(bytes)).pageText[0] ?? "",
      };
    } finally {
      after.close();
    }
  } finally {
    doc.close();
  }
}

const norm = (s: string) => s.replace(/\s+/g, "");
const grow = (r: Rect, d: number): Rect => ({ l: r.l - d, r: r.r + d, b: r.b - d, t: r.t + d });
const unionRect = (rs: Rect[]): Rect => ({
  l: Math.min(...rs.map((r) => r.l)),
  r: Math.max(...rs.map((r) => r.r)),
  b: Math.min(...rs.map((r) => r.b)),
  t: Math.max(...rs.map((r) => r.t)),
});

/** The regrouped box whose text equals `text` (paragraphs joined). */
function findBox(o: Outcome, text: string): TextBox | undefined {
  return o.boxes.find((b) => norm(b.paragraphs.map((p) => p.text).join(" ")) === norm(text));
}

/** Page fonts as qpdf sees them: BaseFont, Subtype, ToUnicode, embedded program. */
function fontsOf(
  bytes: Uint8Array,
): { base: string; subtype: string; toUnicode: boolean; file: boolean }[] {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-edit-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, bytes);
    const json = JSON.parse(
      execFileSync(qpdfBin(), ["--json=2", "--json-key=qpdf", file], {
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      }),
    ) as { qpdf: [unknown, Record<string, { value?: Record<string, unknown> }>] };
    const objs = json.qpdf[1];
    const get = (ref: unknown) =>
      typeof ref === "string" && / R$/.test(ref)
        ? objs[`obj:${ref}`]?.value
        : (ref as Record<string, unknown>);
    return Object.values(objs)
      .map((o) => o.value)
      .filter(
        (v): v is Record<string, unknown> =>
          !!v && v["/Type"] === "/Font" && v["/Subtype"] !== "/CIDFontType2",
      )
      .map((f) => {
        let desc = get(f["/FontDescriptor"]);
        const kids = get(f["/DescendantFonts"]) as unknown;
        if (Array.isArray(kids)) desc = get(get(kids[0])?.["/FontDescriptor"]);
        return {
          base: String(f["/BaseFont"]),
          subtype: String(f["/Subtype"]),
          toUnicode: "/ToUnicode" in f,
          file: !!desc && ("/FontFile2" in desc || "/FontFile3" in desc || "/FontFile" in desc),
        };
      });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("retypeset in the PDF's own font", () => {
  it("rewraps a justified paragraph and keeps it justified", async () => {
    const o = await edit(join(EDIT, "engagement-letter.pdf"), "This letter confirms", (t, s) => [
      { text: t[0]!.replace("federal and state", "federal, state and local"), style: s[0]! },
    ]);
    expect(o.changedOutside).toBe(0);
    const text = o.box.paragraphs[0]!.text.replace("federal and state", "federal, state and local");
    const again = findBox(o, text);
    expect(again).toBeDefined();
    expect(again!.justified).toBe(true);
    expect(norm(o.pdfjs)).toContain(norm("federal, state and local"));
    expect(o.result.fonts).toEqual([
      expect.objectContaining({ kind: "original", embedded: "unchanged" }),
    ]);
  });

  it("keeps a non-embedded standard font not embedded", async () => {
    const o = await edit(join(REAL, "transmittal-letter.pdf"), "We have prepared", (t, s) => [
      { text: t[0]!.replace("filed electronically", "filed electronically today"), style: s[0]! },
    ]);
    expect(o.changedOutside).toBe(0);
    expect(
      findBox(o, o.box.paragraphs[0]!.text.replace("electronically", "electronically today")),
    ).toBeDefined();
    expect(fontsOf(o.bytes).find((f) => f.base === "/Times-Roman")).toMatchObject({ file: false });
  });

  it("refuses a letter the font lacks and leaves the page exactly as it was", async () => {
    const file = join(REAL, "form-9999.pdf");
    await expect(
      edit(file, "Taxable interest", (_t, s) => [{ text: "Taxable interest ≥ $10", style: s[0]! }]),
    ).rejects.toThrow(EditRefused);
    // Refused before any change: the same document still renders identically.
    const doc = RawDoc.open(m, read(file));
    try {
      const before = renderPage(m, doc);
      doc.withPage(0, (page) => {
        const g = groupPage(m, page);
        const box = g.boxes.find((b) => b.paragraphs[0]?.text === "Taxable interest")!;
        const s = detectStyle(m, box, g.rules)[0]!;
        expect(() =>
          retypeset(
            m,
            doc.ptr,
            page,
            { kind: "box", box, chars: g.chars, rules: g.rules, others: g.boxes },
            [{ text: "Ł", style: s }],
            { subset },
          ),
        ).toThrow(/has no Ł/);
      });
      const again = RawDoc.open(m, doc.save());
      try {
        expect(changedOutside(before, renderPage(m, again), { l: 0, r: 0, b: 0, t: 0 })).toBe(0);
      } finally {
        again.close();
      }
    } finally {
      doc.close();
    }
  });

  it("grows a one-line label to the right and reports the leaders it runs into", async () => {
    const o = await edit(join(REAL, "form-9999.pdf"), "Taxable interest", (_t, s) => [
      { text: "Taxable interest and tax-exempt interest", style: s[0]! },
    ]);
    expect(o.result.lines).toHaveLength(1);
    expect(o.result.overflow.some((x) => x.kind === "text" && x.text?.startsWith(". ."))).toBe(
      true,
    );
    expect(o.changedOutside).toBe(0);
  });

  it("right-aligns a lone amount so it grows to the left", async () => {
    const o = await edit(join(REAL, "form-9999.pdf"), "1,234.", (_t, s) => {
      expect(s[0]!.align).toBe("right");
      return [{ text: "11,234.", style: s[0]! }];
    });
    expect(o.result.bounds.r).toBeCloseTo(o.box.r, 0);
    expect(o.result.bounds.l).toBeLessThan(o.box.l);
  });

  it("keeps the amounts when a Courier statement row sharing their text objects is edited", async () => {
    const o = await edit(join(REAL, "statement-courier.pdf"), "FIRST SAMPLE BANK", (t, s) =>
      t.map((text, i) => ({
        text: text.replace("SECOND SAMPLE", "SECOND SAMPLE FEDERAL"),
        style: s[i]!,
      })),
    );
    expect(o.changedOutside).toBe(0);
    expect(norm(o.pdfjs)).toContain(norm("812."));
    expect(norm(o.pdfjs)).toContain(norm("SECOND SAMPLE FEDERAL CREDIT UNION"));
  });
});

describe("retypeset in another font", () => {
  it("embeds a file font as a tagged subset (Type0, ToUnicode)", async () => {
    const o = await edit(join(EDIT, "memo.pdf"), "We selected sales invoices", (t, s) => [
      {
        text: t[0]! + " (Journal ref. 2025-Q1-07)",
        style: { ...s[0]!, font: fileFont(face("Liberation Sans")) },
      },
    ]);
    expect(o.changedOutside).toBe(0);
    expect(findBox(o, o.box.paragraphs[0]!.text + " (Journal ref. 2025-Q1-07)")).toBeDefined();
    const added = fontsOf(o.bytes).filter((f) => /^\/[A-Z]{6}\+LiberationSans$/.test(f.base));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ subtype: "/Type0", toUnicode: true, file: true });
    expect(o.result.fonts[0]).toMatchObject({ kind: "file", embedded: "subset" });
  });

  it("switches a standard 14 font to its metric twin with the same line breaks", async () => {
    const o = await edit(join(REAL, "k1-supplemental.pdf"), "Box 20, Code Z", (t, s) => {
      // The note's main style is regular even though its head is bold.
      expect(s[0]!.bold).toBe(false);
      return [{ text: t[0]!, style: { ...s[0]!, font: fileFont(face("Liberation Sans")) } }];
    });
    expect(o.result.lines).toHaveLength(o.box.lines.length);
  });

  it("refuses a font whose license forbids embedding", async () => {
    const restricted = faces.find((f) => f.path === RESTRICTED)!;
    await expect(
      edit(join(EDIT, "memo.pdf"), "We selected sales invoices", (t, s) => [
        { text: t[0]!, style: { ...s[0]!, font: fileFont(restricted) } },
      ]),
    ).rejects.toThrow(/does not allow embedding/);
  });

  it("refuses letters a file font lacks, naming them", async () => {
    const err = await edit(join(EDIT, "memo.pdf"), "We selected sales invoices", (t, s) => [
      { text: t[0]! + " 中", style: { ...s[0]!, font: fileFont(face("Noto Sans")) } },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EditRefused);
    expect((err as EditRefused).missing).toEqual(["中"]);
  });

  it("uses the real bold face, and fakes bold when there is none", async () => {
    const real = await edit(join(EDIT, "memo.pdf"), "We selected sales invoices", (t, s) => [
      {
        text: t[0]!,
        style: { ...s[0]!, bold: true, font: fileFont(face("Liberation Sans", true)) },
      },
    ]);
    expect(real.result.fakeBold).toBe(false);
    const fake = await edit(join(EDIT, "memo.pdf"), "We selected sales invoices", (t, s) => [
      {
        text: t[0]!,
        style: { ...s[0]!, bold: true, italic: true, font: fileFont(face("Noto Sans")) },
      },
    ]);
    expect(fake.result).toMatchObject({ fakeBold: true, fakeItalic: true });
    expect(fake.changedOutside).toBe(0);
  });
});

describe("layout and style", () => {
  it("centres, right-aligns, sets line spacing and colour", async () => {
    for (const align of ["center", "right"] as const) {
      const o = await edit(join(EDIT, "two-column.pdf"), "Estimated tax payments", (t, s) => [
        {
          text: t[0]!,
          style: {
            ...s[0]!,
            align,
            leading: s[0]!.leading * 1.5,
            color: { r: 200, g: 0, b: 0, a: 255 },
          },
        },
      ]);
      const [first, second] = o.result.lines;
      expect(first!.b - second!.b).toBeCloseTo(o.box.leading! * 1.5, 1);
      if (align === "right") expect(first!.r).toBeCloseTo(o.box.r, 0);
      else expect((first!.l + first!.r) / 2).toBeCloseTo((o.box.l + o.box.r) / 2, 0);
    }
  });

  it("draws an underline that the next edit finds and replaces", async () => {
    const target = "• Manager review";
    const isTarget = (t: string) => t.startsWith(target);
    // Every paragraph of the box is written back; only the target is underlined.
    const o = await edit(join(EDIT, "memo.pdf"), target, (t, s) =>
      t.map((text, i) => ({ text, style: { ...s[i]!, underline: isTarget(text) } })),
    );
    const underlined = (bytes: Uint8Array) => {
      const doc = RawDoc.open(m, bytes);
      try {
        return doc.withPage(0, (page) => {
          const g = groupPage(m, page);
          const box = g.boxes.find((b) => b.paragraphs.some((p) => isTarget(p.text)))!;
          const styles = detectStyle(m, box, g.rules);
          return box.paragraphs.map((p, i) => [p.text, styles[i]!.underline] as const);
        });
      } finally {
        doc.close();
      }
    };
    const after = underlined(o.bytes);
    expect(after.filter(([, u]) => u).map(([t]) => t)).toEqual([
      after.find(([t]) => isTarget(t))![0],
    ]);

    // Editing it again without underline removes the line.
    const doc = RawDoc.open(m, o.bytes);
    try {
      doc.withPage(0, (page) => {
        const g = groupPage(m, page);
        const box = g.boxes.find((b) => b.paragraphs.some((p) => isTarget(p.text)))!;
        const styles = detectStyle(m, box, g.rules);
        retypeset(
          m,
          doc.ptr,
          page,
          { kind: "box", box, chars: g.chars, rules: g.rules, others: g.boxes },
          box.paragraphs.map((p, i) => ({
            text: p.text,
            style: { ...styles[i]!, underline: false },
          })),
          { subset },
        );
      });
      expect(underlined(doc.save()).some(([, u]) => u)).toBe(false);
    } finally {
      doc.close();
    }
  });
});

describe("add text", () => {
  it("adds a new wrapped box that groups as one paragraph", async () => {
    const doc = RawDoc.open(m, read(join(EDIT, "two-column.pdf")));
    try {
      const text = "Reviewed by the engagement senior on the date shown in the workpaper index.";
      doc.withPage(0, (page) => {
        const g = groupPage(m, page);
        const style: ParagraphStyle = {
          font: fileFont(face("Liberation Sans")),
          size: 10,
          color: { r: 0, g: 0, b: 160, a: 255 },
          bold: false,
          italic: false,
          underline: false,
          align: "left",
          leading: 12,
        };
        const r = retypeset(
          m,
          doc.ptr,
          page,
          { kind: "new", x: 72, y: 120, width: 200, others: g.boxes, rules: g.rules },
          [{ text, style }],
          { subset },
        );
        expect(r.lines.length).toBeGreaterThan(1);
        expect(r.overflow).toEqual([]);
      });
      const again = RawDoc.open(m, doc.save());
      try {
        const boxes = again.withPage(0, (page) => groupPage(m, page).boxes);
        expect(boxes.some((b) => b.paragraphs.length === 1 && b.paragraphs[0]!.text === text)).toBe(
          true,
        );
      } finally {
        again.close();
      }
    } finally {
      doc.close();
    }
  });
});
