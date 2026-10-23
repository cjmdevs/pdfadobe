#!/usr/bin/env node
// Generates the B3 (Edit PDF) spike samples. All names, amounts and form numbers are
// fake. Deterministic; safe to delete and rerun.
//
// Committed set (tests/corpus/edit/*.pdf): Liberation Sans (OFL-1.1, shipped in
// pdfjs-dist) embedded as a SUBSET, the way Word and most PDF makers embed fonts, so
// every sample has letters that are missing from its embedded font.
//
// Local set (--local, tests/corpus/edit/local/, gitignored): the same layouts in the
// installed Windows fonts (Calibri, Arial, Times New Roman). Windows font subsets must
// never be committed.
//
// Each PDF has a `<name>.expected.json` next to it listing the text blocks a reader
// should see (the grouping check compares against it).
//
// Usage: node tests/corpus/edit/generate.mjs [--local]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FIXED_DATE = new Date("2025-01-15T12:00:00Z");
const liberation = (style) =>
  join(
    dirname(require.resolve("pdfjs-dist/package.json")),
    "standard_fonts",
    `LiberationSans-${style}.ttf`,
  );

const WIN = process.env.WINDIR ? join(process.env.WINDIR, "Fonts") : "C:\\Windows\\Fonts";
const FONT_SETS = {
  committed: {
    dir: here,
    serif: { regular: liberation("Regular"), bold: liberation("Bold") },
    sans: { regular: liberation("Regular"), bold: liberation("Bold") },
    word: { regular: liberation("Regular"), bold: liberation("Bold") },
  },
  local: {
    dir: join(here, "local"),
    serif: { regular: join(WIN, "times.ttf"), bold: join(WIN, "timesbd.ttf") },
    sans: { regular: join(WIN, "arial.ttf"), bold: join(WIN, "arialbd.ttf") },
    word: { regular: join(WIN, "calibri.ttf"), bold: join(WIN, "calibrib.ttf") },
  },
};

class Sample {
  static async create(title, fonts) {
    const s = new Sample();
    s.doc = await PDFDocument.create();
    s.doc.registerFontkit(fontkit);
    s.doc.setTitle(title);
    s.doc.setAuthor("PDF Workbench test corpus");
    s.doc.setProducer("tests/corpus/edit/generate.mjs");
    s.doc.setCreator("pdf-lib");
    s.doc.setCreationDate(FIXED_DATE);
    s.doc.setModificationDate(FIXED_DATE);
    s.regular = await s.doc.embedFont(readFileSync(fonts.regular), { subset: true });
    s.bold = await s.doc.embedFont(readFileSync(fonts.bold), { subset: true });
    s.page = s.doc.addPage([612, 792]);
    s.expected = [];
    return s;
  }

  width(text, size, font = this.regular) {
    return font.widthOfTextAtSize(text, size);
  }

  /** One text run per call, like a PDF maker that writes each line or cell separately. */
  text(str, x, y, size, font = this.regular, color = rgb(0, 0, 0)) {
    this.page.drawText(str, { x, y, size, font, color });
  }

  wrap(text, size, width, font = this.regular) {
    const lines = [];
    let line = "";
    for (const w of text.split(" ")) {
      const next = line ? `${line} ${w}` : w;
      if (line && this.width(next, size, font) > width) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * A paragraph wrapped to `width`. `perWord` writes each word as its own run (how Word
   * writes justified text); `justify` spreads the words to both margins except the
   * last line. Returns the y below the paragraph.
   */
  paragraph(
    text,
    {
      x,
      y,
      size,
      width,
      leading,
      font = this.regular,
      perWord = false,
      justify = false,
      kind = "paragraph",
    },
  ) {
    const lines = this.wrap(text, size, width, font);
    lines.forEach((line, i) => {
      const words = line.split(" ");
      const last = i === lines.length - 1;
      if (!perWord && !(justify && !last)) {
        this.text(line, x, y, size, font);
      } else {
        const space = this.width(" ", size, font);
        const natural = words.reduce((a, w) => a + this.width(w, size, font), 0);
        const gap =
          justify && !last && words.length > 1 ? (width - natural) / (words.length - 1) : space;
        let cx = x;
        for (const w of words) {
          this.text(w, cx, y, size, font);
          cx += this.width(w, size, font) + gap;
        }
      }
      y -= leading;
    });
    this.expected.push({ kind, text, lines: lines.length });
    return y;
  }

  line(str, x, y, size, font = this.regular, kind = "line") {
    this.text(str, x, y, size, font);
    this.expected.push({ kind, text: str, lines: 1 });
  }

  rule(x1, y1, x2, y2, thickness = 0.6) {
    this.page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness,
      color: rgb(0, 0, 0),
    });
  }

