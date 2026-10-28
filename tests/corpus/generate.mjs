#!/usr/bin/env node
// Generates the synthetic test corpus into tests/corpus/generated/.
// All data is fake. Deterministic content (dates fixed); safe to delete and rerun.
//
// Requires: qpdf on PATH (for encrypted.pdf).
// Usage: node tests/corpus/generate.mjs [--force]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
} from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = join(here, "generated");
const FIXED_DATE = new Date("2025-01-15T12:00:00Z");

/** The fake SSN used everywhere. 000-xx-xxxx is never issued by the SSA. */
export const FAKE_SSN = "000-12-3456";

export const ENCRYPTED_PASSWORDS = { user: "corpus-user", owner: "corpus-owner" };

const LOREM =
  "This is a synthetic workpaper generated for testing. It contains no client data. " +
  "Amounts and names are fictitious. Tickmarks, totals, and cross-references are illustrative.";

function stamp(doc, title) {
  doc.setTitle(title);
  doc.setAuthor("PDF Workbench test corpus");
  doc.setProducer("tests/corpus/generate.mjs");
  doc.setCreator("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
}

function wrap(text, font, size, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function textOnePage() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic one-page text document");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("Sample Engagement Memo", { x: 72, y: 720, size: 18, font: bold });
  let y = 690;
  for (let i = 0; i < 6; i++) {
    for (const l of wrap(LOREM, font, 11, 468)) {
      page.drawText(l, { x: 72, y, size: 11, font });
      y -= 15;
    }
    y -= 10;
  }
  page.drawText("Total revenue per trial balance: $1,234,567.89", {
    x: 72,
    y: y - 10,
    size: 11,
    font: bold,
  });
  return doc.save();
}

/**
 * A small schedule for the calculator (Phase 4 stage 3): amounts right-aligned in
 * columns, column totals that foot, a Total column that cross-foots, and a "per general
 * ledger" amount that is 0.50 off the Q1 total (a variance to find).
 */
export const FOOTING_ROWS = [
  ["Cash", "1,250.00", "300.00", "1,550.00"],
  ["Receivables", "4,100.50", "(200.50)", "3,900.00"],
  ["Inventory", "2,000.00", "750.25", "2,750.25"],
  ["Prepaids", "500.00", "0.00", "500.00"],
  ["Total", "7,850.50", "849.75", "8,700.25"],
];

async function footingSchedule() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic footing schedule");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("Current Assets Schedule (synthetic)", { x: 72, y: 720, size: 16, font: bold });
  const cols = [340, 430, 520];
  ["Q1", "Q2", "Total"].forEach((h, i) =>
    page.drawText(h, { x: cols[i] - bold.widthOfTextAtSize(h, 11), y: 680, size: 11, font: bold }),
  );
  FOOTING_ROWS.forEach((row, r) => {
    const y = 655 - r * 24;
    const f = r === FOOTING_ROWS.length - 1 ? bold : font;
    page.drawText(row[0], { x: 72, y, size: 11, font: f });
    row
      .slice(1)
      .forEach((v, i) =>
        page.drawText(v, { x: cols[i] - f.widthOfTextAtSize(v, 11), y, size: 11, font: f }),
      );
  });
  page.drawText("Q1 per general ledger: 7,850.00", { x: 72, y: 500, size: 11, font });
  return doc.save();
}

async function long200() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic 200-page document");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let n = 1; n <= 200; n++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${n} of 200`, { x: 72, y: 740, size: 14, font });
    page.drawText(`Section ${Math.ceil(n / 10)} - schedule line ${n}`, {
      x: 72,
      y: 715,
      size: 11,
      font,
    });
    let y = 690;
    for (const l of wrap(LOREM, font, 11, 468)) {
      page.drawText(l, { x: 72, y, size: 11, font });
      y -= 14;
    }
    page.drawText(String(n), { x: 300, y: 36, size: 10, font });
  }
  return doc.save();
}

async function long500() {
  // Phase 1 performance target: opens to first page < 2 s, scrolls without lingering
  // blank pages. Each page has text plus a ruled table so rendering is not trivial.
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic 500-page document");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 500; n++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${n} of 500`, { x: 72, y: 740, size: 14, font: bold });
    page.drawText(`Workpaper ${String(Math.ceil(n / 25)).padStart(2, "0")}-${n}`, {
      x: 72,
      y: 718,
      size: 11,
      font,
    });
    let y = 690;
    for (let row = 0; row < 24; row++) {
      page.drawLine({ start: { x: 72, y: y - 4 }, end: { x: 540, y: y - 4 }, thickness: 0.4 });
      page.drawText(`Line ${row + 1}  Account ${1000 + row * 10}`, { x: 76, y, size: 9, font });
      const amount = ((n * 7919 + row * 104729) % 1000000) / 100;
      page.drawText(amount.toFixed(2), { x: 470, y, size: 9, font });
      y -= 22;
    }
    page.drawText(String(n), { x: 300, y: 36, size: 10, font });
  }
  return doc.save();
}

