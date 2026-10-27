// B3 spike: font files. Reads the sfnt tables we need (name, OS/2, head, post, hhea),
// indexes font folders (Windows fonts, user fonts, the firm folder), checks embedding
// permission (OS/2 fsType), proposes matches for a PDF font name, and subsets with
// HarfBuzz (harfbuzzjs, MIT) so only the needed letters are embedded.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as hb from "harfbuzzjs";

const require = createRequire(import.meta.url);

// ---------- sfnt tables ----------

function tables(b, offset = 0) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(offset + 4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const r = offset + 12 + i * 16;
    const tag = String.fromCharCode(b[r], b[r + 1], b[r + 2], b[r + 3]);
    out[tag] = { off: v.getUint32(r + 8), len: v.getUint32(r + 12) };
  }
  return { v, t: out };
}

function names(b, v, t) {
  const out = {};
  if (!t.name) return out;
  const base = t.name.off;
  const count = v.getUint16(base + 2);
  const strings = base + v.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platform = v.getUint16(r);
    const lang = v.getUint16(r + 4);
    const id = v.getUint16(r + 6);
    const len = v.getUint16(r + 8);
    const off = strings + v.getUint16(r + 10);
    // Windows Unicode, US English preferred; Mac Roman as fallback.
    if (platform === 3 && (lang === 0x409 || !(id in out))) {
      let s = "";
      for (let k = 0; k < len; k += 2) s += String.fromCharCode(v.getUint16(off + k));
      out[id] = s;
    } else if (platform === 1 && !(id in out)) {
      out[id] = String.fromCharCode(...b.subarray(off, off + len));
    }
  }
  return out;
}

/** Describes one face. `offset` is the face's table directory (TTC fonts have several). */
export function describeFace(b, offset = 0, index = 0) {
  const { v, t } = tables(b, offset);
  const n = names(b, v, t);
  const os2 = t["OS/2"];
  const face = {
    index,
    family: n[16] ?? n[1] ?? "",
    subfamily: n[17] ?? n[2] ?? "",
    fullName: n[4] ?? "",
    postscript: n[6] ?? "",
    fsType: os2 ? v.getUint16(os2.off + 8) : 0,
    weight: os2 ? v.getUint16(os2.off + 4) : 400,
    italic: os2 ? (v.getUint16(os2.off + 62) & 1) === 1 : false,
    avgWidth: os2 ? v.getInt16(os2.off + 2) : 0,
    xHeight: os2 && v.getUint16(os2.off) >= 2 ? v.getInt16(os2.off + 86) : 0,
    capHeight: os2 && v.getUint16(os2.off) >= 2 ? v.getInt16(os2.off + 88) : 0,
    unitsPerEm: t.head ? v.getUint16(t.head.off + 18) : 1000,
    monospace: t.post ? v.getUint32(t.post.off + 12) !== 0 : false,
    cff: !!t["CFF "],
    // PANOSE serif style: 2-10 serif, 11-15 sans (only meaningful when family type is 2)
    serif: os2 && b[os2.off + 32] === 2 ? b[os2.off + 33] >= 2 && b[os2.off + 33] <= 10 : null,
  };
  face.embedding = embeddingOf(face.fsType);
  return face;
}

/**
 * OS/2 fsType (OpenType spec): bits 0-3 are the usage level. 0x0002 = Restricted
 * License (must not be embedded); 0x0004 = Preview & Print; 0x0008 = Editable.
 * Bit 8 (0x0100) = no subsetting; bit 9 (0x0200) = bitmap embedding only.
 */
export function embeddingOf(fsType) {
  const level = fsType & 0x000f;
  const restricted = level === 0x0002;
  const bitmapOnly = (fsType & 0x0200) !== 0;
  return {
    allowed: !restricted && !bitmapOnly,
    subsetAllowed: (fsType & 0x0100) === 0,
    level: restricted
      ? "restricted"
      : level & 0x0008
        ? "editable"
        : level & 0x0004
          ? "preview-print"
          : "installable",
    note: restricted
      ? "This font's license does not allow embedding."
      : bitmapOnly
        ? "This font allows bitmap embedding only."
        : level & 0x0004 && !(level & 0x0008)
          ? "Embedded for viewing and printing; other people may not be able to edit text in it."
          : null,
  };
}

