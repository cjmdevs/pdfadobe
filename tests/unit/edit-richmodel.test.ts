// B3 stage 2 step 3: the rich-text editor's model (pure).
import { describe, expect, it } from "vitest";
import {
  applyChar,
  applyCharAll,
  applyPara,
  fmtAt,
  indent,
  insertText,
  splitAt,
  toEngine,
  type RichPara,
} from "../../src/ui/edit/richModel";

const para = (text: string): RichPara => ({
  text,
  base: { size: 11, bold: false },
  runs: [],
  para: { align: "left", leading: 13 },
});

describe("rich model", () => {
  it("formats part of a paragraph and reads the format back", () => {
    const doc = applyChar([para("Hello world")], { p: 0, o: 6 }, { p: 0, o: 11 }, { bold: true });
    expect(doc[0]!.runs).toEqual([{ start: 6, end: 11, fmt: { bold: true } }]);
    expect(fmtAt(doc, { p: 0, o: 8 }).bold).toBe(true);
    expect(fmtAt(doc, { p: 0, o: 3 }).bold).toBe(false);
    // Setting it back to the paragraph's own format leaves no run.
    const off = applyChar(doc, { p: 0, o: 0 }, { p: 0, o: 11 }, { bold: false });
    expect(off[0]!.runs).toEqual([]);
  });

  it("formats across paragraphs, either way round", () => {
    const doc = applyChar(
      [para("one two"), para("three four")],
      { p: 1, o: 5 },
      { p: 0, o: 4 },
      { size: 14 },
    );
    expect(doc[0]!.runs).toEqual([{ start: 4, end: 7, fmt: { size: 14 } }]);
    expect(doc[1]!.runs).toEqual([{ start: 0, end: 5, fmt: { size: 14 } }]);
  });

  it("a change for the whole box overrides the runs", () => {
    const doc = applyChar(
      [para("Hello world")],
      { p: 0, o: 0 },
      { p: 0, o: 5 },
      { size: 20, bold: true },
    );
    const all = applyCharAll(doc, { size: 9 });
    expect(all[0]!.base.size).toBe(9);
    expect(all[0]!.runs).toEqual([{ start: 0, end: 5, fmt: { bold: true } }]);
  });

  it("splits at Enter keeping formats, and pastes lines as paragraphs", () => {
    const doc = applyChar([para("Hello world")], { p: 0, o: 6 }, { p: 0, o: 11 }, { bold: true });
    const two = splitAt(doc, { p: 0, o: 8 });
    expect(two.map((p) => p.text)).toEqual(["Hello wo", "rld"]);
    expect(two[1]!.runs).toEqual([{ start: 0, end: 3, fmt: { bold: true } }]);
    const { doc: pasted, at } = insertText([para("ab")], { p: 0, o: 1 }, "X\nY");
    expect(pasted.map((p) => p.text)).toEqual(["aX", "Yb"]);
    expect(at).toEqual({ p: 1, o: 1 });
  });

  it("indents by quarter inches and never past the margin; lists per paragraph", () => {
    let doc = [para("a"), para("b")];
    doc = indent(doc, 0, 1, 1);
    expect(doc.map((p) => p.para.indent)).toEqual([
      { first: 18, left: 18 },
      { first: 18, left: 18 },
    ]);
    doc = indent(indent(doc, 0, 0, -1), 0, 0, -1);
    expect(doc[0]!.para.indent).toEqual({ first: 0, left: 0 });
    doc = applyPara(doc, 1, 1, { list: { kind: "bullet", glyph: "•" } });
    expect(toEngine(doc)[1]!.style).toMatchObject({ list: { kind: "bullet" }, size: 11 });
  });
});