/**
 * Viewer navigation fixture: nested outline (3 levels), two embedded attachments,
 * mixed page sizes (Letter, Legal, A4, landscape Letter) and a page with /Rotate 90.
 */
export const NAV_LAYOUT = {
  pages: [
    { label: "Cover", size: [612, 792] },
    { label: "Letter portrait", size: [612, 792] },
    { label: "Legal portrait", size: [612, 1008] },
    { label: "A4 portrait", size: [595.28, 841.89] },
    { label: "Letter landscape", size: [792, 612] },
    { label: "Rotated 90", size: [612, 792], rotate: 90 },
    { label: "Schedule A", size: [612, 792] },
    { label: "Schedule B", size: [612, 792] },
  ],
  outline: [
    { title: "Cover", page: 0 },
    {
      title: "Part I - Sizes",
      page: 1,
      children: [
        { title: "Legal page", page: 2 },
        { title: "A4 page", page: 3, children: [{ title: "Landscape page", page: 4 }] },
      ],
    },
    { title: "Part II - Schedules", page: 6, children: [{ title: "Schedule B", page: 7 }] },
  ],
  attachments: [
    { name: "trial-balance.csv", mimeType: "text/csv", description: "Synthetic trial balance" },
    { name: "notes.txt", mimeType: "text/plain", description: "Synthetic notes" },
  ],
};

