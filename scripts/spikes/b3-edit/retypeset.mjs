// B3 spike step 2: replace a grouped text box with re-typeset text. The paragraph is
// wrapped to the original box width with the original leading, size, colour and
// alignment, then written as new PDFium text objects (real text, searchable).
//
// Font choices:
//   { kind: "original" }               reuse the PDF's own embedded font object
//   { kind: "file", face, label }      a font file (installed, user or firm folder):
//                                      fsType checked, subset to the needed letters
//                                      with HarfBuzz, loaded as a CID TrueType font

import { readFileSync } from "node:fs";
import { Mem, fillColor, fontData, fontName, objBounds, textObjText } from "./pdfium.mjs";
import { describeFace, measurer, subsetFont } from "./fonts.mjs";

const FPDF_FONT_TRUETYPE = 2;

/**
 * Letters of `text` the PDF's font cannot show. PDF subsets usually have no cmap (Word,
 * pdf-lib), and FPDFText_SetText silently writes .notdef for a letter it cannot map, so
 * each letter is written to a scratch object and read back through the text page.
 */
export function missingLetters(m, doc, page, font, text) {
  const missing = [];
  for (const c of new Set([...text])) {
    if (/\s/.test(c)) continue;
    const obj = m.FPDFPageObj_CreateTextObj(doc, font, 10);
    const mem = new Mem(m);
    m.FPDFText_SetText(obj, mem.wide(c));
    mem.free();
    m.FPDFPage_InsertObject(page, obj);
    const tp = m.FPDFText_LoadPage(page);
    if (textObjText(m, tp, obj) !== c) missing.push(c);
    m.FPDFText_ClosePage(tp);
    m.FPDFPage_RemoveObject(page, obj);
    m.FPDFPageObj_Destroy(obj);
  }
  return missing;
}

/**
 * Advance width of a string in a PDF font, measured through PDFium: with the origin at
 * 0, right(s + R) - right(R) is the advance of s for any reference letter R.
 */
function pdfiumMeasurer(m, doc, font, ref) {
  const right = (s) => {
    const obj = m.FPDFPageObj_CreateTextObj(doc, font, 1000);
    const mem = new Mem(m);
    m.FPDFText_SetText(obj, mem.wide(s));
    mem.free();
    const r = objBounds(m, obj).r;
    m.FPDFPageObj_Destroy(obj);
    return r;
  };
  const base = right(ref);
  const cache = new Map();
  return (s, size) => {
    if (!cache.has(s)) cache.set(s, right(s + ref) - base);
    return (cache.get(s) * size) / 1000;
  };
}

function wrap(words, width, measure) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && measure(next.join(" ")) > width) {
      lines.push(cur);
      cur = [w];
    } else cur = next;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * Re-typesets `box` (from groupPage) with `text`. Returns details for the report;
 * the page content is regenerated, the caller saves the document.
 */
export async function retypeset(m, doc, page, textPage, box, text, choice) {
  const first = box.lines[0].chars[0];
  const sample = first.obj;
  const size = first.size;
  const color = fillColor(m, sample);
  const origFont = m.FPDFTextObj_GetFont(sample);
  const info = { originalFont: fontName(m, origFont), size, choice: choice.label ?? choice.kind };

  let font;
  let measure;
  if (choice.kind === "original") {
    info.embedded = !!fontData(m, origFont);
    info.missing = missingLetters(m, doc, page, origFont, text);
    if (info.missing.length)
      return { ...info, refused: `letters not in the embedded font: ${info.missing.join(" ")}` };
    measure = pdfiumMeasurer(m, doc, origFont, first.ch);
    font = origFont;
  } else {
    const face = choice.face;
    if (!face.embedding.allowed)
      return { ...info, refused: face.embedding.note, fsType: face.fsType };
    if (!face.embedding.subsetAllowed) info.note = "font forbids subsetting: embedded whole";
    const full = new Uint8Array(readFileSync(face.path));
    const program = face.embedding.subsetAllowed ? await subsetFont(full, text, face.index) : full;
    info.fontFile = {
      name: face.fullName,
      source: face.source,
      fsType: face.fsType,
      bytes: full.byteLength,
      embedded: program.byteLength,
    };
    const mem = new Mem(m);
    font = m.FPDFText_LoadFont(
      doc,
      mem.bytes(program),
      program.byteLength,
      FPDF_FONT_TRUETYPE,
      true,
    );
    mem.free();
    if (!font) return { ...info, refused: "PDFium could not load the font" };
    measure = measurer(program);
    info.newFont = fontName(m, font);
  }
  const width = (s) => measure(s, size);

  // Every object in the box must belong only to the box, or we would delete text
  // outside it. (Objects shared with other boxes need splitting: not done in the spike.)
  const objs = box.objects;
  const n = m.FPDFPage_CountObjects(page);
  const pageObjs = new Set(Array.from({ length: n }, (_, i) => m.FPDFPage_GetObject(page, i)));
  info.removedObjects = objs.length;

  const boxWidth = box.r - box.l;
  const leading = box.leading ?? size * 1.2;
  const paragraphs = text.split("\n");
  let y = box.lines[0].y;
  const x0 = first.x;
  const created = [];
  for (const para of paragraphs) {
    const lines = wrap(para.split(/ +/).filter(Boolean), boxWidth, width);
    lines.forEach((words, li) => {
      const last = li === lines.length - 1;
      if (box.justified && !last && words.length > 1) {
        // Justified: one object per word, spaces stretched (PDFium has no Tw setter).
        const natural = words.reduce((a, w) => a + width(w), 0);
        const gap = (boxWidth - natural) / (words.length - 1);
        let x = x0;
        for (const w of words) {
          created.push(place(m, doc, page, font, size, w, x, y, color));
          x += width(w) + gap;
        }
      } else {
        created.push(place(m, doc, page, font, size, words.join(" "), x0, y, color));
      }
      y -= leading;
    });
  }
  for (const o of objs) {
    if (!pageObjs.has(o)) continue;
    m.FPDFPage_RemoveObject(page, o);
    m.FPDFPageObj_Destroy(o);
  }
  if (!m.FPDFPage_GenerateContent(page)) throw new Error("content could not be regenerated");
  info.createdObjects = created.length;
  info.lines = Math.round((box.lines[0].y - y) / leading);
  info.overflow = box.lines[0].y - y - leading > box.lines[0].y - box.lines.at(-1).y + 0.5;
  return info;
}

function place(m, doc, page, font, size, str, x, y, color) {
  const obj = m.FPDFPageObj_CreateTextObj(doc, font, size);
  const mem = new Mem(m);
  const ok = m.FPDFText_SetText(obj, mem.wide(str));
  mem.free();
  if (!ok) throw new Error("FPDFText_SetText failed");
  m.FPDFPageObj_SetFillColor(obj, color.r, color.g, color.b, color.a);
  m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, y);
  m.FPDFPage_InsertObject(page, obj);
  return obj;
}

export { describeFace };