export function describeFile(path) {
  const b = new Uint8Array(readFileSync(path));
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === "ttcf") {
    const v = new DataView(b.buffer);
    const n = v.getUint32(8);
    return Array.from({ length: n }, (_, i) => ({
      ...describeFace(b, v.getUint32(12 + i * 4), i),
      path,
    }));
  }
  if (tag === "\0\x01\0\0" || tag === "OTTO" || tag === "true")
    return [{ ...describeFace(b), path }];
  return [];
}

// ---------- font index ----------

export function fontFolders({ firm } = {}) {
  const win = process.env.WINDIR ? join(process.env.WINDIR, "Fonts") : "C:\\Windows\\Fonts";
  const user = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts")
    : null;
  return [
    ...(firm ? [{ source: "firm", dir: firm }] : []),
    ...(user ? [{ source: "user", dir: user }] : []),
    { source: "windows", dir: win },
  ];
}

export function buildIndex(folders) {
  const faces = [];
  for (const { source, dir } of folders) {
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue; // folder missing or share offline: skip it, the others still work
    }
    for (const f of files) {
      if (!/\.(ttf|otf|ttc)$/i.test(f)) continue;
      try {
        for (const face of describeFile(join(dir, f))) faces.push({ ...face, source });
      } catch {
        // unreadable or locked font file: skip
      }
    }
  }
  return faces;
}

// ---------- matching ----------