/** Writes /Outlines by hand (pdf-lib has no outline API). Items: { title, page, children }. */
function addOutline(doc, pages, items) {
  const ctx = doc.context;
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((item, i) => {
      const dict = ctx.obj({
        Title: PDFString.of(item.title),
        Parent: parentRef,
        Dest: ctx.obj([pages[item.page].ref, PDFName.of("XYZ"), null, null, null]),
      });
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < list.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (item.children?.length) {
        const kids = build(item.children, refs[i]);
        dict.set(PDFName.of("First"), kids[0]);
        dict.set(PDFName.of("Last"), kids[kids.length - 1]);
        dict.set(PDFName.of("Count"), ctx.obj(item.children.length));
      }
      ctx.assign(refs[i], dict);
    });
    return refs;
  };
  const outlinesRef = ctx.nextRef();
  const top = build(items, outlinesRef);
  ctx.assign(
    outlinesRef,
    ctx.obj({
      Type: PDFName.of("Outlines"),
      First: top[0],
      Last: top[top.length - 1],
      Count: ctx.obj(top.length),
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
}

async function navigation() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic navigation fixture");
  doc.setSubject("Outline, attachments, mixed page sizes");
  doc.setKeywords(["synthetic", "viewer"]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = NAV_LAYOUT.pages.map((p, i) => {
    const page = doc.addPage(p.size);
    if (p.rotate) page.setRotation(degrees(p.rotate));
    page.drawText(`${p.label} (page ${i + 1})`, { x: 48, y: p.size[1] - 72, size: 16, font });
    page.drawText("Navigation fixture: synthetic content only.", {
      x: 48,
      y: p.size[1] - 100,
      size: 10,
      font,
    });
    return page;
  });

  addOutline(doc, pages, NAV_LAYOUT.outline);

  const enc = new TextEncoder();
  // pdf-lib writes the EmbeddedFiles name tree in attach order, and name trees must be
  // sorted by name (qpdf 12 warns otherwise), so attach in name order.
  await doc.attach(enc.encode("Synthetic notes. No client data.\n"), "notes.txt", {
    mimeType: "text/plain",
    description: "Synthetic notes",
    creationDate: FIXED_DATE,
    modificationDate: FIXED_DATE,
  });
  await doc.attach(
    enc.encode("account,debit,credit\n1000,100.00,0.00\n2000,0.00,100.00\n"),
    "trial-balance.csv",
    {
      mimeType: "text/csv",
      description: "Synthetic trial balance",
      creationDate: FIXED_DATE,
      modificationDate: FIXED_DATE,
    },
  );
  return doc.save();
}

/** Not a PDF PDFium can open: a header followed by junk. Must trigger the "corrupt" path. */
function corrupt() {
  const junk = Buffer.alloc(4096);
  let x = 12345;
  for (let i = 0; i < junk.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    junk[i] = x & 0xff;
  }
  return Buffer.concat([Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"), junk]);
}

/**
 * A valid document whose cross-reference table points at the wrong offsets and whose
 * trailer startxref is wrong. qpdf repairs it (exit 3 = warnings) by reconstructing xref.
 */
function damagedXref(sourceBytes) {
  const s = Buffer.from(sourceBytes).toString("latin1");
  const at = s.lastIndexOf("startxref");
  const broken = s.slice(0, at) + "startxref\n999999\n%%EOF\n";
  return Buffer.from(broken, "latin1");
}

async function acroForm() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic AcroForm");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const label = (t, y) => page.drawText(t, { x: 72, y: y + 6, size: 11, font });

  label("Taxpayer name", 700);
  const name = form.createTextField("taxpayer.name");
  name.addToPage(page, { x: 200, y: 700, width: 300, height: 22 });

  label("Tax year", 660);
  const year = form.createDropdown("tax.year");
  year.addOptions(["2023", "2024", "2025"]);
  year.addToPage(page, { x: 200, y: 660, width: 100, height: 22 });

  label("Filing status", 620);
  const status = form.createRadioGroup("filing.status");
  ["single", "mfj", "mfs"].forEach((v, i) =>
    status.addOptionToPage(v, page, { x: 200 + i * 80, y: 620, width: 16, height: 16 }),
  );

  label("Signed 8879 received", 580);
  form.createCheckBox("signed.8879").addToPage(page, { x: 200, y: 580, width: 16, height: 16 });

  label("Notes", 520);
  const notes = form.createTextField("notes");
  notes.enableMultiline();
  notes.addToPage(page, { x: 200, y: 460, width: 300, height: 80 });
  return doc.save();
}

// ---- Image-only "scan" ------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Minimal PNG encoder. colorType 0 = gray (1 channel), 6 = RGBA (4 channels). */
export function png(width, height, colorType, pixels) {
  const channels = colorType === 6 ? 4 : 1;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  const stride = width * channels;
  const src = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++)
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Render page 0 of a PDF to RGBA with PDFium. */
async function rasterize(pdfBytes, scaleFactor) {
  const require = createRequire(import.meta.url);
  const { init } = await import("@embedpdf/pdfium");
  const { PdfiumNative } = await import("@embedpdf/engines/pdfium");
  const wasm = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"));
  const engine = new PdfiumNative(await init({ wasmBinary: wasm }), { fontFallback: null });
  const b = Buffer.from(pdfBytes);
  const content = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const src = await engine.openDocumentBuffer({ id: "raster-src", content }).toPromise();
  const img = await engine.renderPageRaw(src, src.pages[0], { scaleFactor }).toPromise();
  await engine.closeAllDocuments().toPromise();
  return img;
}

/** A red "REVIEWED" rubber stamp, RGBA PNG with transparent background. */
async function stampPng() {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([180, 60]);
  const red = rgb(0.75, 0.05, 0.05);
  page.drawRectangle({ x: 4, y: 4, width: 172, height: 52, borderColor: red, borderWidth: 4 });
  const w = bold.widthOfTextAtSize("REVIEWED", 26);
  page.drawText("REVIEWED", { x: (180 - w) / 2, y: 21, size: 26, font: bold, color: red });
  const img = await rasterize(await doc.save(), 3);
  const px = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  for (let i = 0; i < px.length; i += 4) {
    // Alpha from darkness: white paper -> transparent.
    px[i + 3] = 255 - Math.min(px[i], px[i + 1], px[i + 2]);
  }
  return png(img.width, img.height, 6, px);
}

async function scannedImageOnly(sourceBytes) {
  // Rasterize the 1-page text doc with PDFium, add deterministic speckle, embed as
  // a full-page image. The result has NO text layer (OCR target for a later phase).
  const img = await rasterize(sourceBytes, 200 / 72);

  const gray = Buffer.alloc(img.width * img.height);
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < gray.length; i++) {
    const r = img.data[i * 4],
      g = img.data[i * 4 + 1],
      b = img.data[i * 4 + 2];
    let v = 0.299 * r + 0.587 * g + 0.114 * b;
    v = v * 0.92 + 8; // slightly grey paper
    if (rand() < 0.002) v = 40; // speckle
    gray[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic scanned image-only document");
  const image = await doc.embedPng(png(img.width, img.height, 0, gray));
  const page = doc.addPage([612, 792]);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return doc.save();
}

// ---- SSN redaction fixture --------------------------------------------------

function xmp(ssn) {
  return `<?xpacket begin="${"\uFEFF"}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Synthetic SSN fixture</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Taxpayer ${ssn}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Layout (PDF points, origin bottom-left). Exported so tests can reason about it.
 * - page 1: SSN as one text run; SSN split across two runs; a sticky note over the
 *   first SSN; a form field holding the SSN; text that must survive redaction.
 * - page 2: the SSN again in a sentence.
 * - /Info Subject + Keywords and XMP dc:description contain the SSN.
 */
export const SSN_LAYOUT = {
  keepText: "KEEP: Fictitious Taxpayer, 123 Example Street",
  formField: { name: "taxpayer.ssn", rect: { x: 200, y: 560, width: 160, height: 22 } },
  /** Area-redaction zone: an image and a vector square lie fully inside it. */
  areaZone: { x: 60, y: 400, width: 200, height: 70 },
  areaImage: { x: 72, y: 410, width: 90, height: 30 },
  areaVector: { x: 190, y: 415, width: 23, height: 23 },
};

async function ssnFixture() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic SSN redaction fixture");
  doc.setSubject(`Return for taxpayer ${FAKE_SSN}`);
  doc.setKeywords(["synthetic", FAKE_SSN]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);

  p1.drawText(SSN_LAYOUT.keepText, { x: 72, y: 720, size: 12, font });
  p1.drawText(`SSN: ${FAKE_SSN}`, { x: 72, y: 690, size: 12, font });
  // Split runs: "000-12-" and "3456" are separate text-show operations.
  p1.drawText("Spouse SSN: 000-12-", { x: 72, y: 660, size: 12, font });
  const w = font.widthOfTextAtSize("Spouse SSN: 000-12-", 12);
  p1.drawText("3456", { x: 72 + w, y: 660, size: 12, font });
  p1.drawText("Line below must survive redaction: KEEP-THIS-LINE", {
    x: 72,
    y: 620,
    size: 12,
    font,
  });
  // A vector rectangle under the first SSN (vector content under the box).
  p1.drawRectangle({ x: 100, y: 686, width: 70, height: 1.5, color: rgb(0.8, 0, 0) });

  // Area zone: image + vector square fully inside SSN_LAYOUT.areaZone.
  p1.drawText("Area zone (image + vector below):", { x: 72, y: 480, size: 10, font });
  const img = await doc.embedPng(await stampPng());
  p1.drawImage(img, SSN_LAYOUT.areaImage);
  p1.drawRectangle({ ...SSN_LAYOUT.areaVector, color: rgb(0, 0.4, 0.8) });

  // Form field whose value is the SSN.
  p1.drawText("Field:", { x: 72, y: 566, size: 12, font });
  const field = doc.getForm().createTextField(SSN_LAYOUT.formField.name);
  field.setText(FAKE_SSN);
  field.addToPage(p1, SSN_LAYOUT.formField.rect);

  // Sticky-note (Text) annotation over the first SSN, contents contain the SSN.
  const note = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [110, 685, 130, 705],
    Contents: PDFString.of(`Reviewer: verify ${FAKE_SSN}`),
    T: PDFString.of("Reviewer"),
    Name: "Comment",
    F: 4,
  });
  p1.node.addAnnot(doc.context.register(note));

  const p2 = doc.addPage([612, 792]);
  p2.drawText(`Page 2. Dependent record references ${FAKE_SSN} for testing.`, {
    x: 72,
    y: 700,
    size: 12,
    font,
  });

  const meta = doc.context.stream(Buffer.from(xmp(FAKE_SSN), "utf8"), {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(meta));
  return doc.save({ useObjectStreams: false });
}

// ---- Leak suite corpus (Phase 5) --------------------------------------------
// Each file hides FAKE_SSN somewhere a redaction can miss. tests/redaction/leak-suite
// redacts it (search hits + `areas`) and checks every place with tools that share no
// code with the redaction engine. Rects are PDF points (x, y, width, height).

export const LEAK_FILES = [
  {
    file: "leak-scan.pdf",
    what: "scanned page with an OCR text layer (page 1) and without one (page 2)",
    areas: [{ page: 1, rect: { x: 194, y: 692, width: 110, height: 26 } }],
    keep: "KEEP-SCAN-LINE",
    sanitize: false,
  },
  {
    file: "leak-image.pdf",
    what: "transparent image (SMask) with the SSN in its left half, partly under the box",
    areas: [{ page: 0, rect: { x: 95, y: 495, width: 100, height: 40 } }],
    keep: "KEEP-IMG",
    sanitize: false,
    pixelsOnly: true,
  },
  {
    file: "leak-objects.pdf",
    what: "SSN in a form XObject, a link URI, a free-text comment, text drawn letter by letter",
    areas: [],
    keep: "KEEP-OBJ-LINE",
    sanitize: false,
  },
  {
    file: "leak-sanitize.pdf",
    what: "SSN in an attachment, document JavaScript, private data, /Info and invisible text",
    areas: [],
    keep: "KEEP-SAN-LINE",
    sanitize: true,
  },
  {
    file: "leak-revisions.pdf",
    what: "SSN removed in a later incremental revision, still in the earlier one",
    areas: [],
    keep: "KEEP-REV-LINE",
    sanitize: false,
    notDrawn: true,
  },
];

async function leakScan() {
  // The "paper": label at x 72, SSN on its own at x 200 (the area box), keep line.
  const paper = await PDFDocument.create();
  const pf = await paper.embedFont(StandardFonts.Helvetica);
  const pp = paper.addPage([612, 792]);
  pp.drawText("Taxpayer SSN:", { x: 72, y: 700, size: 14, font: pf });
  pp.drawText(FAKE_SSN, { x: 200, y: 700, size: 14, font: pf });
  pp.drawText("KEEP-SCAN-LINE", { x: 72, y: 600, size: 14, font: pf });
  const img = await rasterize(await paper.save(), 200 / 72);
  const gray = Buffer.alloc(img.width * img.height);
  for (let i = 0; i < gray.length; i++) gray[i] = img.data[i * 4];

  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic scan for the redaction leak suite");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(png(img.width, img.height, 0, gray));
  for (const ocr of [true, false]) {
    const page = doc.addPage([612, 792]);
    page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    if (!ocr) continue;
    // An OCR layer: the same words, invisible, where the scan shows them.
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText("Taxpayer SSN:", { x: 72, y: 700, size: 14, font });
    page.drawText(FAKE_SSN, { x: 200, y: 700, size: 14, font });
    page.drawText("KEEP-SCAN-LINE", { x: 72, y: 600, size: 14, font });
    page.pushOperators(popGraphicsState());
  }
  return doc.save();
}

async function leakImage() {
  // 200 x 30 pt picture: SSN on the left, KEEP-IMG on the right; alpha from darkness.
  const pic = await PDFDocument.create();
  const pf = await pic.embedFont(StandardFonts.Helvetica);
  const pp = pic.addPage([200, 30]);
  pp.drawText(FAKE_SSN, { x: 4, y: 10, size: 14, font: pf });
  pp.drawText("KEEP-IMG", { x: 120, y: 10, size: 14, font: pf });
  const img = await rasterize(await pic.save(), 4);
  const px = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  for (let i = 0; i < px.length; i += 4) px[i + 3] = 255 - Math.min(px[i], px[i + 1], px[i + 2]);

  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic image for the redaction leak suite");
  const page = doc.addPage([612, 792]);
  page.drawImage(await doc.embedPng(png(img.width, img.height, 6, px)), {
    x: 100,
    y: 500,
    width: 200,
    height: 30,
  });
  return doc.save();
}

async function leakObjects() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic objects for the redaction leak suite");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const src = await PDFDocument.create();
  const sp = src.addPage([300, 30]);
  sp.drawText(`Form SSN ${FAKE_SSN}`, {
    x: 0,
    y: 10,
    size: 12,
    font: await src.embedFont(StandardFonts.Helvetica),
  });
  const [form] = await doc.embedPdf(await src.save());
  const page = doc.addPage([612, 792]);
  page.drawPage(form, { x: 72, y: 690 });
  // One text-show per letter (some PDF writers do this).
  let x = 72;
  for (const ch of `Split SSN ${FAKE_SSN}`) {
    page.drawText(ch, { x, y: 650, size: 12, font });
    x += font.widthOfTextAtSize(ch, 12);
  }
  page.drawText("KEEP-OBJ-LINE", { x: 72, y: 600, size: 12, font });
  const ctx = doc.context;
  page.node.addAnnot(
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [72, 695, 250, 715],
        Border: [0, 0, 0],
        A: { S: "URI", URI: PDFString.of(`https://example.com/lookup?id=${FAKE_SSN}`) },
      }),
    ),
  );
  page.node.addAnnot(
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "FreeText",
        Rect: [160, 645, 260, 665],
        Contents: PDFString.of(`check ${FAKE_SSN}`),
        DA: PDFString.of("0 0 0 rg /Helv 10 Tf"),
        F: 4,
      }),
    ),
  );
  return doc.save();
}

