import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENCRYPTED_PASSWORDS, FAKE_SSN, NAV_LAYOUT, OUT_DIR } from "../corpus/generate.mjs";
import { nodeEngine, readPdf } from "../helpers/pdfium-node";
import type { PdfAttachmentObject, PdfBookmarkObject } from "@embedpdf/models";
import type { Engine } from "../../src/engine/pdfium";
import { pageText } from "../../src/engine/text";

const irs = (f: string) => join(OUT_DIR, "..", "irs", f);
let engine: Engine;

beforeAll(async () => {
  engine = await nodeEngine();
});
afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

async function open(path: string, password?: string) {
  const id = `${path}-${Math.random()}`;
  return engine
    .openDocumentBuffer({ id, content: readPdf(path) }, password ? { password } : {})
    .toPromise();
}

describe("synthetic corpus", () => {
  it("1-page text doc has a text layer", async () => {
    const doc = await open(join(OUT_DIR, "text-1p.pdf"));
    expect(doc.pageCount).toBe(1);
    expect(await engine.extractText(doc, [0]).toPromise()).toContain("Sample Engagement Memo");
  });

  it("long doc has 200 pages", async () => {
    const doc = await open(join(OUT_DIR, "long-200p.pdf"));
    expect(doc.pageCount).toBe(200);
    expect(await engine.extractText(doc, [199]).toPromise()).toContain("Page 200 of 200");
  });

  it("500-page performance doc has 500 pages", async () => {
    const doc = await open(join(OUT_DIR, "long-500p.pdf"));
    expect(doc.pageCount).toBe(500);
    expect(await engine.extractText(doc, [499]).toPromise()).toContain("Page 500 of 500");
  });

  it("navigation fixture has a nested outline, attachments, and mixed pages", async () => {
    const doc = await open(join(OUT_DIR, "navigation.pdf"));
    expect(doc.pageCount).toBe(NAV_LAYOUT.pages.length);
    const { bookmarks } = await engine.getBookmarks(doc).toPromise();
    expect(bookmarks.map((b: PdfBookmarkObject) => b.title)).toEqual(
      NAV_LAYOUT.outline.map((o) => o.title),
    );
    expect(bookmarks[1]?.children?.[1]?.children?.[0]?.title).toBe("Landscape page");
    const atts = await engine.getAttachments(doc).toPromise();
    expect(atts.map((a: PdfAttachmentObject) => a.name).sort()).toEqual([
      "notes.txt",
      "trial-balance.csv",
    ]);
    expect(doc.pages[4]?.size).toEqual({ width: 792, height: 612 });
    expect(doc.pages[5]?.rotation).toBe(1); // Rotation.Degree90
  });

  it("corrupt.pdf cannot be opened", async () => {
    await expect(open(join(OUT_DIR, "corrupt.pdf"))).rejects.toBeDefined();
  });

  it("AcroForm has fillable widgets", async () => {
    const doc = await open(join(OUT_DIR, "acroform.pdf"));
    const widgets = await engine.getPageAnnoWidgets(doc, doc.pages[0]!).toPromise();
    expect(widgets.length).toBeGreaterThanOrEqual(6);
  });

  it("scanned doc is image-only (no text layer)", async () => {
    const doc = await open(join(OUT_DIR, "scanned-image-only.pdf"));
    expect(await pageText(engine, doc, 0)).toBe("");
  });

  it("pageText guards EmbedPDF's zero-glyph extractText bug", async () => {
    // Raw extractText returns uninitialized memory on a page with no text (2.15.1).
    // If this starts passing as "", the upstream bug is fixed and the guard can go.
    const doc = await open(join(OUT_DIR, "scanned-image-only.pdf"));
    expect(await engine.extractText(doc, [0]).toPromise()).not.toBe("");
  });

  it("encrypted doc needs the password", async () => {
    await expect(open(join(OUT_DIR, "encrypted.pdf"))).rejects.toThrow();
    const doc = await open(join(OUT_DIR, "encrypted.pdf"), ENCRYPTED_PASSWORDS.user);
    expect(doc.isEncrypted).toBe(true);
    expect(await engine.extractText(doc, [0]).toPromise()).toContain("Sample Engagement Memo");
  });

  it("SSN fixture contains the fake SSN on both pages", async () => {
    const doc = await open(join(OUT_DIR, "ssn-redaction.pdf"));
    expect(doc.pageCount).toBe(2);
    expect(await engine.extractText(doc, [0]).toPromise()).toContain(FAKE_SSN);
    expect(await engine.extractText(doc, [1]).toPromise()).toContain(FAKE_SSN);
  });

  it.each(["f1040.pdf", "fw9.pdf", "f8879.pdf"])("IRS form %s is present and opens", async (f) => {
    expect(existsSync(irs(f))).toBe(true);
    const doc = await open(irs(f));
    expect(doc.pageCount).toBeGreaterThan(0);
  });
});
