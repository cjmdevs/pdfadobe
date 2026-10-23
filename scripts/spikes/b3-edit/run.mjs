#!/usr/bin/env node
// B3 Edit PDF spike runner. Groups every sample, re-typesets one paragraph per sample
// in each font case, checks each result, and writes PDFs, PNGs and results.json to
// tests/corpus/out/edit/ (gitignored).
//
// Usage: node scripts/spikes/b3-edit/run.mjs [--local]   (--local also runs the
// Windows-font samples from tests/corpus/edit/local/; generate them first)

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { Mem, loadPdfium, objBounds, openDoc, renderPage, saveDoc } from "./pdfium.mjs";
import { groupPage, scoreGrouping } from "./group.mjs";
import { retypeset } from "./retypeset.mjs";
import { buildIndex, describeFile, fontFolders, matchFont, withFsType } from "./fonts.mjs";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(root, "tests", "corpus", "out", "edit");
const FIRM = join(OUT, "firm-fonts"); // stand-in for the firm font share
const QPDF = [join(root, "src-tauri", "vendor", "qpdf", "qpdf.exe"), "qpdf"].find(
  (p) => p === "qpdf" || existsSync(p),
);

// Target paragraph per sample, an edit using only letters already in the subset (A),
// and an edit that needs letters the subset does not have (B, also used for C and D).
const EDITS = {
  "engagement-letter": {
    target: "This letter confirms",
    a: (t) =>
      t.replace(
        "federal and state income tax returns",
        "federal, state and local income tax returns",
      ),
    b: (t) => t.replace("for the year ended", "for the quarter (Q4) and year ended"),
  },
  memo: {
    target: "We selected sales invoices",
    a: (t) =>
      t.replace("last ten business days", "last ten business days, plus selected credit notes,"),
    b: (t) => t + " (Journal ref. 2025-Q1-07)",
  },
  "pbc-list": {
    target: "Aged accounts receivable",
    a: (t) => t + " and to the sales register",
    b: (t) => t + " (Q4 only)",
  },
  "irs-header": {
    target: "Go to the agency website",
    a: () => "Go to the agency website for the latest instructions and information.",
    b: () => "Go to the agency website for the latest instructions (Rev. Jan 2025).",
  },
  "two-column": {
    target: "Estimated tax payments",
    a: (t) => t.replace("A missed payment", "A missed or late payment"),
    b: (t) => t + " Zero-balance quarters still need a voucher.",
  },
};
const WINDOWS_FONT = {
  "engagement-letter": "Times New Roman",
  memo: "Calibri",
  "pbc-list": "Arial",
  "irs-header": "Arial",
  "two-column": "Times New Roman",
};

const norm = (s) => s.replace(/\s+/g, " ").trim();

function writePng(path, img, crop) {
  const s = img.scale;
  const x0 = Math.max(0, Math.floor(crop.l * s));
  const x1 = Math.min(img.width, Math.ceil(crop.r * s));
  const y0 = Math.max(0, Math.floor(img.height - crop.t * s));
  const y1 = Math.min(img.height, Math.ceil(img.height - crop.b * s));
  const w = x1 - x0;
  const h = y1 - y0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * img.width + x + x0) * 4;
      const di = y * (w * 3 + 1) + 1 + x * 3;
      raw[di] = img.data[si];
      raw[di + 1] = img.data[si + 1];
      raw[di + 2] = img.data[si + 2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Pixels that changed outside `keep` (page-space rect). */
function changedOutside(a, b, keep) {
  let n = 0;
  const s = a.scale;
  for (let y = 0; y < a.height; y++) {
    const py = (a.height - y) / s;
    for (let x = 0; x < a.width; x++) {
      const px = x / s;
      if (px >= keep.l && px <= keep.r && py >= keep.b && py <= keep.t) continue;
      const i = (y * a.width + x) * 4;
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2]
      )
        n++;
    }
  }
  return n;
}

async function pdfjsText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  await task.destroy();
  return tc.items.map((i) => i.str + (i.hasEOL ? " " : "")).join(" ");
}