async function leakSanitize() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic hidden data for the redaction leak suite");
  doc.setSubject(`Taxpayer ${FAKE_SSN}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(`SSN ${FAKE_SSN}`, { x: 72, y: 700, size: 12, font });
  page.drawText("KEEP-SAN-LINE", { x: 72, y: 600, size: 12, font });
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText(`hidden ${FAKE_SSN}`, { x: 72, y: 400, size: 12, font });
  page.pushOperators(popGraphicsState());
  await doc.attach(Buffer.from(`SSN ${FAKE_SSN}\n`), "notes.txt", { mimeType: "text/plain" });
  doc.addJavaScript("lookup", `var ssn = "${FAKE_SSN}";`);
  doc.catalog.set(
    PDFName.of("PieceInfo"),
    doc.context.obj({ Index: doc.context.obj({ Private: PDFString.of(FAKE_SSN) }) }),
  );
  return doc.save();
}

/** Revision 1 shows the SSN; revision 2 (appended, incremental) replaces the page text. */
async function leakRevisions() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic revisions for the redaction leak suite");
  const ctx = doc.context;
  const fontRef = ctx.register(
    ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" }),
  );
  const show = (y, t) => `BT /F1 12 Tf 72 ${y} Td (${t}) Tj ET`;
  const contents = ctx.register(
    ctx.stream(`${show(700, `SSN ${FAKE_SSN}`)}\n${show(600, "KEEP-REV-LINE")}`),
  );
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of("Contents"), contents);
  page.node.set(PDFName.of("Resources"), ctx.obj({ Font: { F1: fontRef } }));
  const rev1 = Buffer.from(await doc.save({ useObjectStreams: false }));

  const text = rev1.toString("latin1");
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
  const trailer = text.slice(text.lastIndexOf("trailer"));
  const size = /\/Size (\d+)/.exec(trailer)[1];
  const root = /\/Root (\d+ \d+ R)/.exec(trailer)[1];
  const info = /\/Info (\d+ \d+ R)/.exec(trailer)?.[1];
  const data = show(600, "KEEP-REV-LINE");
  const n = contents.objectNumber;
  const obj = `${n} 0 obj\n<< /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`;
  const at = rev1.length + 1;
  const xref = at + obj.length;
  const update =
    `\n${obj}xref\n0 1\n0000000000 65535 f \n${n} 1\n` +
    `${String(at).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size ${size} /Root ${root}${info ? ` /Info ${info}` : ""} /Prev ${prev} >>\n` +
    `startxref\n${xref}\n%%EOF\n`;
  return Buffer.concat([rev1, Buffer.from(update, "latin1")]);
}

// ---- Workpapers for page organization (Phase 2) -----------------------------

/**
 * Three 3-page workpapers with the SAME form field names (so a merge must rename them),
 * different filled values, two annotations each, and a nested outline.
 */
export const WORKPAPERS = ["a", "b", "c"].map((id, k) => ({
  file: `workpaper-${id}.pdf`,
  id: id.toUpperCase(),
  values: {
    "client.name": `Sample Client ${id.toUpperCase()}`,
    "tie.out": k !== 1,
    status: ["draft", "review", "final"][k],
  },
  outline: [
    {
      title: `${id.toUpperCase()} Cover`,
      page: 0,
      children: [{ title: `${id.toUpperCase()} Detail`, page: 1 }],
    },
    { title: `${id.toUpperCase()} Summary`, page: 2 },
  ],
  note: `Reviewer note ${id.toUpperCase()}`,
}));

/**
 * A page with a signature field whose value is a signature dictionary. Not a real
 * signature (no certificate, zeroed /Contents): enough for viewers to report "signed".
 */
async function signedFake() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic signed document");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Synthetic signed document. Not a real signature.", {
    x: 72,
    y: 700,
    size: 14,
    font,
  });
  const ctx = doc.context;
  const sig = ctx.register(
    ctx.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "adbe.pkcs7.detached",
      ByteRange: [0, 0, 0, 0],
      Contents: PDFHexString.of("00".repeat(64)),
      Name: PDFString.of("Test Signer"),
    }),
  );
  const field = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFString.of("Signature1"),
      V: sig,
      Rect: [72, 600, 272, 650],
      F: 4,
      P: page.ref,
    }),
  );
  page.node.set(PDFName.of("Annots"), ctx.obj([field]));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [field], SigFlags: 3 }));
  return doc.save();
}

/**
 * A dynamic XFA form (XFA-only): /NeedsRendering true, an XFA template, no AcroForm
 * widgets. The page shows only the placeholder a non-XFA viewer would see. Synthetic.
 */
/**
 * A flat (non-fillable) intake form for Prepare Form > Detect fields: underscore blanks,
 * a ruled line, square check boxes and an empty notes box. `FLAT_FORM_LAYOUT` lists
 * what a detector should find. Synthetic; no fields.
 */
export const FLAT_FORM_LAYOUT = {
  underscores: [
    { label: "Client name", y: 700 },
    { label: "Tax year", y: 670 },
  ],
  line: { label: "Preparer", y: 640, x: 160, w: 220 },
  boxes: [
    { label: "Married", y: 600, x: 72 },
    { label: "Dependents", y: 600, x: 200 },
  ],
  notes: { label: "Notes", x: 72, y: 470, w: 400, h: 90 },
};

async function flatForm() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic flat intake form");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const L = FLAT_FORM_LAYOUT;
  page.drawText("Client Intake (synthetic)", { x: 72, y: 740, size: 16, font });
  for (const u of L.underscores)
    page.drawText(`${u.label}: ______________________________`, { x: 72, y: u.y, size: 11, font });
  page.drawText(`${L.line.label}:`, { x: 72, y: L.line.y, size: 11, font });
  page.drawLine({
    start: { x: L.line.x, y: L.line.y - 2 },
    end: { x: L.line.x + L.line.w, y: L.line.y - 2 },
    thickness: 0.75,
  });
  for (const b of L.boxes) {
    page.drawRectangle({
      x: b.x,
      y: b.y,
      width: 10,
      height: 10,
      borderWidth: 0.75,
      borderColor: rgb(0, 0, 0),
    });
    page.drawText(b.label, { x: b.x + 16, y: b.y + 1, size: 11, font });
  }
  const n = L.notes;
  page.drawText(`${n.label}`, { x: n.x, y: n.y + n.h + 6, size: 11, font });
  page.drawRectangle({
    x: n.x,
    y: n.y,
    width: n.w,
    height: n.h,
    borderWidth: 0.75,
    borderColor: rgb(0, 0, 0),
  });
  return doc.save();
}

/**
 * A form with Acrobat calculations (Phase 6): built-in sums/averages/products, a
 * simplified-field-notation formula, a group sum over kids, number formats, a custom
 * script we must not run, and the calculation order in /AcroForm /CO. Synthetic.
 */
export const CALC_FORM = {
  inputs: ["Wages", "Interest", "Dividends"],
  sumKids: ["Line.0", "Line.1", "Line.2"],
};

async function calcForm() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic calculated form");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const ctx = doc.context;
  const js = (code) => ctx.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of(code) });
  const num2 = 'AFNumber_Format(2, 0, 0, 0, "", true);';
  const money = 'AFNumber_Format(2, 0, 2, 0, "$", true);';
  let y = 720;
  const text = (name, { calc, format } = {}) => {
    page.drawText(name, { x: 72, y: y + 5, size: 10, font });
    const f = form.createTextField(name);
    f.addToPage(page, { x: 220, y, width: 140, height: 18 });
    const aa = {};
    if (format) aa.F = js(format);
    if (calc) aa.C = js(calc);
    if (Object.keys(aa).length) f.acroField.dict.set(PDFName.of("AA"), ctx.obj(aa));
    y -= 28;
    return f;
  };
  for (const n of CALC_FORM.inputs) text(n, { format: num2 });
  const total = text("Total", {
    calc: 'AFSimple_Calculate("SUM", new Array ("Wages", "Interest", "Dividends"));',
    format: money,
  });
  const avg = text("Average", {
    calc: 'AFSimple_Calculate("AVG", "Wages, Interest, Dividends");',
    format: num2,
  });
  text("Deduction", { format: num2 });
  const net = text("Net", {
    calc: '/** BVCALC Total - Deduction EVCALC **/ event.value = AFMakeNumber(getField("Total").value) - AFMakeNumber(getField("Deduction").value);',
    format: money,
  });
  const half = text("Half", {
    calc: "/** BVCALC Net / 2 EVCALC **/ event.value = 0;",
    format: num2,
  });
  const custom = text("Custom", {
    calc: 'event.value = this.getField("Wages").value > 0 ? "yes" : "no";',
  });
  // A group: "Line" with kids Line.0..2, summed by the group's name.
  page.drawText("Lines", { x: 72, y: y + 5, size: 10, font });
  CALC_FORM.sumKids.forEach((n, i) => {
    form.createTextField(n).addToPage(page, { x: 220 + i * 60, y, width: 50, height: 18 });
  });
  y -= 28;
  const lines = text("LinesTotal", {
    calc: 'AFSimple_Calculate("SUM", new Array ("Line"));',
    format: num2,
  });
  form.acroForm.dict.set(
    PDFName.of("CO"),
    ctx.obj([total, avg, net, half, custom, lines].map((f) => f.acroField.ref)),
  );
  return doc.save({ updateFieldAppearances: true });
}

async function xfaOnly() {
  const doc = await PDFDocument.create();
  stamp(doc, "Synthetic XFA-only form");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("This form needs an XFA viewer to display.", { x: 72, y: 700, size: 14, font });
  const xdp =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">' +
    '<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">' +
    '<subform name="form1" layout="tb"><pageSet><pageArea name="Page1">' +
    '<contentArea x="0.25in" y="0.25in" w="8in" h="10.5in"/>' +
    '<medium stock="letter" short="8.5in" long="11in"/></pageArea></pageSet>' +
    '<field name="SyntheticName" w="3in" h="9mm"><ui><textEdit/></ui></field>' +
    "</subform></template>" +
    '<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/">' +
    "<xfa:data><form1><SyntheticName/></form1></xfa:data></xfa:datasets>" +
    "</xdp:xdp>";
  const ctx = doc.context;
  const xfa = ctx.register(ctx.flateStream(xdp));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [], XFA: xfa }));
  doc.catalog.set(PDFName.of("NeedsRendering"), ctx.obj(true));
  return doc.save();
}

async function workpaper(spec) {
  const doc = await PDFDocument.create();
  stamp(doc, `Synthetic workpaper ${spec.id}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [0, 1, 2].map((i) => {
    const page = doc.addPage([612, 792]);
    page.drawText(`Workpaper ${spec.id} - page ${i + 1} of 3`, { x: 72, y: 720, size: 18, font });
    page.drawText("Synthetic test document. No client data.", { x: 72, y: 696, size: 10, font });
    return page;
  });
  const form = doc.getForm();
  const name = form.createTextField("client.name");
  name.addToPage(pages[0], { x: 200, y: 600, width: 260, height: 22 });
  name.setText(spec.values["client.name"]);
  const tie = form.createCheckBox("tie.out");
  tie.addToPage(pages[1], { x: 200, y: 600, width: 16, height: 16 });
  if (spec.values["tie.out"]) tie.check();
  const status = form.createRadioGroup("status");
  ["draft", "review", "final"].forEach((v, i) =>
    status.addOptionToPage(v, pages[2], { x: 200 + i * 60, y: 600, width: 16, height: 16 }),
  );
  status.select(spec.values.status);

  // Annotations: a sticky note on page 1 and a red square on page 2.
  const ctx = doc.context;
  const annot = (page, dict) => {
    const ref = ctx.register(ctx.obj(dict));
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of("Annots"), ctx.obj([ref]));
  };
  annot(pages[0], {
    Type: "Annot",
    Subtype: "Text",
    Rect: [480, 700, 500, 720],
    Contents: PDFString.of(spec.note),
    T: PDFString.of("Reviewer"),
    Name: "Comment",
    C: [1, 0.9, 0.2],
  });
  annot(pages[1], {
    Type: "Annot",
    Subtype: "Square",
    Rect: [72, 400, 300, 480],
    C: [1, 0, 0],
    Border: [0, 0, 2],
    Contents: PDFString.of(`Square ${spec.id}`),
  });
  addOutline(doc, pages, spec.outline);
  return doc.save();
}

