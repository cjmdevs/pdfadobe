// B3 stage 2 step 5: links. Add a web link and a page link, change one, remove one,
// remove every web link (tickmark links stay), and refuse unsafe addresses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanUri,
  listLinks,
  removeLinks,
  removeWebLinks,
  setLink,
} from "../../src/engine/edit/links";
import { EditRefused } from "../../src/engine/edit";
import { nodeQpdf } from "../helpers/qpdf-node";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const qpdf = nodeQpdf();
const MEMO = new Uint8Array(readFileSync(join(__dirname, "..", "corpus", "edit", "memo.pdf")));
const rect = { l: 72, b: 600, r: 200, t: 620 };
const black: [number, number, number] = [0, 0, 0];

describe("links", () => {
  it("adds a web link and a page link that readers see", async () => {
    let bytes = await setLink(qpdf, MEMO, 0, {
      rect,
      target: { kind: "uri", uri: "example.com/help" },
      width: 0,
      color: black,
    });
    bytes = await setLink(qpdf, bytes, 0, {
      rect: { ...rect, b: 560, t: 580 },
      target: { kind: "page", page: 0 },
      width: 1,
      color: [0, 0, 1],
    });
    const links = await listLinks(qpdf, bytes, 0);
    expect(links.map((l) => l.target)).toEqual([
      { kind: "uri", uri: "https://example.com/help" },
      { kind: "page", page: 0 },
    ]);
    expect(links[1]).toMatchObject({ width: 1, color: [0, 0, 1] });
    // pdf.js (a second reader) sees both links.
    const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    const doc = await task.promise;
    const annots = (await (await doc.getPage(1)).getAnnotations()) as {
      subtype: string;
      url?: string;
      dest?: unknown;
    }[];
    const seen = annots.filter((a) => a.subtype === "Link");
    expect(seen.map((a) => a.url ?? "page")).toEqual(["https://example.com/help", "page"]);
    await task.destroy();
  });

  it("changes a link in place and removes one", async () => {
    let bytes = await setLink(qpdf, MEMO, 0, {
      rect,
      target: { kind: "uri", uri: "https://a.example" },
      width: 0,
      color: black,
    });
    const [link] = await listLinks(qpdf, bytes, 0);
    bytes = await setLink(
      qpdf,
      bytes,
      0,
      { rect, target: { kind: "uri", uri: "https://b.example" }, width: 2, color: black },
      link!.ref,
    );
    const now = await listLinks(qpdf, bytes, 0);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({
      ref: link!.ref,
      width: 2,
      target: { uri: "https://b.example" },
    });
    bytes = await removeLinks(qpdf, bytes, 0, [link!.ref]);
    expect(await listLinks(qpdf, bytes, 0)).toEqual([]);
  });

  it("removes every web link, keeping page links", async () => {
    let bytes = await setLink(qpdf, MEMO, 0, {
      rect,
      target: { kind: "uri", uri: "https://a.example" },
      width: 0,
      color: black,
    });
    bytes = await setLink(qpdf, bytes, 0, {
      rect: { ...rect, b: 560, t: 580 },
      target: { kind: "page", page: 0 },
      width: 0,
      color: black,
    });
    const r = await removeWebLinks(qpdf, bytes);
    expect(r.removed).toBe(1);
    expect((await listLinks(qpdf, r.bytes, 0)).map((l) => l.target.kind)).toEqual(["page"]);
  });

  it("only opens web and email addresses", () => {
    expect(cleanUri("mailto:a@b.example")).toBe("mailto:a@b.example");
    expect(cleanUri("a@b.example")).toBe("mailto:a@b.example");
    expect(cleanUri("HTTP://x.example")).toBe("HTTP://x.example");
    expect(() => cleanUri("javascript:alert(1)")).toThrow(EditRefused);
    expect(() => cleanUri("file:///C:/x")).toThrow(EditRefused);
    expect(() => cleanUri("  ")).toThrow(EditRefused);
  });
});
