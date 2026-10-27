#!/usr/bin/env node
// Generates the B3 (Edit PDF) "real-format" samples: synthetic pages laid out the way
// tax and accounting software writes them. All names, amounts, numbers and form
// numbers are made up. Deterministic; safe to delete and rerun.
//
// Fonts are the standard 14 (Helvetica, Times, Courier) and are NOT embedded, the way
// most tax software output is written. Nothing is embedded, so the files are safe to
// commit. Content streams are written by hand so the operators match that output:
//   - Tf 1 plus a scaling Tm (print-driver style), or Tf size plus Td
//   - one BT with TL / T* for a block of lines; Tw word spacing for justified lines
//   - TJ arrays with kerning; Tc character spacing; Tz horizontal scaling
//   - one Tj per glyph and no space characters (some PDF printer drivers)
//   - Courier statements: one Tj per line, columns padded with spaces, so one text
//     object holds two "cells"
//   - form data (Courier) written after the whole form, as an overlay
//   - dot leaders as their own run, on a fixed grid after the label
//
// Each PDF has a `<name>.expected.json` listing what a reader should see as editable
// text: `{ kind, text, lines }` is one paragraph; `box: true` means one box holding
// those lines (an address block), whatever paragraphs it splits into.
//
// Usage: node tests/corpus/edit/real-format/generate.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const FIXED_DATE = new Date("2025-01-15T12:00:00Z");
const n2 = (v) => +v.toFixed(2);

const FONTS = {
  H: StandardFonts.Helvetica,
  HB: StandardFonts.HelveticaBold,
  T: StandardFonts.TimesRoman,
  TB: StandardFonts.TimesRomanBold,
  C: StandardFonts.Courier,
  CB: StandardFonts.CourierBold,
};

class Sample {
  static async create(title) {
    const s = new Sample();
    s.doc = await PDFDocument.create();
    s.doc.setTitle(title);
    s.doc.setAuthor("PDF Workbench test corpus");
    s.doc.setProducer("tests/corpus/edit/real-format/generate.mjs");
    s.doc.setCreator("Synthetic tax software");
    s.doc.setCreationDate(FIXED_DATE);
    s.doc.setModificationDate(FIXED_DATE);
    s.page = s.doc.addPage([612, 792]);
    s.f = {};
    for (const [key, std] of Object.entries(FONTS)) {
      const font = await s.doc.embedStandardFont(std);
      s.f[key] = { font, tag: s.page.node.newFontDictionary(key, font.ref).toString() };
    }
    s.ops = [];
    s.expected = [];
    return s;
  }

  hex(f, str) {
    return f.font.encodeText(str).toString();
  }

  /**
   * Advance of `str`, with character spacing `tc` (pt) and horizontal scale `tz` (%).
   * Summed per letter: pdf-lib's width adds AFM kerning, but Tj applies none.
   */
  width(str, size, f, { tc = 0, tz = 100 } = {}) {
    let w = 0;
    for (const c of str) w += f.font.widthOfTextAtSize(c, size) + tc;
    return w * (tz / 100);
  }