/** Fonts on page 1 as written in the file (pdf-lib): name, subtype, embedded size, ToUnicode. */
async function fontReport(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fonts = doc.getPage(0).node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  const out = [];
  for (const [key, ref] of fonts?.entries() ?? []) {
    const f = doc.context.lookup(ref, PDFDict);
    const base = f.lookup(PDFName.of("BaseFont"))?.toString();
    const sub = f.lookup(PDFName.of("Subtype"))?.toString();
    let desc = f.lookup(PDFName.of("FontDescriptor"));
    const desc0 = f.lookup(PDFName.of("DescendantFonts"));
    if (desc0 instanceof PDFArray)
      desc = doc.context.lookup(desc0.get(0), PDFDict).lookup(PDFName.of("FontDescriptor"));
    let file = null;
    for (const k of ["FontFile2", "FontFile3", "FontFile"]) {
      const r = desc?.get(PDFName.of(k));
      if (r instanceof PDFRef) file = doc.context.lookup(r, PDFRawStream);
    }
    out.push({
      key: key.toString(),
      base,
      subtype: sub,
      embeddedBytes: file ? file.contents.length : 0,
      toUnicode: !!f.get(PDFName.of("ToUnicode")),
    });
  }
  return out;
}

/**
 * PDFium names a font it loads after the font itself ("Calibri"); the PDF spec (9.6.4)
 * wants a subset named "ABCDEF+Calibri" so viewers know letters may be missing. The
 * tag here is derived from the embedded bytes, so it is stable for the same subset.
 * Only fonts the edit added are renamed; `original` holds the document's own names.
 */
async function tagSubsets(bytes, original) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let changed = false;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.lookup(PDFName.of("Subtype"))?.toString() !== "/Type0")
      continue;
    const cid = doc.context.lookup(
      obj.lookup(PDFName.of("DescendantFonts"), PDFArray).get(0),
      PDFDict,
    );
    const desc = cid.lookup(PDFName.of("FontDescriptor"), PDFDict);
    const file = desc?.lookup(PDFName.of("FontFile2"));
    const name = obj.lookup(PDFName.of("BaseFont")).asString().slice(1);
    if (!file || /^[A-Z]{6}\+/.test(name) || original.has(`/${name}`)) continue;
    let h = 2166136261;
    for (const b of file.contents) h = Math.imul(h ^ b, 16777619) >>> 0;
    let tag = "";
    for (let i = 0; i < 6; i++) tag += String.fromCharCode(65 + ((h >>> (i * 5)) % 26));
    const tagged = PDFName.of(`${tag}+${name}`);
    obj.set(PDFName.of("BaseFont"), tagged);
    cid.set(PDFName.of("BaseFont"), tagged);
    desc.set(PDFName.of("FontName"), tagged);
    changed = true;
  }
  return changed ? doc.save({ useObjectStreams: false }) : bytes;
}

function qpdfCheck(path) {
  try {
    execFileSync(QPDF, ["--check", path], { stdio: "pipe" });
    return "ok";
  } catch (e) {
    return e.status === 3
      ? "warnings"
      : `failed: ${String(e.stdout).split("\n").slice(0, 3).join(" ")}`;
  }
}

