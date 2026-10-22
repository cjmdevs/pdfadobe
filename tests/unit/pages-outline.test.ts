// Pure bookmark-tree and page-range logic (no PDF files).
import { describe, expect, it } from "vitest";
import {
  bookmark,
  bookmarkRange,
  checkJob,
  moveNode,
  moveOrder,
  pagesArgs,
  parseRanges,
  partsByBookmarks,
  partsByCount,
  remapOutline,
  stalePatch,
  targetPage,
  toQpdfRange,
  type Outline,
} from "../../src/engine/pages";

const titles = (o: Outline): string[] =>
  o.flatMap((b) => [
    `${b.title}@${targetPage(b)}`,
    ...titles(b.children ?? []).map((t) => `.${t}`),
  ]);

// Ch1 p0 (Sec1.1 p1, Sec1.2 p3), Ch2 p5 (Sec2.1 p6), Appendix p9 — 12 pages.
const tree: Outline = [
  bookmark("Ch1", 0, [bookmark("Sec1.1", 1), bookmark("Sec1.2", 3)]),
  bookmark("Ch2", 5, [bookmark("Sec2.1", 6)]),
  bookmark("Appendix", 9),
];

describe("page ranges", () => {
  it("parses lists, open ends, z, and reverse ranges", () => {
    expect(parseRanges("1-3, 5, 8-", 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(parseRanges("z", 4)).toEqual([3]);
    expect(parseRanges("3-1", 4)).toEqual([2, 1, 0]);
    expect(parseRanges("", 3)).toEqual([0, 1, 2]);
    expect(() => parseRanges("0", 3)).toThrow(/outside/);
    expect(() => parseRanges("2-9", 3)).toThrow(/outside/);
    expect(() => parseRanges("a-b", 3)).toThrow(/not a page range/);
  });
  it("formats compact qpdf specs", () => {
    expect(toQpdfRange([0, 1, 2, 4, 6, 7])).toBe("1-3,5,7-8");
    expect(toQpdfRange([2, 0, 0])).toBe("3,1,1");
  });
  it("groups plan runs per file", () => {
    expect(
      pagesArgs([
        { file: 0, page: 0 },
        { file: 0, page: 1 },
        { file: 1, page: 4 },
        { file: 0, page: 2 },
      ]),
    ).toEqual([".", "1-2", "in1.pdf", "5", ".", "3"]);
  });
  it("moves pages before a target", () => {
    expect(moveOrder(5, [3, 4], 1)).toEqual([0, 3, 4, 1, 2]);
    expect(moveOrder(5, [0], null)).toEqual([1, 2, 3, 4, 0]);
    expect(moveOrder(5, [1, 2], 2)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("bookmark ranges", () => {
  it("runs to the page before the next same-or-higher-level bookmark", () => {
    expect(bookmarkRange(tree, [0], 12)).toEqual({ start: 0, end: 4 });
    expect(bookmarkRange(tree, [0, 0], 12)).toEqual({ start: 1, end: 2 });
    expect(bookmarkRange(tree, [0, 1], 12)).toEqual({ start: 3, end: 4 });
    expect(bookmarkRange(tree, [1], 12)).toEqual({ start: 5, end: 8 });
    expect(bookmarkRange(tree, [2], 12)).toEqual({ start: 9, end: 11 });
  });
  it("splits by top-level bookmarks, earlier pages joining the first part", () => {
    const t: Outline = [bookmark("A", 2), bookmark("B", 4)];
    expect(partsByBookmarks(t, 6)).toEqual([
      { label: "A", pages: [0, 1, 2, 3] },
      { label: "B", pages: [4, 5] },
    ]);
    expect(partsByCount(5, 2).map((p) => p.pages)).toEqual([[0, 1], [2, 3], [4]]);
  });
});

describe("bookmark tree edits", () => {
  it("moves a node with its children, adjusting for the removal", () => {
    const r = moveNode(tree, [0], [], 3);
    expect(titles(r.outline)).toEqual([
      "Ch2@5",
      ".Sec2.1@6",
      "Appendix@9",
      "Ch1@0",
      ".Sec1.1@1",
      ".Sec1.2@3",
    ]);
    expect(r.path).toEqual([2]);
    const nested = moveNode(tree, [2], [1], 0);
    expect(titles(nested.outline)).toContain(".Appendix@9");
    expect(() => moveNode(tree, [0], [0, 1], 0)).toThrow(/into itself/);
  });
  it("remaps pages; drops leaves whose page is gone, keeps parents via children", () => {
    const gone = new Set([0, 1, 2]);
    const out = remapOutline(tree, (p) => (gone.has(p) ? null : p - 3));
    expect(titles(out)).toEqual(["Ch1@0", ".Sec1.2@0", "Ch2@2", ".Sec2.1@3", "Appendix@6"]);
  });
});

describe("qpdf job guard", () => {
  it("rejects paths, drive letters, parent dirs and @argfiles", () => {
    const ok = {
      inputs: { "in0.pdf": new Uint8Array() },
      args: ["in0.pdf", "--rotate=+90:1-2", "out.pdf"],
      outputs: ["out.pdf"],
    };
    expect(() => checkJob(ok)).not.toThrow();
    for (const bad of [
      "C:\\x.pdf",
      "../x.pdf",
      "@args",
      "/etc/passwd",
      "--update-from-json=C:x.json",
    ]) {
      expect(() => checkJob({ ...ok, args: [bad] })).toThrow();
    }
    expect(() => checkJob({ ...ok, outputs: ["..\\out.pdf"] })).toThrow();
    expect(() => checkJob({ ...ok, inputs: { "In0.PDF": new Uint8Array() } })).toThrow();
  });
  it("builds an XFA/Perms removal patch only when needed", () => {
    const json = (catalog: object, form?: object) => ({
      qpdf: [
        { maxobjectid: 9 },
        {
          trailer: { value: { "/Root": "1 0 R" } },
          "obj:1 0 R": { value: catalog },
          ...(form ? { "obj:2 0 R": { value: form } } : {}),
        },
      ] as [Record<string, unknown>, Record<string, { value?: unknown }>],
    });
    expect(stalePatch(json({ "/Type": "/Catalog" }))).toBeNull();
    const p = stalePatch(
      json({ "/AcroForm": "2 0 R", "/Perms": {} }, { "/Fields": [], "/XFA": "3 0 R" }),
    ) as {
      qpdf: [unknown, Record<string, { value: Record<string, unknown> }>];
    };
    expect(Object.keys(p.qpdf[1]).sort()).toEqual(["obj:1 0 R", "obj:2 0 R"]);
    expect(p.qpdf[1]["obj:2 0 R"]!.value).toEqual({ "/Fields": [] });
    expect(p.qpdf[1]["obj:1 0 R"]!.value).toEqual({ "/AcroForm": "2 0 R" });
  });
});