// ---- qpdf -------------------------------------------------------------------

/**
 * qpdf for the encrypted fixtures: $QPDF, then PATH, then the copy that
 * `npm run tauri build` fetched into src-tauri/vendor/qpdf (Windows).
 */
let qpdfCached;
export function qpdfBin() {
  if (qpdfCached) return qpdfCached;
  const candidates = [
    process.env.QPDF,
    "qpdf",
    join(here, "..", "..", "src-tauri", "vendor", "qpdf", "qpdf.exe"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      qpdfCached = c;
      return c;
    } catch {
      // try the next one
    }
  }
  throw new Error(
    "qpdf not found. Install it (winget install qpdf.qpdf), set QPDF to qpdf.exe, " +
      "or run `npm run fetch-win-binaries -- --force` to use the bundled copy.",
  );
}

// ---- Main -------------------------------------------------------------------

export async function generateCorpus({ force = false } = {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = (name) => join(OUT_DIR, name);
  const made = [];
  const write = async (name, fn) => {
    if (!force && existsSync(out(name))) return;
    writeFileSync(out(name), await fn());
    made.push(name);
  };

  await write("text-1p.pdf", textOnePage);
  await write("footing.pdf", footingSchedule);
  await write("long-200p.pdf", long200);
  await write("long-500p.pdf", long500);
  await write("navigation.pdf", navigation);
  await write("corrupt.pdf", async () => corrupt());
  await write("acroform.pdf", acroForm);
  await write("xfa-only.pdf", xfaOnly);
  await write("flat-form.pdf", flatForm);
  await write("calc-form.pdf", calcForm);
  await write("scanned-image-only.pdf", async () =>
    scannedImageOnly(readFileSync(out("text-1p.pdf"))),
  );
  await write("ssn-redaction.pdf", ssnFixture);
  await write("leak-scan.pdf", leakScan);
  await write("leak-image.pdf", leakImage);
  await write("leak-objects.pdf", leakObjects);
  await write("leak-sanitize.pdf", leakSanitize);
  await write("leak-revisions.pdf", leakRevisions);
  for (const w of WORKPAPERS) await write(w.file, () => workpaper(w));
  await write("signed-fake.pdf", signedFake);
  await write("stamp-reviewed.png", stampPng);
  // useObjectStreams: false so the xref is a plain table that damagedXref can break.
  await write("damaged-xref.pdf", async () => {
    const doc = await PDFDocument.load(readFileSync(out("text-1p.pdf")));
    return damagedXref(await doc.save({ useObjectStreams: false }));
  });

  if (force || !existsSync(out("encrypted.pdf"))) {
    const { user, owner } = ENCRYPTED_PASSWORDS;
    execFileSync(qpdfBin(), [
      "--encrypt",
      user,
      owner,
      "256",
      "--",
      out("text-1p.pdf"),
      out("encrypted.pdf"),
    ]);
    made.push("encrypted.pdf");
  }
  if (force || !existsSync(out("no-print.pdf"))) {
    // Opens without a password, but the owner disallowed printing (and copying).
    execFileSync(qpdfBin(), [
      "--encrypt",
      "",
      ENCRYPTED_PASSWORDS.owner,
      "256",
      "--print=none",
      "--extract=n",
      "--",
      out("text-1p.pdf"),
      out("no-print.pdf"),
    ]);
    made.push("no-print.pdf");
  }
  return made;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const made = await generateCorpus({ force: process.argv.includes("--force") });
  console.log(made.length ? `generated: ${made.join(", ")}` : "corpus up to date");
}
