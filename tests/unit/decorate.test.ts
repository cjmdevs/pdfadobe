// Phase 7: headers/footers, Bates numbers, watermarks, backgrounds. They land where the
// page is seen (also on a /Rotate 90 page), adding again replaces, Remove restores the
// page exactly, and the page's own content stays drawn directly on the page.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../corpus/generate.mjs";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { renderGray } from "../../src/engine/ocr/image";
import {
  addBackground,
  addHeaderFooter,
  addWatermark,
  batesNumber,
  fillTokens,
  formatDate,
  removeDecorations,
  type HeaderFooterSpec,
} from "../../src/engine/decorate";

const require = createRequire(import.meta.url);
const qpdf = nodeQpdf();
let m: PdfiumModule;
const corpus = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));
const VALUES = { fileName: "workpaper.pdf", date: new Date(2026, 9, 31) };

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const spec = (over: Partial<HeaderFooterSpec> = {}): HeaderFooterSpec => ({
  header: ["{file}", "", "{date}"],
  footer: ["", "", "Page {page} of {pages}"],
  style: { font: "Helvetica", size: 10, color: "#000000" },
  margins: { top: 36, bottom: 36, left: 36, right: 36 },
  startNumber: 1,
  dateFormat: "M/D/YYYY",
  ...over,
});

/** Page text, and the display-space centre (y down) of `find` on that page. */
function find(bytes: Uint8Array, index: number, word: string) {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(index, (page) => {
      const w = m.FPDF_GetPageWidthF(page);
      const h = m.FPDF_GetPageHeightF(page);
      const tp = m.FPDFText_LoadPage(page);
      const n = m.FPDFText_CountChars(tp);
      let text = "";
      for (let i = 0; i < n; i++) text += String.fromCodePoint(m.FPDFText_GetUnicode(tp, i) || 32);
      const at = text.indexOf(word);
      let centre: { x: number; y: number } | null = null;
      if (at >= 0) {
        const mem = m.pdfium.wasmExports.malloc(48);
        const d = (o: number) => m.pdfium.getValue(mem + o, "double");
        m.FPDFText_GetCharBox(tp, at, mem, mem + 8, mem + 16, mem + 24);
        m.FPDF_PageToDevice(
          page,
          0,
          0,
          Math.round(w),
          Math.round(h),
          0,
          d(0),
          d(24),
          mem + 32,
          mem + 36,
        );
        centre = { x: m.pdfium.getValue(mem + 32, "i32"), y: m.pdfium.getValue(mem + 36, "i32") };
        m.pdfium.wasmExports.free(mem);
      }
      m.FPDFText_ClosePage(tp);
      return { text, centre, w, h };
    });
  } finally {
    doc.close();
  }
}

function render(bytes: Uint8Array, index = 0) {
  const doc = RawDoc.open(m, bytes);
  try {
    return renderGray(m, doc, index, 72);
  } finally {
    doc.close();
  }
}

const same = (a: Uint8Array, b: Uint8Array, page = 0) => {
  const ra = render(a, page);
  const rb = render(b, page);
  return ra.data.every((v, i) => v === rb.data[i]);
};

describe("tokens", () => {
  it("fills page numbers, dates, file name and Bates numbers", () => {
    const d = new Date(2026, 0, 5);
    expect(formatDate(d, "M/D/YYYY")).toBe("1/5/2026");
    expect(formatDate(d, "MM/DD/YYYY")).toBe("01/05/2026");
    expect(formatDate(d, "YYYY-MM-DD")).toBe("2026-01-05");
    expect(formatDate(d, "MMMM D, YYYY")).toBe("January 5, 2026");
    expect(batesNumber({ prefix: "ABC", start: 1, digits: 6, suffix: "-X" }, 42)).toBe(
      "ABC000042-X",
    );
    expect(
      fillTokens("Page {page} of {pages} {other}", {
        page: 3,
        pages: 12,
        date: "",
        file: "",
        bates: "",
      }),
    ).toBe("Page 3 of 12 {other}");
  });
});