  async save(dir, name) {
    writeFileSync(join(dir, `${name}.pdf`), await this.doc.save({ useObjectStreams: false }));
    writeFileSync(
      join(dir, `${name}.expected.json`),
      JSON.stringify(this.expected, null, 2) + "\n",
    );
  }
}

async function engagementLetter(set) {
  const s = await Sample.create("Synthetic engagement letter", set.serif);
  s.line("Sample & Partners CPAs", 72, 720, 14, s.bold, "heading");
  s.line("Engagement Letter - Tax Year 2024", 72, 700, 11, s.regular, "heading");
  let y = 660;
  y = s.paragraph(
    "This letter confirms the terms of our engagement to prepare your federal and state income tax returns for the year ended December 31, 2024. We will prepare the returns from information you provide to us, and we will not audit or otherwise verify the data you submit. You are responsible for the completeness and accuracy of that information.",
    { x: 72, y, size: 11, width: 468, leading: 14, perWord: true, justify: true },
  );
  y -= 10;
  y = s.paragraph(
    "Our fee for these services will be based on the time required at our standard billing rates, plus out-of-pocket costs. Invoices are due on presentation. If the engagement is terminated before completion, you agree to pay for the time expended to that date.",
    { x: 72, y: y, size: 11, width: 468, leading: 14, perWord: true, justify: true },
  );
  y -= 10;
  s.paragraph(
    "Please sign and return a copy of this letter to indicate your agreement with these terms.",
    {
      x: 72,
      y,
      size: 11,
      width: 468,
      leading: 14,
    },
  );
  await s.save(set.dir, "engagement-letter");
}

async function memo(set) {
  const s = await Sample.create("Synthetic Word-style memo", set.word);
  s.line("MEMORANDUM", 72, 720, 16, s.bold, "heading");
  const fields = [
    ["To:", "Audit file 24-0117"],
    ["From:", "Senior associate"],
    ["Date:", "February 3, 2025"],
    ["Re:", "Revenue cutoff testing"],
  ];
  let y = 690;
  for (const [label, value] of fields) {
    s.line(label, 72, y, 11, s.bold, "label");
    s.line(value, 144, y, 11, s.regular, "value");
    y -= 16;
  }
  s.rule(72, y + 6, 540, y + 6, 0.75);
  y -= 16;
  y = s.paragraph(
    "We selected sales invoices recorded in the last ten business days of the year and the first ten business days of the following year. For each invoice we traced the shipping document to confirm the revenue was recorded in the correct period.",
    { x: 72, y, size: 11, width: 468, leading: 15.5, perWord: true },
  );
  y -= 8;
  y = s.paragraph(
    "Two invoices dated December 30 were shipped on January 4. The client agreed to move both to the following year. No other exceptions were noted, and we consider the cutoff assertion supported.",
    { x: 72, y, size: 11, width: 468, leading: 15.5, perWord: true },
  );
  y -= 8;
  for (const item of [
    "Proposed adjustment AJE-07 reverses the two invoices.",
    "Manager review is scheduled for next week.",
  ]) {
    s.text("\u2022", 90, y, 11);
    y = s.paragraph(item, { x: 108, y, size: 11, width: 432, leading: 15.5, kind: "list-item" });
  }
  await s.save(set.dir, "memo");
}

