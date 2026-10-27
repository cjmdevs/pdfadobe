// B3 Edit PDF: text objects shared between two boxes. Removing one box's text must
// leave every glyph of the other box exactly where it was.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { groupPage, removeBoxText, type TextBox } from "../../src/engine/edit";
import { changedOutside, renderPage } from "../helpers/edit-render";

const require = createRequire(import.meta.url);
const REAL = join(__dirname, "..", "corpus", "edit", "real-format");

let m: PdfiumModule;
beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const texts = (boxes: TextBox[]) => boxes.flatMap((b) => b.paragraphs.map((p) => p.text));

/** Removes the box holding a paragraph that starts with `target`, splitting first. */
function removeBox(bytes: Uint8Array, target: string, split = true) {
  const doc = RawDoc.open(m, bytes);
  try {
    const before = renderPage(m, doc);
    let box: TextBox | undefined;
    let created: number[] = [];
    doc.withPage(
      0,
      (page) => {
        const g = groupPage(m, page);
        box = g.boxes.find((b) => b.paragraphs.some((p) => p.text.startsWith(target)));
        if (!box) throw new Error(`no box for ${target}`);
        if (split) created = removeBoxText(m, doc.ptr, page, box, g.chars);
        else
          for (const o of box.objects) {
            m.FPDFPage_RemoveObject(page, o);
            m.FPDFPageObj_Destroy(o);
          }
      },
      true,
    );
    const out = doc.save();
    const after = RawDoc.open(m, out);
    try {
      const b = box!;
      const keep = { l: b.l - 0.5, r: b.r + 0.5, b: b.b - 0.5, t: b.t + 0.5 };
      return {
        created: created.length,
        changed: changedOutside(before, renderPage(m, after), keep),
        texts: after.withPage(0, (page) => texts(groupPage(m, page).boxes)),
      };
    } finally {
      after.close();
    }
  } finally {
    doc.close();
  }
}

/** One-line PDF whose single text object holds two "cells" far apart. */
async function sharedRow(show: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedStandardFont(StandardFonts.Courier);
  const tag = page.node.newFontDictionary("F1", font.ref).toString();
  const ops = `BT ${tag} 10 Tf 72 700 Td ${show} ET`;
  page.node.addContentStream(doc.context.register(doc.context.flateStream(ops)));
  return doc.save({ useObjectStreams: false });
}

const hex = (s: string) => `<${Buffer.from(s, "latin1").toString("hex")}>`;

describe("removeBoxText (shared text objects)", () => {
  it("keeps the amounts when a Courier statement row is removed", () => {
    const bytes = new Uint8Array(readFileSync(join(REAL, "statement-courier.pdf")));
    const r = removeBox(bytes, "SECOND SAMPLE CREDIT UNION");
    expect(r.created).toBe(2); // "812." and "422." each get their own object
    expect(r.changed).toBe(0);
    expect(r.texts).toContain("812.");
    expect(r.texts).toContain("422.");
    expect(r.texts).not.toContain("SECOND SAMPLE CREDIT UNION");
  });

  it("without the split the amounts would be lost (the case it guards)", () => {
    const bytes = new Uint8Array(readFileSync(join(REAL, "statement-courier.pdf")));
    const r = removeBox(bytes, "SECOND SAMPLE CREDIT UNION", false);
    expect(r.changed).toBeGreaterThan(0);
    expect(r.texts).not.toContain("422.");
  });

  it("creates nothing for a box whose objects are its own", () => {
    const bytes = new Uint8Array(readFileSync(join(REAL, "transmittal-letter.pdf")));
    const r = removeBox(bytes, "We have prepared");
    expect(r.created).toBe(0);
    expect(r.changed).toBe(0);
  });

  it("falls back to one object per glyph when Tc spacing can't be rewritten", async () => {
    // Tc 1.5 spreads every letter; a plain rewrite of "RIGHT" would land too tight.
    const bytes = await sharedRow(`1.5 Tc ${hex("LEFT              RIGHT")} Tj 0 Tc`);
    const r = removeBox(bytes, "LEFT");
    expect(r.created).toBe(5);
    expect(r.changed).toBe(0);
    expect(r.texts).toEqual(["RIGHT"]);
  });

  it("keeps TJ-kerned leftovers in place", async () => {
    const bytes = await sharedRow(`[${hex("LEFT")} -2400 ${hex("R")} 120 ${hex("IGHT")}] TJ`);
    const r = removeBox(bytes, "LEFT");
    expect(r.changed).toBe(0);
    expect(r.texts).toEqual(["RIGHT"]);
  });

  it("keeps the left part when the right box is removed", async () => {
    const bytes = await sharedRow(`${hex("LEFT              RIGHT")} Tj`);
    const r = removeBox(bytes, "RIGHT");
    expect(r.created).toBe(1);
    expect(r.changed).toBe(0);
    expect(r.texts).toEqual(["LEFT"]);
  });
});