describe("Header & Footer", { timeout: 60_000 }, () => {
  it("puts text where each page is seen, including a /Rotate 90 page", async () => {
    const src = corpus("navigation.pdf");
    const out = await addHeaderFooter(m, qpdf, src, spec(), VALUES);
    for (const index of [0, 4, 5]) {
      const r = find(out, index, "Page ");
      expect(r.text).toContain(`Page ${index + 1} of 8`);
      // Footer, right-aligned: near the bottom-right corner of the displayed page.
      expect(r.centre!.y).toBeGreaterThan(r.h - 50);
      expect(r.centre!.x).toBeGreaterThan(r.w - 150);
      const head = find(out, index, "workpaper.pdf");
      expect(head.centre!.y).toBeLessThan(50);
      expect(head.centre!.x).toBeLessThan(60);
      expect(head.text).toContain("10/31/2026");
    }
  });

  it("adding again replaces; Remove restores the page exactly", async () => {
    const src = corpus("text-1p.pdf");
    const once = await addHeaderFooter(m, qpdf, src, spec(), VALUES);
    const twice = await addHeaderFooter(m, qpdf, once, spec({ startNumber: 7 }), VALUES);
    const t = find(twice, 0, "Page").text;
    expect(t).toContain("Page 7 of 7");
    expect(t).not.toContain("Page 1 of 1");
    const removed = await removeDecorations(qpdf, twice, ["header"]);
    expect(removed.pages).toEqual([0]);
    expect(find(removed.bytes, 0, "Page").text).toBe(find(src, 0, "Page").text);
    expect(same(src, removed.bytes)).toBe(true);
  });

  it("only on the chosen pages, numbered from the start number", async () => {
    const out = await addHeaderFooter(
      m,
      qpdf,
      corpus("navigation.pdf"),
      spec({ pages: [2, 3] }),
      VALUES,
    );
    expect(find(out, 1, "Page ").text).not.toContain("of 2");
    expect(find(out, 2, "Page ").text).toContain("Page 1 of 2");
    expect(find(out, 3, "Page ").text).toContain("Page 2 of 2");
  });
});

describe("Bates numbering", { timeout: 60_000 }, () => {
  it("numbers across files and is removed separately from headers", async () => {
    const bates = { prefix: "MGR", start: 1, digits: 6, suffix: "" };
    const s = spec({ header: ["", "", ""], footer: ["", "", "{bates}"] });
    const a = await addHeaderFooter(m, qpdf, corpus("navigation.pdf"), s, VALUES, bates);
    const b = await addHeaderFooter(m, qpdf, corpus("text-1p.pdf"), s, VALUES, {
      ...bates,
      start: 9,
    });
    expect(find(a, 0, "MGR").text).toContain("MGR000001");
    expect(find(a, 7, "MGR").text).toContain("MGR000008");
    expect(find(b, 0, "MGR").text).toContain("MGR000009");
    const both = await addHeaderFooter(m, qpdf, a, spec(), VALUES);
    const noBates = await removeDecorations(qpdf, both, ["bates"]);
    expect(find(noBates.bytes, 0, "Page").text).toContain("Page 1 of 8");
    expect(find(noBates.bytes, 0, "MGR").text).not.toContain("MGR");
  });
});

describe("Watermark and Background", { timeout: 60_000 }, () => {
  /** A page covered by a white box, with a black square in the middle. */
  async function boxed(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 256, y: 346, width: 100, height: 100, color: rgb(0, 0, 0) });
    return doc.save();
  }

  it("a watermark behind the content is hidden by it; in front it shows", async () => {
    const src = await boxed();
    const text = {
      text: "DRAFT",
      style: { font: "Helvetica Bold" as const, size: 96, color: "#ff0000" },
    };
    const position = { h: "center" as const, v: "center" as const, dx: 0, dy: 0 };
    const behind = await addWatermark(m, qpdf, src, {
      source: text,
      opacity: 0.5,
      rotation: 45,
      behind: true,
      position,
    });
    const front = await addWatermark(m, qpdf, src, {
      source: text,
      opacity: 0.5,
      rotation: 45,
      behind: false,
      position,
    });
    expect(same(src, behind)).toBe(true);
    expect(same(src, front)).toBe(false);
    expect(find(front, 0, "DRAFT").text).toContain("DRAFT");
    expect(same(src, (await removeDecorations(qpdf, front, ["watermark"])).bytes)).toBe(true);
  });

  it("a background colour fills behind the page", async () => {
    const src = corpus("text-1p.pdf");
    const out = await addBackground(m, qpdf, src, { source: { color: "#808080" }, opacity: 1 });
    const r = render(out);
    expect(r.data[5 * r.width + 5]).toBeGreaterThan(110);
    expect(r.data[5 * r.width + 5]).toBeLessThan(145);
    expect(find(out, 0, "Engagement").text).toBe(find(src, 0, "Engagement").text);
  });

  it("keeps the page's own content on the page, and the file valid", async () => {
    const src = corpus("text-1p.pdf");
    const out = await addHeaderFooter(m, qpdf, src, spec(), VALUES);
    const types = (b: Uint8Array) => {
      const doc = RawDoc.open(m, b);
      try {
        return doc.withPage(0, (p) =>
          Array.from({ length: m.FPDFPage_CountObjects(p) }, (_, i) =>
            m.FPDFPageObj_GetType(m.FPDFPage_GetObject(p, i)),
          ),
        );
      } finally {
        doc.close();
      }
    };
    expect(types(out)).toEqual([...types(src), 5]);
    const check = await qpdf.run({
      inputs: { "in0.pdf": out },
      args: ["--check", "in0.pdf"],
      outputs: [],
    });
    expect(check.warnings).toBe(false);
  });
});