async function runCase(m, bytes, sampleName, caseId, choiceFor, editText, outDir) {
  const d = openDoc(m, bytes);
  const before = renderPage(m, d.doc, 0, 2);
  const page = m.FPDF_LoadPage(d.doc, 0);
  const tp = m.FPDFText_LoadPage(page);
  const { boxes, rules } = groupPage(m, page, tp);
  const box = boxes.find((b) => b.paragraphs[0].text.startsWith(EDITS[sampleName].target));
  const text = editText(box.paragraphs.map((p) => p.text).join("\n"));
  const choice = choiceFor(box);
  const info = await retypeset(m, d.doc, page, tp, box, text, choice);
  m.FPDFText_ClosePage(tp);
  m.FPDF_ClosePage(page);
  const result = { sample: sampleName, case: caseId, text, ...info };
  if (info.refused) {
    d.close();
    const expectedRefusal =
      caseId === "D-restricted" || (caseId === "A-missing" && (info.missing?.length ?? 0) > 0);
    return { ...result, pass: expectedRefusal };
  }
  const original = new Set((await fontReport(bytes)).map((f) => f.base));
  const out = await tagSubsets(saveDoc(m, d.doc), original);
  d.close();
  const file = join(outDir, `${sampleName}.${caseId}.pdf`);
  writeFileSync(file, out);

  // Checks
  const d2 = openDoc(m, out);
  const after = renderPage(m, d2.doc, 0, 2);
  const p2 = m.FPDF_LoadPage(d2.doc, 0);
  const tp2 = m.FPDFText_LoadPage(p2);
  const regroup = groupPage(m, p2, tp2).boxes;
  const found = regroup.find((b) => norm(b.paragraphs.map((p) => p.text).join(" ")) === norm(text));
  m.FPDFText_ClosePage(tp2);
  m.FPDF_ClosePage(p2);
  d2.close();
  const keep = {
    l: box.l - 3,
    r: Math.max(box.r, found?.r ?? 0) + 3,
    t: box.t + 3,
    b: Math.min(box.b, found?.b ?? box.b) - 3,
  };
  const crop = { l: keep.l - 20, r: keep.r + 20, t: keep.t + 20, b: keep.b - 20 };
  writePng(join(outDir, `${sampleName}.before.png`), before, crop);
  writePng(join(outDir, `${sampleName}.${caseId}.png`), after, crop);
  const pdfjs = norm(await pdfjsText(out));
  const tail = norm(text).split(" ").slice(-4).join(" ");
  // A grown box can run into the text below it or across a ruled line (form fields,
  // table cells). The spike does not move other content; it only reports the clash.
  const hits = (r, x) => x.l < r.r && x.r > r.l && x.b < r.t && x.t > r.b;
  const overlaps = found
    ? [
        ...boxes
          .filter((b) => b !== box && hits(found, b))
          .map((b) => `text: ${b.paragraphs[0].text.slice(0, 40)}`),
        ...rules.h
          .filter(
            (h) =>
              hits(found, { l: h.l, r: h.r, b: h.y, t: h.y }) &&
              !hits(box, { l: h.l, r: h.r, b: h.y, t: h.y }),
          )
          .map((h) => `rule at y=${h.y.toFixed(0)}`),
      ]
    : [];
  result.checks = {
    qpdf: qpdfCheck(file),
    searchable: pdfjs.includes(tail),
    regrouped: !!found,
    regroupedLines: found?.lines.length ?? null,
    changedPixelsOutsideBox: changedOutside(before, after, keep),
    fonts: await fontReport(out),
    overlaps,
  };
  const c = result.checks;
  // `pass`: the edit itself worked. `looksRight`: and nothing it grew into was hit.
  result.pass =
    c.qpdf !== "failed" && c.searchable && c.regrouped && c.changedPixelsOutsideBox === 0;
  result.looksRight = result.pass && overlaps.length === 0;
  return result;
}

