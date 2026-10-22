// Phase 2 gate scenario: merge three workpapers with forms, annotations and bookmarks,
// reorder, split, and check page counts, bookmark targets and field values with qpdf
// and pdf.js (independent of PDFium).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, WORKPAPERS } from "../corpus/generate.mjs";
import { inspectPdf, outlineLines, type PdfInspection } from "../helpers/pdf-inspect";
import { nodePagesCtx } from "../helpers/pages-ctx";
import {
  combine,
  movePages,
  partsByBookmarks,
  readOutline,
  splitParts,
  type PagesCtx,
} from "../../src/engine/pages";

let ctx: PagesCtx;
const read = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));
const fieldMap = (i: PdfInspection) => {
  // Radio groups appear once per widget; keep one value per name.
  const m = new Map<string, string | null>();
  for (const f of i.fields) m.set(f.name, f.value);
  return Object.fromEntries(m);
};

let merged: Uint8Array;
let reordered: Uint8Array;

beforeAll(async () => {
  ctx = await nodePagesCtx();
  merged = await combine(
    ctx,
    WORKPAPERS.map((w) => ({ name: w.file, bytes: read(w.file) })),
    { bookmarkPerFile: true },
  );
});

describe("merge three workpapers", () => {
  it("has every page, valid structure, and a bookmark per file", async () => {
    const i = await inspectPdf(merged);
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(9);
    expect(i.pageText.map((t) => /Workpaper (\w) - page (\d)/.exec(t)?.slice(1).join(""))).toEqual([
      "A1",
      "A2",
      "A3",
      "B1",
      "B2",
      "B3",
      "C1",
      "C2",
      "C3",
    ]);
    expect(outlineLines(i.outline)).toEqual([
      "workpaper-a@1",
      ".A Cover@1",
      "..A Detail@2",
      ".A Summary@3",
      "workpaper-b@4",
      ".B Cover@4",
      "..B Detail@5",
      ".B Summary@6",
      "workpaper-c@7",
      ".C Cover@7",
      "..C Detail@8",
      ".C Summary@9",
    ]);
  });

  it("renames clashing fields so each file keeps its own values", async () => {
    const i = await inspectPdf(merged);
    const f = fieldMap(i);
    const names = Object.keys(f);
    expect(new Set(names).size).toBe(9); // 3 fields x 3 files, no shared names
    // Values stay with their pages: page 1/4/7 carry client.name for A/B/C.
    const byPage = (p: number) => i.fields.find((x) => x.page === p && x.name.includes("client"))!;
    expect([1, 4, 7].map((p) => byPage(p).value)).toEqual([
      "Sample Client A",
      "Sample Client B",
      "Sample Client C",
    ]);
    // Checkbox: A and C checked, B not.
    const tie = (p: number) => i.fields.find((x) => x.page === p && x.name.includes("tie"))!.value;
    expect([2, 5, 8].map(tie).map((v) => v !== null && v !== "/Off")).toEqual([true, false, true]);
    // Radio groups keep distinct selections (draft / review / final = /0 /1 /2).
    const radio = (p: number) =>
      i.fields.find((x) => x.page === p && x.name.includes("status"))!.value;
    expect([3, 6, 9].map(radio)).toEqual(["/0", "/1", "/2"]);
  });

  it("keeps every annotation, as standard PDF annotations", async () => {
    const i = await inspectPdf(merged);
    const notes = i.annotations.filter((a) => a.subtype === "Text");
    expect(
      notes.map((n) => [n.page, n.strings.find((s) => s.startsWith("Reviewer note"))]),
    ).toEqual([
      [1, "Reviewer note A"],
      [4, "Reviewer note B"],
      [7, "Reviewer note C"],
    ]);
    expect(i.annotations.filter((a) => a.subtype === "Square").map((a) => a.page)).toEqual([
      2, 5, 8,
    ]);
    expect(i.annotations.filter((a) => a.subtype === "Widget")).toHaveLength(3 * 5);
  });
});

describe("reorder, then split", () => {
  beforeAll(async () => {
    // Move workpaper C (pages 7-9) to the front.
    reordered = await movePages(ctx, merged, [6, 7, 8], 0);
  });

  it("bookmarks and fields follow their pages", async () => {
    const i = await inspectPdf(reordered);
    expect(i.checkError).toBeNull();
    expect(i.pages).toBe(9);
    expect(i.pageText[0]).toContain("Workpaper C - page 1");
    expect(outlineLines(i.outline)).toEqual([
      "workpaper-a@4",
      ".A Cover@4",
      "..A Detail@5",
      ".A Summary@6",
      "workpaper-b@7",
      ".B Cover@7",
      "..B Detail@8",
      ".B Summary@9",
      "workpaper-c@1",
      ".C Cover@1",
      "..C Detail@2",
      ".C Summary@3",
    ]);
    const client = i.fields.filter((x) => x.name.includes("client")).map((x) => [x.page, x.value]);
    expect(client.sort()).toEqual([
      [1, "Sample Client C"],
      [4, "Sample Client A"],
      [7, "Sample Client B"],
    ]);
  });

  it("splits by top-level bookmarks into the three original workpapers", async () => {
    const outline = await readOutline(ctx.engine, reordered);
    const parts = partsByBookmarks(outline, 9);
    expect(parts.map((p) => [p.label, p.pages])).toEqual([
      ["workpaper-c", [0, 1, 2]],
      ["workpaper-a", [3, 4, 5]],
      ["workpaper-b", [6, 7, 8]],
    ]);
    const files = await splitParts(ctx, reordered, parts);
    for (const [k, f] of files.entries()) {
      const id = ["C", "A", "B"][k]!;
      const i = await inspectPdf(f.bytes);
      expect(i.checkError).toBeNull();
      expect(i.pages).toBe(3);
      expect(i.pageText[0]).toContain(`Workpaper ${id} - page 1`);
      // Only this part's bookmarks, renumbered from 1.
      expect(outlineLines(i.outline)).toEqual([
        `workpaper-${id.toLowerCase()}@1`,
        `.${id} Cover@1`,
        `..${id} Detail@2`,
        `.${id} Summary@3`,
      ]);
      // Only this part's fields, with its own values.
      expect(i.fields.find((x) => x.name.includes("client"))!.value).toBe(`Sample Client ${id}`);
      expect(new Set(i.fields.map((x) => x.page))).toEqual(new Set([1, 2, 3]));
      expect(i.annotations.filter((a) => a.subtype === "Text")).toHaveLength(1);
    }
  });
});