/** "ABCDEF+Calibri-Bold" / "LiberationSans-Bold-6940" / "Arial,BoldItalic" -> parts. */
export function parsePdfFontName(name) {
  let n = name.replace(/^[A-Z]{6}\+/, "");
  n = n.replace(/-\d{3,}$/, ""); // pdf-lib style random suffix
  const style = (n.match(/[-,](.*)$/)?.[1] ?? "").toLowerCase();
  const family = n.replace(/[-,].*$/, "");
  return {
    postscript: n,
    family,
    bold: /bold|black|heavy|semibold|demi/.test(style),
    italic: /italic|oblique/.test(style),
  };
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Exact match by PostScript name (or family + style), otherwise ranked proposals.
 * `metrics` (from the embedded subset, when there is one) refines the ranking.
 */
export function matchFont(index, pdfName, metrics = null, needs = null) {
  const want = parsePdfFontName(pdfName);
  const ps = squash(want.postscript);
  const exact =
    index.find((f) => squash(f.postscript) === ps) ??
    index.find(
      (f) =>
        squash(f.family) === squash(want.family) &&
        f.weight >= 600 === want.bold &&
        f.italic === want.italic,
    );
  if (exact) return { exact, proposals: [] };
  // The standard 14 fonts are usually not embedded (tax software output). A metric-
  // compatible twin has the same advance widths, so every line break stays put.
  for (const twin of METRIC_TWINS[squash(want.family)] ?? []) {
    const face = index.find(
      (f) =>
        squash(f.family) === squash(twin) &&
        f.weight >= 600 === want.bold &&
        f.italic === want.italic,
    );
    if (face) return { exact: face, twin: true, proposals: [] };
  }
  const wantSerif = metrics?.serif ?? guessSerif(want.family);
  const score = (f) => {
    let s = 0;
    const a = squash(f.family);
    const b = squash(want.family);
    if (a && b && (a.includes(b) || b.includes(a))) s += 60;
    s -= Math.abs(f.weight - (want.bold ? 700 : 400)) / 10;
    if (f.italic !== want.italic) s -= 30;
    if (f.monospace !== /mono|courier|consol/i.test(want.family)) s -= 40;
    const fSerif = f.serif ?? guessSerif(f.family);
    if (wantSerif !== null && fSerif !== null) s += fSerif === wantSerif ? 30 : -30;
    if (metrics) {
      const rel = (x, y) => (y ? Math.abs(x / f.unitsPerEm - y) * 100 : 0);
      s -=
        rel(f.avgWidth, metrics.avgWidth) +
        rel(f.xHeight, metrics.xHeight) +
        rel(f.capHeight, metrics.capHeight);
    }
    // Everyday office fonts first among equals: they are on every firm PC.
    if (OFFICE.test(f.family)) s += 10;
    if (/symbol|dings|emoji|math|marlett|mdl2|holomdl|icons|fluent/i.test(f.family)) s -= 200;
    if (!f.embedding.allowed) s -= 1000;
    return s;
  };
  const ranked = [...index].sort((a, b) => score(b) - score(a));
  // Only propose faces that have every letter needed (checked on the top few only).
  const candidates = [];
  for (const f of ranked.slice(0, 40)) {
    if (candidates.length === 12) break;
    if (!needs || covers(f, needs)) candidates.push({ f, s: score(f) });
  }
  // `metrics.sample` / `metrics.width`: a line of the original text and its width at
  // 1000 pt. A replacement that sets the same text at the same width keeps the layout.
  if (metrics?.sample) {
    for (const c of candidates) {
      const w = measurer(readFileSync(c.f.path), c.f.index)(metrics.sample, 1000);
      c.widthRatio = w / metrics.width;
      c.s -= Math.abs(1 - c.widthRatio) * 300;
    }
    candidates.sort((a, b) => b.s - a.s);
  }
  return {
    exact: null,
    proposals: candidates.slice(0, 3).map((c) => ({ ...c.f, widthRatio: c.widthRatio ?? null })),
  };
}

const METRIC_TWINS = {
  helvetica: ["Arial", "Liberation Sans"],
  times: ["Times New Roman", "Liberation Serif"],
  timesroman: ["Times New Roman", "Liberation Serif"],
  courier: ["Courier New", "Liberation Mono"],
};
const SERIF = /times|georgia|garamond|cambria|book|serif|roman|palatino|century|minion/i;
const SANS =
  /sans|arial|helvetica|calibri|verdana|tahoma|segoe|gothic|univers|futura|myriad|aptos/i;
const OFFICE =
  /^(times new roman|georgia|cambria|garamond|book antiqua|palatino linotype|arial|calibri|aptos|segoe ui|verdana|tahoma|century gothic|courier new)$/i;
const guessSerif = (family) => (SANS.test(family) ? false : SERIF.test(family) ? true : null);

const coverageCache = new Map();
export function covers(face, text) {
  const key = face.path + "#" + face.index;
  let set = coverageCache.get(key);
  if (!set) {
    const f = new hb.Face(new hb.Blob(readFileSync(face.path)), face.index);
    set = new Set(f.collectUnicodes());
    coverageCache.set(key, set);
  }
  return [...text].every((c) => /\s/.test(c) || set.has(c.codePointAt(0)));
}

/** Width of a string at a size, from the font's own advances (no kerning, like PDFium writes it). */
export function measurer(bytes, index = 0) {
  const font = new hb.Font(new hb.Face(new hb.Blob(bytes), index));
  const upem = font.face.upem;
  const noKern = [new hb.Feature("kern", 0), new hb.Feature("liga", 0)];
  return (text, size) => {
    const buf = new hb.Buffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(font, buf, noKern);
    return (buf.getGlyphPositions().reduce((a, p) => a + p.xAdvance, 0) * size) / upem;
  };
}

// ---------- subsetting (HarfBuzz) ----------

let hbSubset = null;
async function harfbuzzSubset() {
  if (hbSubset) return hbSubset;
  const wasm = readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
  const { instance } = await WebAssembly.instantiate(wasm);
  hbSubset = instance.exports;
  return hbSubset;
}

/** Subsets face `index` of `bytes` to the code points in `text` (plus space). */
export async function subsetFont(bytes, text, index = 0) {
  const x = await harfbuzzSubset();
  const heap = () => new Uint8Array(x.memory.buffer);
  const p = x.malloc(bytes.byteLength);
  heap().set(bytes, p);
  const blob = x.hb_blob_create(p, bytes.byteLength, 2 /* HB_MEMORY_MODE_WRITABLE */, 0, 0);
  const face = x.hb_face_create(blob, index);
  x.hb_blob_destroy(blob);
  const input = x.hb_subset_input_create_or_fail();
  const unicodes = x.hb_subset_input_unicode_set(input);
  for (const cp of new Set([...text, " "].map((c) => c.codePointAt(0)))) x.hb_set_add(unicodes, cp);
  const sub = x.hb_subset_or_fail(face, input);
  x.hb_subset_input_destroy(input);
  if (!sub) {
    x.hb_face_destroy(face);
    x.free(p);
    throw new Error("HarfBuzz could not subset the font");
  }
  const outBlob = x.hb_face_reference_blob(sub);
  const len = x.hb_blob_get_length(outBlob);
  const data = x.hb_blob_get_data(outBlob, 0);
  const out = heap().slice(data, data + len);
  x.hb_blob_destroy(outBlob);
  x.hb_face_destroy(sub);
  x.hb_face_destroy(face);
  x.free(p);
  return out;
}

/** Copy of a font with a different fsType (for the "can't embed" test only; never saved). */
export function withFsType(bytes, fsType) {
  const b = new Uint8Array(bytes);
  const { v, t } = tables(b);
  v.setUint16(t["OS/2"].off + 8, fsType);
  return b;
}