/** Image object operations: add, move, resize, rotate, replace, delete. */
function imageProbe(m, bytes, outDir) {
  const steps = [];
  const d = openDoc(m, bytes);
  const page = m.FPDF_LoadPage(d.doc, 0);
  const mem = new Mem(m);
  const bitmap = (w, h, rgb) => {
    const bmp = m.FPDFBitmap_Create(w, h, 0);
    m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xff000000 | rgb);
    m.FPDFBitmap_FillRect(bmp, 0, 0, w / 2, h / 2, 0xffffffff);
    return bmp;
  };
  const pagesArr = mem.alloc(4);
  new DataView(mem.heap.buffer).setUint32(pagesArr, page, true);
  const img = m.FPDFPageObj_NewImageObj(d.doc);
  const b1 = bitmap(64, 48, 0x2060a0);
  steps.push({ step: "add (bitmap)", ok: m.FPDFImageObj_SetBitmap(pagesArr, 1, img, b1) });
  m.FPDFImageObj_SetMatrix(img, 120, 0, 0, 90, 400, 120);
  m.FPDFPage_InsertObject(page, img);
  steps.push({ step: "placed", bounds: objBounds(m, img) });
  m.FPDFPageObj_Transform(img, 1, 0, 0, 1, -30, 20);
  steps.push({ step: "move", bounds: objBounds(m, img) });
  m.FPDFImageObj_SetMatrix(img, 180, 0, 0, 135, 370, 140);
  steps.push({ step: "resize", bounds: objBounds(m, img) });
  const a = (15 * Math.PI) / 180;
  m.FPDFImageObj_SetMatrix(
    img,
    180 * Math.cos(a),
    180 * Math.sin(a),
    -135 * Math.sin(a),
    135 * Math.cos(a),
    400,
    140,
  );
  steps.push({ step: "rotate 15", bounds: objBounds(m, img) });
  const b2 = bitmap(64, 48, 0xa03020);
  steps.push({ step: "replace", ok: m.FPDFImageObj_SetBitmap(pagesArr, 1, img, b2) });

  // JPEG kept as JPEG (no re-encode): FPDFImageObj_LoadJpegFileInline with a FILEACCESS.
  const jpeg = readFileSync(join(root, "tests", "corpus", "fixtures", "photo-rgb.jpg"));
  const jpegPtr = mem.bytes(jpeg);
  const getBlock = m.pdfium.addFunction((_param, pos, buf, size) => {
    mem.heap.copyWithin(buf, jpegPtr + pos, jpegPtr + pos + size);
    return 1;
  }, "iiiii");
  const fa = mem.alloc(12);
  const v = new DataView(mem.heap.buffer);
  v.setUint32(fa, jpeg.byteLength, true);
  v.setUint32(fa + 4, getBlock, true);
  v.setUint32(fa + 8, 0, true);
  const jimg = m.FPDFPageObj_NewImageObj(d.doc);
  const jok = m.FPDFImageObj_LoadJpegFileInline(pagesArr, 1, jimg, fa);
  steps.push({ step: "add JPEG (kept compressed)", ok: jok });
  if (jok) {
    m.FPDFImageObj_SetMatrix(jimg, 120, 0, 0, 80, 80, 80);
    m.FPDFPage_InsertObject(page, jimg);
  }
  m.FPDFPage_GenerateContent(page);
  const saved1 = saveDoc(m, d.doc);
  writeFileSync(join(outDir, "images.added.pdf"), saved1);
  steps.push({ step: "saved with images", bytes: saved1.byteLength });
  m.FPDFPage_RemoveObject(page, img);
  m.FPDFPageObj_Destroy(img);
  m.FPDFPage_GenerateContent(page);
  const saved2 = saveDoc(m, d.doc);
  writeFileSync(join(outDir, "images.deleted.pdf"), saved2);
  const count = (b) => {
    const dd = openDoc(m, b);
    const p = m.FPDF_LoadPage(dd.doc, 0);
    let n = 0;
    for (let i = 0; i < m.FPDFPage_CountObjects(p); i++)
      if (m.FPDFPageObj_GetType(m.FPDFPage_GetObject(p, i)) === 3) n++;
    m.FPDF_ClosePage(p);
    dd.close();
    return n;
  };
  steps.push({ step: "delete", imagesBefore: count(saved1), imagesAfter: count(saved2) });
  m.pdfium.removeFunction(getBlock);
  m.FPDFBitmap_Destroy(b1);
  m.FPDFBitmap_Destroy(b2);
  m.FPDF_ClosePage(page);
  mem.free();
  d.close();
  const img2 = openDoc(m, saved1);
  writePng(join(outDir, "images.added.png"), renderPage(m, img2.doc, 0, 1.5), {
    l: 0,
    r: 612,
    t: 792,
    b: 0,
  });
  img2.close();
  return steps;
}