  wrap(text, size, width, f, opts) {
    const lines = [];
    let line = "";
    for (const w of text.split(" ")) {
      const next = line ? `${line} ${w}` : w;
      if (line && this.width(next, size, f, opts) > width) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** One run. `tm`: Tf 1 and the size in the text matrix (print-driver style). */
  run(str, x, y, size, f, { tm = false, tc = 0, tz = 100, tw = 0 } = {}) {
    const state = [tc && `${n2(tc)} Tc`, tz !== 100 && `${tz} Tz`, tw && `${n2(tw)} Tw`]
      .filter(Boolean)
      .join(" ");
    const pos = tm
      ? `${f.tag} 1 Tf ${size} 0 0 ${size} ${n2(x)} ${n2(y)} Tm`
      : `${f.tag} ${size} Tf ${n2(x)} ${n2(y)} Td`;
    // Tc/Tz/Tw are graphics state and outlive ET, so a run that sets them is wrapped in q/Q.
    const body = `BT ${state} ${pos} ${this.hex(f, str)} Tj ET`;
    this.ops.push(state ? `q ${body} Q` : body);
  }

  /** Several lines in ONE BT block, moved with TL / T*. `tw[i]`: word spacing per line. */
  block(lines, x, y, size, f, leading, tw = []) {
    const out = [`BT ${f.tag} ${size} Tf ${n2(leading)} TL ${n2(x)} ${n2(y)} Td`];
    lines.forEach((l, i) => {
      if (i) out.push("T*");
      out.push(`${n2(tw[i] ?? 0)} Tw ${this.hex(f, l)} Tj`);
    });
    out.push("ET");
    this.ops.push(out.join(" "));
  }

  /** TJ with kerning: `parts` alternates strings and adjustments (thousandths of an em). */
  kerned(parts, x, y, size, f) {
    const arr = parts.map((p) => (typeof p === "string" ? this.hex(f, p) : String(p))).join(" ");
    this.ops.push(`BT ${f.tag} ${size} Tf ${n2(x)} ${n2(y)} Td [${arr}] TJ ET`);
  }

  /** Every glyph its own BT/Tj; spaces are never written, only skipped over. */
  perChar(str, x, y, size, f) {
    let cx = x;
    for (const c of str) {
      if (c !== " ")
        this.ops.push(`BT ${f.tag} ${size} Tf ${n2(cx)} ${n2(y)} Td ${this.hex(f, c)} Tj ET`);
      cx += this.width(c, size, f);
    }
  }

  rule(x1, y1, x2, y2, w = 0.5) {
    this.ops.push(`${w} w ${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S`);
  }

  expect(kind, text, lines = 1, box = false) {
    this.expected.push(box ? { kind, text, lines, box: true } : { kind, text, lines });
  }

  async save(name) {
    const stream = this.doc.context.flateStream(this.ops.join("\n"));
    this.page.node.addContentStream(this.doc.context.register(stream));
    writeFileSync(join(here, `${name}.pdf`), await this.doc.save({ useObjectStreams: false }));
    writeFileSync(
      join(here, `${name}.expected.json`),
      JSON.stringify(this.expected, null, 2) + "\n",
    );
  }
}

/** A made-up individual return page: form in Helvetica, data overlaid in Courier. */
async function form9999() {
  const s = await Sample.create("Synthetic tax form page (Form 9999)");
  const { H, HB, C } = s.f;
  const overlay = []; // data is written after the whole form, like tax software does
  const top = 756;
  s.rule(36, top, 576, top, 1.5);
  s.rule(36, top - 40, 576, top - 40, 1.5);
  s.rule(112, top, 112, top - 40);
  s.rule(468, top, 468, top - 40);
  s.run("Form", 38, top - 10, 6, H, { tm: true });
  s.run("9999", 38, top - 30, 18, HB, { tm: true });
  s.run("Sample Individual Return of Fictitious Income", 130, top - 16, 12, HB, { tm: true });
  s.run("For the year Jan. 1 - Dec. 31, 2024, or other tax year beginning", 130, top - 30, 7, H, {
    tm: true,
  });
  s.run("OMB No. 0000-0000", 474, top - 10, 6, H, { tm: true });
  s.run("2024", 498, top - 32, 18, HB, { tm: true });
  s.expect("line", "Form");
  s.expect("line", "9999");
  s.expect("line", "Sample Individual Return of Fictitious Income");
  s.expect("line", "For the year Jan. 1 - Dec. 31, 2024, or other tax year beginning");
  s.expect("line", "OMB No. 0000-0000");
  s.expect("line", "2024");

  // Name and address cells: a 6 pt label at the top of each cell, data below it.
  const cells = [
    [716, 36, 250, "Your first name and middle initial", "SAMPLE A"],
    [716, 250, 468, "Last name", "TESTPAYER"],
    [716, 468, 576, "Your identifying number", "XXX-XX-0000"],
    [692, 36, 468, "Home address (number and street)", "100 EXAMPLE STREET"],
    [692, 468, 576, "Apt. no.", ""],
    [668, 36, 468, "City, town, or post office, state, and ZIP code", "ANYTOWN ST 00000"],
  ];
  for (const [y, l, r, label, data] of cells) {
    s.rule(l, y - 24, r, y - 24);
    if (l > 36) s.rule(l, y, l, y - 24);
    s.run(label, l + 2, y - 7, 6, H, { tm: true });
    s.expect("label", label);
    if (data) {
      overlay.push(() => s.run(data, l + 4, y - 20, 10, C, { tm: true }));
      s.expect("value", data);
    }
  }

  s.run("Income", 36, 630, 9, HB, { tm: true });
  s.expect("heading", "Income");
  const rows = [
    ["1a", ["Total amount from Form(s) W-2, box 1 (see instructions)"], "45,000."],
    ["b", ["Household employee wages not reported on Form(s) W-2"], ""],
    ["2b", ["Taxable interest"], "1,234."],
    ["3b", ["Ordinary dividends"], "567."],
    [
      "4",
      [
        "Taxable refunds, credits, or offsets of state and local income taxes and",
        "amounts from a prior-year return (see instructions)",
      ],
      "",
    ],
    ["7", ["Capital gain or (loss). Attach Schedule D if required"], "2,500."],
    ["8", ["Additional income from Schedule 1, line 10"], "800."],
    ["9", ["Add lines 1a, 2b, 3b, 4, 7, and 8. This is your total income"], "50,101."],
  ];
  let y = 622;
  const dot = s.width(". ", 7, H);
  for (const [num, label, amount] of rows) {
    const h = 12 * label.length;
    s.run(num, 36 + (num.length === 1 ? 4 : 0), y - 9, 7, HB, { tm: true });
    label.forEach((l, i) => s.run(l, 58, y - 9 - i * 10, 7, H, { tm: true }));
    s.expect("label", label.join(" "), label.length);
    // Leaders start on a fixed 8 pt grid after the label, as form software lays them.
    const lastY = y - 9 - (label.length - 1) * 10;
    const end = 58 + s.width(label.at(-1), 7, H);
    const start = 58 + Math.ceil((end + 2 - 58) / 8) * 8;
    const count = Math.floor((462 - start) / dot);
    if (count > 1) s.run(". ".repeat(count).trim(), start, lastY, 7, H, { tm: true });
    s.run(num, 474 - s.width(num, 7, HB) / 2, lastY, 7, HB, { tm: true });
    s.rule(468, y, 468, y - h);
    s.rule(480, y, 480, y - h);
    s.rule(468, y - h, 576, y - h);
    if (amount) {
      const ay = lastY;
      overlay.push(() => s.run(amount, 570 - s.width(amount, 9, C), ay, 9, C, { tm: true }));
      s.expect("amount", amount);
    }
    y -= h;
  }
  s.run(
    "For Privacy Act and Paperwork Reduction Act Notice, see separate instructions.",
    36,
    40,
    6,
    HB,
    { tm: true },
  );
  s.run("Cat. No. 00000X", 300, 40, 6, H, { tm: true });
  s.run("Form 9999 (2024)", 520, 40, 7, HB, { tm: true });
  s.expect(
    "line",
    "For Privacy Act and Paperwork Reduction Act Notice, see separate instructions.",
  );
  s.expect("line", "Cat. No. 00000X");
  s.expect("line", "Form 9999 (2024)");
  for (const draw of overlay) draw();
  await s.save("form-9999");
}

/** Courier supporting statements: one Tj per line, columns padded with spaces. */
async function statementCourier() {
  const s = await Sample.create("Synthetic Courier supporting statement");
  const { C } = s.f;
  const W = 72; // characters per line at 9 pt Courier = 388.8 pt
  const pad = (left, right) =>
    left + " ".repeat(Math.max(1, W - left.length - right.length)) + right;
  const center = (t) => " ".repeat(Math.floor((W - t.length) / 2)) + t;
  const lines = [];
  const add = (str, expect = []) => lines.push({ str, expect });
  add(pad("2024", "FEDERAL STATEMENTS"), [
    ["line", "2024"],
    ["line", "FEDERAL STATEMENTS"],
  ]);
  add(pad("SAMPLE A TESTPAYER", "XXX-XX-0000"), [
    ["line", "SAMPLE A TESTPAYER"],
    ["line", "XXX-XX-0000"],
  ]);
  add("");
  add(center("STATEMENT 1"), [["heading", "STATEMENT 1"]]);
  add(center("FORM 9999, LINE 2B - TAXABLE INTEREST"), [
    ["heading", "FORM 9999, LINE 2B - TAXABLE INTEREST"],
  ]);
  add("");
  add(pad("DESCRIPTION", "AMOUNT"));
  add(pad("-".repeat(46), "-".repeat(10)));
  add(pad("FIRST SAMPLE BANK", "812."), [
    ["cell", "FIRST SAMPLE BANK"],
    ["amount", "812."],
  ]);
  add(pad("SECOND SAMPLE CREDIT UNION", "422."), [
    ["cell", "SECOND SAMPLE CREDIT UNION"],
    ["amount", "422."],
  ]);
  add(pad("", "-".repeat(10)));
  add(pad("TOTAL TO FORM 9999, LINE 2B", "$ 1,234."), [
    ["cell", "TOTAL TO FORM 9999, LINE 2B"],
    ["amount", "$ 1,234."],
  ]);
  add(pad("", "=".repeat(10)));
  add("");
  add(center("STATEMENT 2"), [["heading", "STATEMENT 2"]]);
  add(center("FORM 9999, LINE 8 - OTHER INCOME"), [
    ["heading", "FORM 9999, LINE 8 - OTHER INCOME"],
  ]);
  add("");
  add(pad("DESCRIPTION", "AMOUNT"));
  add(pad("-".repeat(46), "-".repeat(10)));
  // A description wrapped onto two lines; the amount sits on the last line.
  add("PRIZE FROM SAMPLE RADIO CONTEST REPORTED ON");
  add(pad("FORM 1099-MISC, BOX 3", "800."), [["amount", "800."]]);
  s.expect("cell", "PRIZE FROM SAMPLE RADIO CONTEST REPORTED ON FORM 1099-MISC, BOX 3", 2);
  add(pad("", "=".repeat(10)));

  let y = 740;
  for (const { str, expect } of lines) {
    if (str.trim()) s.run(str, 72, y, 9, C);
    for (const [kind, text] of expect) s.expect(kind, text);
    y -= 11;
  }
  await s.save("statement-courier");
}

/** Transmittal letter in Times: TL/T* blocks, Tw justification, TJ kerning. */
async function transmittalLetter() {
  const s = await Sample.create("Synthetic transmittal letter");
  const { T, TB } = s.f;
  const cx = (str, size, f) => 306 - s.width(str, size, f) / 2;
  const firm = "SAMPLE & PARTNERS CPAS";
  const addr = "100 Example Street, Suite 200, Anytown, ST 00000";
  s.run(firm, cx(firm, 14, TB), 730, 14, TB);
  s.run(addr, cx(addr, 9, T), 716, 9, T);
  s.expect("heading", firm);
  s.expect("line", addr);
  s.rule(72, 708, 540, 708, 0.75);

  s.run("February 14, 2025", 72, 680, 11, T);
  s.expect("line", "February 14, 2025");
  const to = ["Sample A. Testpayer", "100 Example Street", "Anytown, ST 00000"];
  s.block(to, 72, 650, 11, T, 13);
  s.expect("address", to.join(" "), 3, true);
  s.run("Dear Sample Testpayer:", 72, 600, 11, T);
  s.expect("line", "Dear Sample Testpayer:");

  // Justified with Tw on every line but the last.
  const body1 =
    "We have prepared your 2024 federal and state income tax returns from the information you provided. The returns have been filed electronically, and copies are enclosed for your records. Please review them carefully and let us know right away if anything appears to be incomplete or incorrect.";
  const width = 468;
  let y = 574;
  const just = (text) => {
    const lines = s.wrap(text, 11, width, T);
    const tw = lines.map((l, i) => {
      const spaces = l.split(" ").length - 1;
      return i < lines.length - 1 && spaces ? (width - s.width(l, 11, T)) / spaces : 0;
    });
    s.block(lines, 72, y, 11, T, 13.5, tw);
    s.expect("paragraph", text, lines.length);
    y -= lines.length * 13.5 + 10;
  };
  just(body1);

  // Ragged right, one Tj per line, the first word kerned with TJ.
  const body2 =
    "Your federal return shows a balance due of $1,234. Please mail your payment with the enclosed voucher by April 15, 2025 to:";
  const lines2 = s.wrap(body2, 11, width, T);
  const [w0, ...rest] = lines2[0].split(" ");
  s.kerned([w0.slice(0, 1), 40, w0.slice(1) + " " + rest.join(" ")], 72, y, 11, T);
  lines2.slice(1).forEach((l, i) => s.run(l, 72, y - 13.5 * (i + 1), 11, T));
  s.expect("paragraph", body2, lines2.length);
  y -= lines2.length * 13.5 + 10;

  const irs = ["Internal Revenue Service", "P.O. Box 000000", "Anytown, ST 00000-0000"];
  s.block(irs, 144, y, 11, T, 13);
  s.expect("address", irs.join(" "), 3, true);
  y -= 3 * 13 + 10;

  just(
    "If you have questions about the returns or the payment, please call our office. We appreciate the opportunity to serve you and look forward to working with you again next year.",
  );
  s.run("Sincerely,", 72, y, 11, T);
  s.run("Sample & Partners CPAs", 72, y - 40, 11, T);
  s.run("Enclosures", 72, y - 70, 9, T);
  s.expect("line", "Sincerely,");
  s.expect("line", "Sample & Partners CPAs");
  s.expect("line", "Enclosures");
  await s.save("transmittal-letter");
}

/** Filing instructions: Tf 1 + Tm everywhere, ruled two-column table, bullets, Tz. */
async function filingInstructions() {
  const s = await Sample.create("Synthetic filing instructions");
  const { H, HB } = s.f;
  const tm = { tm: true };
  s.run("2024 Federal Filing Instructions", 72, 730, 14, HB, tm);
  s.run("Prepared for Sample A. Testpayer", 72, 714, 10, H, tm);
  s.expect("heading", "2024 Federal Filing Instructions");
  s.expect("line", "Prepared for Sample A. Testpayer");

  const rows = [
    ["Form", "Form 9999 Sample Individual Return of Fictitious Income"],
    ["Amount due", "$1,234"],
    ["Due date", "April 15, 2025"],
    ["Make check payable to", "United States Treasury"],
    ["Mail to", ["Internal Revenue Service", "P.O. Box 000000", "Anytown, ST 00000-0000"]],
    [
      "Special instructions",
      "Write your identifying number, the tax year and the form number on your check. Do not staple the check to the voucher. Keep a copy of the return for at least three years.",
    ],
  ];
  const L = 72;
  const M = 216;
  const R = 540;
  let top = 696;
  s.rule(L, top, R, top);
  for (const [label, value] of rows) {
    const lines = Array.isArray(value) ? value : s.wrap(value, 9, R - M - 12, H);
    const h = lines.length * 11 + 8;
    s.run(label, L + 6, top - 13, 9, HB, tm);
    lines.forEach((l, i) => s.run(l, M + 6, top - 13 - i * 11, 9, H, tm));
    s.expect("label", label);
    if (Array.isArray(value)) s.expect("address", value.join(" "), value.length, true);
    else s.expect("cell", value, lines.length);
    s.rule(L, top - h, R, top - h);
    for (const x of [L, M, R]) s.rule(x, top, x, top - h);
    top -= h;
  }

  s.run("Before you mail the return", 72, top - 30, 11, HB, tm);
  s.expect("heading", "Before you mail the return");
  let y = top - 48;
  for (const item of [
    "Sign and date the return. Both spouses must sign a joint return.",
    "Attach Forms W-2 and any Form 1099 that shows federal income tax withheld to the front of the return.",
    "Use the envelope provided, with enough postage. Returns mailed without postage are sent back to you.",
  ]) {
    const lines = s.wrap(item, 9, 450, H, { tz: 95 });
    s.run("•", 80, y, 9, H, tm);
    lines.forEach((l, i) => s.run(l, 90, y - i * 11, 9, H, { tm: true, tz: 95 }));
    s.expect("list-item", item, lines.length);
    y -= lines.length * 11 + 4;
  }
  await s.save("filing-instructions");
}

/** K-1 supplemental footnotes: 7 pt, bold run-in heads, Tc letter spacing, a small table. */
async function k1Supplemental() {
  const s = await Sample.create("Synthetic K-1 supplemental information");
  const { H, HB, C } = s.f;
  s.run("Schedule K-1 (Form 9965) Supplemental Information", 36, 750, 10, HB);
  s.run("Sample Holdings LP    Partner: Sample A. Testpayer", 36, 738, 7, H);
  s.expect("heading", "Schedule K-1 (Form 9965) Supplemental Information");
  s.expect("line", "Sample Holdings LP");
  s.expect("line", "Partner: Sample A. Testpayer");

  const notes = [
    [
      "Box 1 - Ordinary business income (loss).",
      "The amount shown is your share of the partnership's trade or business income. Report it on Schedule E, Part II. Passive activity rules may limit the loss you can deduct this year.",
      {},
    ],
    [
      "Box 20, Code Z - Section 199A information.",
      "The partnership's qualified business income, W-2 wages and unadjusted basis of qualified property are shown in the table below. These amounts are needed to figure your qualified business income deduction.",
      { tc: 0.15 },
    ],
    [
      "Box 21 - Foreign taxes paid or accrued.",
      "No foreign taxes were paid by the partnership for the year. This line is shown for completeness only.",
      { tz: 92 },
    ],
  ];
  let y = 718;
  const width = 540;
  for (const [head, body, opts] of notes) {
    // The bold head runs into the first line of the paragraph (two runs on one line).
    const headW = s.width(head + " ", 7, HB, opts);
    const firstLine = s.wrap(body, 7, width - headW, H, opts)[0];
    const rest = body.slice(firstLine.length + 1);
    const more = rest ? s.wrap(rest, 7, width, H, opts) : [];
    s.run(head, 36, y, 7, HB, opts);
    s.run(firstLine, 36 + headW, y, 7, H, opts);
    more.forEach((l, i) => s.run(l, 36, y - 8.5 * (i + 1), 7, H, opts));
    s.expect("paragraph", `${head} ${body}`, 1 + more.length);
    y -= 8.5 * (1 + more.length) + 6;
  }

  const rows = [
    ["Qualified business income", "12,345"],
    ["W-2 wages", "4,500"],
    ["Unadjusted basis of qualified property", "60,000"],
  ];
  y -= 6;
  for (const [label, amount] of rows) {
    s.run(label, 54, y, 7, H);
    s.run(amount, 300 - s.width(amount, 8, C), y, 8, C);
    s.expect("label", label);
    s.expect("amount", amount);
    s.rule(54, y - 3, 300, y - 3, 0.25);
    y -= 11;
  }
  await s.save("k1-supplemental");
}

/** PDF printer driver output: one Tj per glyph, no space characters anywhere. */
async function printDriverPerChar() {
  const s = await Sample.create("Synthetic per-glyph print driver output");
  const { T, TB, H } = s.f;
  s.perChar("Organizer Cover Note", 72, 720, 14, TB);
  s.expect("heading", "Organizer Cover Note");
  let y = 690;
  for (const p of [
    "Thank you for returning your tax organizer. We have recorded the documents listed below and will contact you if anything else is needed to complete your return.",
    "Items received after March 15 may delay your return. If you expect a corrected Form 1099, please let us know so that we can plan for an extension.",
  ]) {
    const lines = s.wrap(p, 10, 468, T);
    lines.forEach((l, i) => s.perChar(l, 72, y - i * 12.5, 10, T));
    s.expect("paragraph", p, lines.length);
    y -= lines.length * 12.5 + 8;
  }
  y -= 6;
  for (const [label, value] of [
    ["Client:", "Sample A. Testpayer"],
    ["Received:", "February 20, 2025"],
  ]) {
    s.perChar(label, 72, y, 9, H);
    s.perChar(value, 144, y, 9, H);
    s.expect("label", label);
    s.expect("value", value);
    y -= 13;
  }
  await s.save("print-driver-per-char");
}

for (const make of [
  form9999,
  statementCourier,
  transmittalLetter,
  filingInstructions,
  k1Supplemental,
  printDriverPerChar,
])
  await make();
console.log(`real-format samples written to ${here}`);