async function pbcList(set) {
  const s = await Sample.create("Synthetic PBC list", set.sans);
  s.line("Prepared by Client (PBC) Request List", 72, 730, 14, s.bold, "heading");
  s.line("Client file 24-0117   Year end 12/31/2024", 72, 712, 9, s.regular, "line");
  const cols = [
    { x: 72, w: 24, head: "No." },
    { x: 100, w: 230, head: "Item requested" },
    { x: 334, w: 70, head: "Due" },
    { x: 408, w: 132, head: "Status" },
  ];
  const rows = [
    [
      "1",
      "Bank statements and reconciliations for all operating accounts, December and January",
      "01/20/2025",
      "Received",
    ],
    ["2", "Aged accounts receivable listing tied to the general ledger", "01/20/2025", "Open"],
    [
      "3",
      "Fixed asset additions over the capitalization threshold with invoices",
      "01/27/2025",
      "Partially received, two invoices outstanding",
    ],
    ["4", "Payroll register and quarterly payroll tax returns", "01/27/2025", "Open"],
  ];
  let top = 690;
  const size = 9;
  const lead = 11;
  const drawRow = (cells, font, bottomPad) => {
    const wrapped = cells.map((c, i) => s.wrap(c, size, cols[i].w - 6, font));
    const h = Math.max(...wrapped.map((w) => w.length)) * lead + bottomPad;
    wrapped.forEach((lines, i) => {
      lines.forEach((l, j) => s.text(l, cols[i].x + 3, top - 10 - j * lead, size, font));
      s.expected.push({ kind: "cell", text: cells[i], lines: lines.length });
    });
    s.rule(72, top - h, 540, top - h, 0.5);
    for (const c of cols) s.rule(c.x, top, c.x, top - h, 0.5);
    s.rule(540, top, 540, top - h, 0.5);
    top -= h;
  };
  s.rule(72, top, 540, top, 0.5);
  drawRow(
    cols.map((c) => c.head),
    s.bold,
    4,
  );
  for (const r of rows) drawRow(r, s.regular, 4);
  await s.save(set.dir, "pbc-list");
}

async function irsHeader(set) {
  // A made-up form in the style of an IRS form header (no real form number).
  const s = await Sample.create("Synthetic IRS-style form header", set.sans);
  const top = 750;
  s.rule(36, top, 576, top, 1.5);
  s.rule(36, top - 54, 576, top - 54, 1.5);
  s.rule(130, top, 130, top - 54, 0.5);
  s.rule(470, top, 470, top - 54, 0.5);
  s.line("Form", 40, top - 14, 7, s.regular, "line");
  s.line("9999-X", 40, top - 34, 20, s.bold, "line");
  // Two stacked short lines: expected as ONE wrapped box (we believe Acrobat does the
  // same; to be confirmed in the Acrobat check).
  s.text("Department of the Treasury", 40, top - 44, 6);
  s.text("Internal Revenue Service", 40, top - 51, 6);
  s.expected.push({
    kind: "stacked",
    text: "Department of the Treasury Internal Revenue Service",
    lines: 2,
  });
  s.line("Sample Return of Fictitious Income", 160, top - 18, 13, s.bold, "line");
  s.line(
    "For calendar year 2024 or tax year beginning ______, 2024, ending ______, 20__",
    150,
    top - 32,
    7,
    s.regular,
    "line",
  );
  s.line(
    "Go to the agency website for instructions and the latest information.",
    170,
    top - 44,
    7,
    s.regular,
    "line",
  );
  s.line("OMB No. 0000-0000", 476, top - 14, 7, s.regular, "line");
  s.line("2024", 495, top - 38, 20, s.bold, "line");
  s.rule(36, top - 78, 576, top - 78, 0.5);
  s.line("Name of taxpayer", 40, top - 62, 6, s.regular, "line");
  s.line("Identifying number", 440, top - 62, 6, s.regular, "line");
  s.line("Example Taxpayer LLC", 40, top - 74, 9, s.regular, "line");
  s.line("00-0000000", 440, top - 74, 9, s.regular, "line");
  await s.save(set.dir, "irs-header");
}

async function twoColumn(set) {
  const s = await Sample.create("Synthetic two-column newsletter", set.serif);
  s.line("Client Newsletter - Year-End Planning", 72, 730, 16, s.bold, "heading");
  const col = (x, paras) => {
    let y = 700;
    for (const p of paras) {
      y = s.paragraph(p, { x, y, size: 10, width: 222, leading: 13 });
      y -= 8;
    }
  };
  col(72, [
    "Retirement plan contributions made before the filing deadline can still reduce taxable income for the prior year. Review your plan limits with your advisor before making a deposit.",
    "Business owners should gather mileage logs and receipts now. Records kept during the year are far easier to support than estimates prepared at filing time.",
  ]);
  col(318, [
    "Estimated tax payments for the fourth quarter are due in January. A missed payment can result in a penalty even when a refund is expected later.",
    "Charitable gifts of appreciated stock may offer a larger benefit than cash. Ask us to review the holding period and fair value before you transfer shares.",
  ]);
  await s.save(set.dir, "two-column");
}

const set = process.argv.includes("--local") ? FONT_SETS.local : FONT_SETS.committed;
mkdirSync(set.dir, { recursive: true });
for (const make of [engagementLetter, memo, pbcList, irsHeader, twoColumn]) await make(set);
console.log(`edit samples written to ${set.dir}`);