async function main() {
  const sets = [{ name: "committed", dir: join(root, "tests", "corpus", "edit") }];
  if (process.argv.includes("--local"))
    sets.push({ name: "local", dir: join(root, "tests", "corpus", "edit", "local") });

  // Firm folder stand-in: Liberation Sans (full fonts, so a partly embedded Liberation
  // font can be completed), Noto Sans (a "firm custom font" not installed in Windows)
  // and a copy of Noto Sans marked Restricted License (fsType 0x0002).
  mkdirSync(FIRM, { recursive: true });
  const std = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
  const noto = join(root, "node_modules", "@embedpdf", "fonts-latin", "fonts"); // OFL-1.1, already installed
  for (const f of ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"])
    copyFileSync(join(std, f), join(FIRM, f));
  copyFileSync(join(noto, "NotoSans-Regular.ttf"), join(FIRM, "NotoSans-Regular.ttf"));
  writeFileSync(
    join(FIRM, "RestrictedTest-Regular.ttf"),
    withFsType(readFileSync(join(noto, "NotoSans-Regular.ttf")), 0x0002),
  );
  const index = buildIndex(fontFolders({ firm: FIRM }));
  const firmFace = describeFile(join(FIRM, "NotoSans-Regular.ttf"))[0];
  const restricted = describeFile(join(FIRM, "RestrictedTest-Regular.ttf"))[0];

  const m = await loadPdfium();
  const results = {
    generated: "2026-10-23",
    qpdf: QPDF,
    grouping: [],
    edits: [],
    images: null,
    fontIndex: index.length,
  };
  for (const set of sets) {
    const outDir = join(OUT, set.name);
    mkdirSync(outDir, { recursive: true });
    for (const name of Object.keys(EDITS)) {
      const bytes = readFileSync(join(set.dir, `${name}.pdf`));
      const expected = JSON.parse(readFileSync(join(set.dir, `${name}.expected.json`), "utf8"));
      const d = openDoc(m, bytes);
      const page = m.FPDF_LoadPage(d.doc, 0);
      const tp = m.FPDFText_LoadPage(page);
      const { boxes } = groupPage(m, page, tp);
      const score = scoreGrouping(boxes, expected);
      results.grouping.push({
        set: set.name,
        sample: name,
        pass: score.ok,
        expected: expected.length,
        boxes: boxes.length,
        misses: score.results.filter((r) => !r.ok),
      });
      m.FPDFText_ClosePage(tp);
      m.FPDF_ClosePage(page);
      d.close();

      const win = index.find((f) => f.source === "windows" && f.fullName === WINDOWS_FONT[name]);
      const cases = [
        ["A-present", () => ({ kind: "original" }), EDITS[name].a],
        ["A-missing", () => ({ kind: "original" }), EDITS[name].b],
        [
          "B-completed",
          (box) => {
            const r = matchFont(index, box.lines[0].font);
            return {
              kind: "file",
              face: r.exact ?? r.proposals[0],
              label: r.exact ? "exact match" : "proposal",
            };
          },
          EDITS[name].b,
        ],
        [
          "B-proposed",
          (box) => {
            // The original font is not installed anywhere: hide every exact match.
            const needs = EDITS[name].b(box.paragraphs.map((p) => p.text).join("\n"));
            const line = box.lines[0];
            const metrics = { sample: line.text, width: ((line.r - line.l) * 1000) / line.size };
            let pool = index;
            let r = matchFont(pool, line.font, metrics, needs);
            while (r.exact) {
              const fam = r.exact.family;
              pool = pool.filter((f) => f.family !== fam);
              r = matchFont(pool, line.font, metrics, needs);
            }
            const label = r.proposals
              .map((p) => `${p.fullName} (width x${p.widthRatio?.toFixed(2)})`)
              .join(" / ");
            return { kind: "file", face: r.proposals[0], label: `proposal: ${label}` };
          },
          EDITS[name].b,
        ],
        [
          "C-windows",
          () => ({ kind: "file", face: win, label: `Windows: ${win.fullName}` }),
          EDITS[name].b,
        ],
        [
          "D-firm",
          () => ({ kind: "file", face: firmFace, label: `firm: ${firmFace.fullName}` }),
          EDITS[name].b,
        ],
        [
          "D-restricted",
          () => ({ kind: "file", face: restricted, label: "firm: fsType 0x0002 copy" }),
          EDITS[name].b,
        ],
      ];
      for (const [id, choiceFor, edit] of cases) {
        const r = await runCase(m, bytes, name, id, choiceFor, edit, outDir);
        r.set = set.name;
        results.edits.push(r);
        const c = r.checks;
        console.log(
          `${set.name.padEnd(9)} ${name.padEnd(18)} ${id.padEnd(13)} ${r.pass ? (r.looksRight === false ? "PASS*" : "PASS") : "FAIL"}`,
          r.refused
            ? `refused: ${r.refused}`
            : `qpdf=${c.qpdf} search=${c.searchable} regroup=${c.regrouped} px=${c.changedPixelsOutsideBox}${c.overlaps.length ? ` overlaps=${c.overlaps.join("; ")}` : ""}`,
        );
      }
    }
  }
  results.images = imageProbe(
    m,
    readFileSync(join(sets[0].dir, "two-column.pdf")),
    join(OUT, "committed"),
  );
  console.log("images:", JSON.stringify(results.images));
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`results: ${join(OUT, "results.json")}`);
}

await main();
