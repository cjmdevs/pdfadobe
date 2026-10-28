// Phase 5 stage 3: Sanitize Document, and the scrub every Apply does.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  setTextRenderingMode,
} from "pdf-lib";
import { decompressedBytes, pdfjsView } from "../helpers/leak-scan";
import { nodeQpdf } from "../helpers/qpdf-node";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { PdfObjects, rewrite } from "../../src/engine/redact/objects";
import {
  ALL_SANITIZE,
  removeHiddenText,
  sanitizeObjects,
  scrubAfterRedaction,
} from "../../src/engine/redact/sanitize";

const require = createRequire(import.meta.url);
const qpdf = nodeQpdf();
let m: PdfiumModule;
let dirty: Uint8Array;

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>XMP-SECRET-000-12-3456</dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

async function dirtyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setSubject("INFO-SECRET 000-12-3456");
  doc.setTitle("Kept title");
  const ctx = doc.context;
  doc.catalog.set(
    PDFName.of("Metadata"),
    ctx.register(ctx.stream(XMP, { Type: "Metadata", Subtype: "XML" })),
  );
  await doc.attach(new TextEncoder().encode("ATTACHED-SECRET"), "notes.txt", {
    mimeType: "text/plain",
  });
  doc.addJavaScript("doc-js", "app.alert('DOC-SCRIPT');");
  const js = (code: string) => ctx.obj({ S: "JavaScript", JS: PDFString.of(code) });
  doc.catalog.set(PDFName.of("OpenAction"), js("app.alert('OPEN-SCRIPT');"));
  doc.catalog.set(
    PDFName.of("PieceInfo"),
    ctx.obj({ Index: ctx.obj({ Private: PDFString.of("INDEX-SECRET") }) }),
  );

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of("AA"), ctx.obj({ O: js("app.alert('PAGE-SCRIPT');") }));
  page.drawText("Visible line stays", { x: 72, y: 700, size: 12, font });
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText("INVISIBLE-OCR-LAYER", { x: 72, y: 650, size: 12, font });
  page.pushOperators(popGraphicsState());
  page.drawText("OFF-PAGE-TEXT", { x: 700, y: 650, size: 12, font });
  return doc.save();
}

function text(bytes: Uint8Array): string {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(0, (page) => {
      const tp = m.FPDFText_LoadPage(page);
      let s = "";
      for (let i = 0; i < m.FPDFText_CountChars(tp); i++)
        s += String.fromCodePoint(m.FPDFText_GetUnicode(tp, i));
      m.FPDFText_ClosePage(tp);
      return s;
    });
  } finally {
    doc.close();
  }
}

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
  dirty = await dirtyPdf();
});

describe("Sanitize Document", () => {
  it("the fixture has everything to remove", async () => {
    // pdf-lib writes /Info and document scripts as UTF-16 hex: checked by structure.
    expect(String((await pdfjsView(dirty)).info.Subject)).toContain("INFO-SECRET");
    const raw = decompressedBytes(dirty).toString("latin1");
    for (const s of [
      "XMP-SECRET",
      "ATTACHED-SECRET",
      "OPEN-SCRIPT",
      "PAGE-SCRIPT",
      "INDEX-SECRET",
    ]) {
      expect(raw).toContain(s);
    }
    expect(raw).toMatch(/\/JavaScript (\d+ 0 R|<<)/); // the name tree entry
    expect(text(dirty)).toContain("INVISIBLE-OCR-LAYER");
    expect(text(dirty)).toContain("OFF-PAGE-TEXT");
  });

  it("removes metadata, XMP, attachments, scripts, private data and hidden text", async () => {
    const hidden = removeHiddenText(m, dirty);
    expect(hidden.removed).toBe(2);
    const objs = await PdfObjects.read(qpdf, hidden.bytes);
    const report = sanitizeObjects(objs, ALL_SANITIZE);
    const out = await rewrite(qpdf, hidden.bytes, objs);
    const raw = decompressedBytes(out).toString("latin1");
    for (const s of [
      "INFO-SECRET",
      "XMP-SECRET",
      "ATTACHED-SECRET",
      "DOC-SCRIPT",
      "OPEN-SCRIPT",
      "PAGE-SCRIPT",
      "INDEX-SECRET",
      "Kept title",
    ]) {
      expect(raw).not.toContain(s);
    }
    expect(raw).not.toMatch(/\/JavaScript|\/EmbeddedFiles|\/PieceInfo|\/OpenAction/);
    expect(report.attachmentsRemoved).toBeGreaterThan(0);
    expect(report.actionsRemoved).toBe(3);
    const t = text(out);
    expect(t).toContain("Visible line stays");
    expect(t).not.toMatch(/INVISIBLE|OFF-PAGE/);
    const view = await pdfjsView(out);
    expect(view.xmp).toBe("");
    expect(view.info.Subject).toBeUndefined();
    expect(view.info.Title).toBeUndefined();
    // A single revision: one xref section, one %%EOF.
    expect(Buffer.from(out).toString("latin1").match(/%%EOF/g)).toHaveLength(1);
  });
});

describe("the scrub every Apply does", () => {
  it("drops XMP and the /Info entries holding a redacted string, keeps the rest", async () => {
    const objs = await PdfObjects.read(qpdf, dirty);
    scrubAfterRedaction(objs, ["000-12-3456"]);
    const out = await rewrite(qpdf, dirty, objs);
    const view = await pdfjsView(out);
    expect(view.info.Subject).toBeUndefined();
    expect(view.info.Title).toBe("Kept title");
    expect(view.xmp).toBe("");
  });
});
