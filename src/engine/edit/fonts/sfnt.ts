// Edit PDF (B3): the parts of a TrueType/OpenType file the editor needs, read directly:
// names, OS/2 (weight, fsType, metrics), head, post, hhea/hmtx advances and the cmap.
// Coverage and widths come from here, so no shaping engine is needed (PDFium writes
// text unshaped and unkerned, so plain advances are exactly what it draws).

export interface SfntTable {
  off: number;
  len: number;
}

/** Table directory of the face whose directory starts at `offset` (TTC: one per face). */
export function tableDirectory(b: Uint8Array, offset = 0): Map<string, SfntTable> {
  const v = view(b);
  const n = v.getUint16(offset + 4);
  const out = new Map<string, SfntTable>();
  for (let i = 0; i < n; i++) {
    const r = offset + 12 + i * 16;
    const tag = tagAt(b, r);
    const off = v.getUint32(r + 8);
    const len = v.getUint32(r + 12);
    if (off + len <= b.byteLength) out.set(tag, { off, len });
  }
  return out;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const tagAt = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
const codePoint = (c: string) => c.codePointAt(0) ?? 0;

/** Offsets of each face's table directory: one for TTF/OTF, several for a TTC. */
export function faceOffsets(b: Uint8Array): number[] {
  if (b.byteLength < 12) return [];
  const tag = tagAt(b, 0);
  const v = view(b);
  if (tag === "ttcf") {
    const n = v.getUint32(8);
    return Array.from({ length: n }, (_, i) => v.getUint32(12 + i * 4));
  }
  if (tag === "\0\x01\0\0" || tag === "OTTO" || tag === "true") return [0];
  return [];
}

/** Name table strings by name ID (Windows Unicode, US English preferred; Mac Roman fallback). */
export function readNames(b: Uint8Array, t: Map<string, SfntTable>): Map<number, string> {
  const out = new Map<number, string>();
  const name = t.get("name");
  if (!name) return out;
  const v = view(b);
  const base = name.off;
  const count = v.getUint16(base + 2);
  const strings = base + v.getUint16(base + 4);
  const english = new Set<number>();
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platform = v.getUint16(r);
    const lang = v.getUint16(r + 4);
    const id = v.getUint16(r + 6);
    const len = v.getUint16(r + 8);
    const off = strings + v.getUint16(r + 10);
    if (off + len > b.byteLength) continue;
    if (platform === 3 && !english.has(id) && (lang === 0x409 || !out.has(id))) {
      let s = "";
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(off + k));
      out.set(id, s);
      if (lang === 0x409) english.add(id);
    } else if (platform === 1 && !out.has(id)) {
      out.set(id, String.fromCharCode(...b.subarray(off, off + len)));
    }
  }
  return out;
}

export interface Embedding {
  /** May be embedded at all (not Restricted License, not bitmap-only). */
  allowed: boolean;
  /** Subsetting allowed (fsType bit 8 clear). */
  subsetAllowed: boolean;
  level: "installable" | "editable" | "preview-print" | "restricted";
  /** What to tell the user, or null when there is nothing to say. */
  note: string | null;
}

/**
 * OS/2 fsType (OpenType spec): bits 0-3 are the usage level. 0x0002 = Restricted
 * License (must not be embedded); 0x0004 = Preview & Print; 0x0008 = Editable.
 * Bit 8 (0x0100) = no subsetting; bit 9 (0x0200) = bitmap embedding only.
 */
export function embeddingOf(fsType: number): Embedding {
  const level = fsType & 0x000f;
  const restricted = level === 0x0002;
  const bitmapOnly = (fsType & 0x0200) !== 0;
  const previewOnly = (level & 0x0004) !== 0 && (level & 0x0008) === 0;
  return {
    allowed: !restricted && !bitmapOnly,
    subsetAllowed: (fsType & 0x0100) === 0,
    level: restricted
      ? "restricted"
      : level & 0x0008
        ? "editable"
        : previewOnly
          ? "preview-print"
          : "installable",
    note: restricted
      ? "This font's license does not allow embedding."
      : bitmapOnly
        ? "This font's license allows bitmap embedding only, so it can't be used for editable text."
        : previewOnly
          ? "Embedded for viewing and printing only; other people may not be able to edit text in it."
          : null,
  };
}

/** One face of a font file, as the font index stores it. */
export interface FaceInfo {
  /** Face number inside a TTC (0 otherwise). */
  index: number;
  family: string;
  subfamily: string;
  fullName: string;
  postscript: string;
  /** OS/2 usWeightClass (400 regular, 700 bold). */
  weight: number;
  italic: boolean;
  fsType: number;
  unitsPerEm: number;
  /** OS/2 metrics in font units (0 when absent). */
  avgWidth: number;
  xHeight: number;
  capHeight: number;
  monospace: boolean;
  /** PANOSE says serif (true) or sans (false); null when it doesn't say. */
  serif: boolean | null;
  /** CFF outlines (OpenType "OTTO"); PDFium can only embed TrueType outlines. */
  cff: boolean;
  /** post table underline, in font units (position is negative below the baseline). */
  underlinePosition: number;
  underlineThickness: number;
}

/** Every face in a font file. Unreadable files give []. */
export function describeFont(b: Uint8Array): FaceInfo[] {
  try {
    return faceOffsets(b).map((offset, index) => describeFace(b, offset, index));
  } catch {
    return [];
  }
}

function describeFace(b: Uint8Array, offset: number, index: number): FaceInfo {
  const t = tableDirectory(b, offset);
  const v = view(b);
  const n = readNames(b, t);
  const os2 = t.get("OS/2");
  const head = t.get("head");
  const post = t.get("post");
  const os2v = os2 ? v.getUint16(os2.off) : 0;
  const panoseFamily = os2 ? b[os2.off + 32] : 0;
  const panoseSerif = os2 ? (b[os2.off + 33] ?? 0) : 0;
  const unitsPerEm = head ? v.getUint16(head.off + 18) : 1000;
  return {
    index,
    family: n.get(16) ?? n.get(1) ?? "",
    subfamily: n.get(17) ?? n.get(2) ?? "",
    fullName: n.get(4) ?? "",
    postscript: n.get(6) ?? "",
    weight: os2 ? v.getUint16(os2.off + 4) : 400,
    italic: os2 ? (v.getUint16(os2.off + 62) & 1) === 1 : /italic|oblique/i.test(n.get(2) ?? ""),
    fsType: os2 ? v.getUint16(os2.off + 8) : 0,
    unitsPerEm,
    avgWidth: os2 ? v.getInt16(os2.off + 2) : 0,
    xHeight: os2 && os2v >= 2 ? v.getInt16(os2.off + 86) : 0,
    capHeight: os2 && os2v >= 2 ? v.getInt16(os2.off + 88) : 0,
    monospace: post ? v.getUint32(post.off + 12) !== 0 : false,
    // PANOSE serif style: 2-10 serif, 11-15 sans (only meaningful for family type 2).
    serif: panoseFamily === 2 ? panoseSerif >= 2 && panoseSerif <= 10 : null,
    cff: t.has("CFF ") || t.has("CFF2"),
    underlinePosition: post ? v.getInt16(post.off + 8) : -Math.round(unitsPerEm * 0.1),
    underlineThickness: post ? v.getInt16(post.off + 10) : Math.round(unitsPerEm * 0.05),
  };
}

/** Code point -> glyph id and glyph advances of one face. */
export class FaceMetrics {
  readonly unitsPerEm: number;
  private readonly cmap = new Map<number, number>();
  private readonly advances: Uint16Array;

  constructor(b: Uint8Array, index = 0) {
    const offset = faceOffsets(b)[index];
    if (offset === undefined) throw new Error("not a TrueType/OpenType font");
    const t = tableDirectory(b, offset);
    const v = view(b);
    const head = t.get("head");
    const hhea = t.get("hhea");
    const hmtx = t.get("hmtx");
    const maxp = t.get("maxp");
    if (!head || !hhea || !hmtx || !maxp) throw new Error("font has no metrics tables");
    this.unitsPerEm = v.getUint16(head.off + 18);
    const numGlyphs = v.getUint16(maxp.off + 4);
    const numH = Math.min(v.getUint16(hhea.off + 34), numGlyphs);
    this.advances = new Uint16Array(numGlyphs);
    let last = 0;
    for (let g = 0; g < numGlyphs; g++) {
      if (g < numH) last = v.getUint16(hmtx.off + g * 4);
      this.advances[g] = last;
    }
    readCmap(b, t.get("cmap"), this.cmap);
  }

  glyph(cp: number): number {
    return this.cmap.get(cp) ?? 0;
  }

  /** Letters of `text` the face has no glyph for (whitespace ignored), in order, once each. */
  missing(text: string): string[] {
    const out = new Set<string>();
    for (const c of text) if (!/\s/.test(c) && !this.glyph(codePoint(c))) out.add(c);
    return [...out];
  }

  /** Advance of `text` at `size` points: plain advances, no kerning (as PDFium writes it). */
  width(text: string, size: number): number {
    let u = 0;
    for (const c of text) u += this.advances[this.glyph(codePoint(c))] ?? 0;
    return (u * size) / this.unitsPerEm;
  }
}

/** Fills `out` from the best Unicode subtable: format 12 (full Unicode) or 4 (BMP). */
function readCmap(b: Uint8Array, cmap: SfntTable | undefined, out: Map<number, number>): void {
  if (!cmap) return;
  const v = view(b);
  const n = v.getUint16(cmap.off + 2);
  let best = -1;
  let bestRank = -1;
  for (let i = 0; i < n; i++) {
    const r = cmap.off + 4 + i * 8;
    const platform = v.getUint16(r);
    const encoding = v.getUint16(r + 2);
    const sub = cmap.off + v.getUint32(r + 4);
    const format = v.getUint16(sub);
    const rank =
      platform === 3 && encoding === 10 && format === 12
        ? 4
        : platform === 0 && format === 12
          ? 3
          : platform === 3 && encoding === 1 && format === 4
            ? 2
            : platform === 0 && format === 4
              ? 1
              : platform === 3 && encoding === 0 && format === 4
                ? 0 // symbol fonts: F000-F0FF
                : -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = sub;
    }
  }
  if (best < 0) return;
  const format = v.getUint16(best);
  if (format === 12) {
    const groups = v.getUint32(best + 12);
    for (let i = 0; i < groups; i++) {
      const r = best + 16 + i * 12;
      const start = v.getUint32(r);
      const end = Math.min(v.getUint32(r + 4), start + 0x10000);
      const gid = v.getUint32(r + 8);
      for (let cp = start; cp <= end; cp++) out.set(cp, gid + cp - start);
    }
  } else if (format === 4) {
    const segX2 = v.getUint16(best + 6);
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = v.getUint16(ends + s);
      const start = v.getUint16(starts + s);
      const delta = v.getInt16(deltas + s);
      const rangeOff = v.getUint16(ranges + s);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let gid: number;
        if (rangeOff === 0) gid = (cp + delta) & 0xffff;
        else {
          const p = ranges + s + rangeOff + (cp - start) * 2;
          gid = p + 1 < b.byteLength ? v.getUint16(p) : 0;
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) out.set(cp, gid);
      }
    }
  }
}

/**
 * Copy of a single-face font with its name table replaced, so PDFium names the font
 * after `postscript` (it takes the PDF /BaseFont from name ID 6). Used to give an
 * embedded subset its "ABCDEF+Name" tag (PDF 32000-1, 9.6.4).
 */
export function withPostScriptName(b: Uint8Array, postscript: string, family: string): Uint8Array {
  const t = tableDirectory(b, 0);
  const records: [number, string][] = [
    [1, family],
    [2, "Regular"],
    [4, family],
    [6, postscript],
  ];
  // name table, format 0, Windows Unicode BMP, US English, UTF-16BE strings.
  const strings = records.map(([, s]) => s);
  const strBytes = strings.reduce((a, s) => a + s.length * 2, 0);
  const name = new Uint8Array(6 + records.length * 12 + strBytes);
  const nv = view(name);
  nv.setUint16(2, records.length);
  nv.setUint16(4, 6 + records.length * 12);
  let off = 0;
  records.forEach(([id, s], i) => {
    const r = 6 + i * 12;
    nv.setUint16(r, 3);
    nv.setUint16(r + 2, 1);
    nv.setUint16(r + 4, 0x409);
    nv.setUint16(r + 6, id);
    nv.setUint16(r + 8, s.length * 2);
    nv.setUint16(r + 10, off);
    for (let k = 0; k < s.length; k++)
      nv.setUint16(6 + records.length * 12 + off + k * 2, s.charCodeAt(k));
    off += s.length * 2;
  });
  const tables = new Map(
    [...t].map(([tag, x]) => [tag, tag === "name" ? name : b.subarray(x.off, x.off + x.len)]),
  );
  if (!tables.has("name")) tables.set("name", name);
  return buildSfnt(b.subarray(0, 4), tables);
}

/** Writes an sfnt from tables (sorted tags, 4-byte aligned, checksums, head adjustment). */
function buildSfnt(version: Uint8Array, tables: Map<string, Uint8Array>): Uint8Array {
  const sorted = [...tables].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  let size = 12 + n * 16;
  for (const [, data] of sorted) size += (data.byteLength + 3) & ~3;
  const out = new Uint8Array(size);
  const v = view(out);
  out.set(version, 0);
  const pow = 2 ** Math.floor(Math.log2(n));
  v.setUint16(4, n);
  v.setUint16(6, pow * 16);
  v.setUint16(8, Math.log2(pow));
  v.setUint16(10, n * 16 - pow * 16);
  let off = 12 + n * 16;
  let headOff = -1;
  sorted.forEach(([tag, data], i) => {
    out.set(data, off);
    if (tag === "head") {
      headOff = off;
      v.setUint32(off + 8, 0); // checkSumAdjustment is computed below
    }
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = tag.charCodeAt(k);
    v.setUint32(r + 4, checksum(out, off, data.byteLength));
    v.setUint32(r + 8, off);
    v.setUint32(r + 12, data.byteLength);
    off += (data.byteLength + 3) & ~3;
  });
  if (headOff >= 0) v.setUint32(headOff + 8, (0xb1b0afba - checksum(out, 0, size)) >>> 0);
  return out;
}

function checksum(b: Uint8Array, off: number, len: number): number {
  const v = view(b);
  let sum = 0;
  const end = off + ((len + 3) & ~3);
  for (let p = off; p < end; p += 4)
    sum = (sum + (p + 4 <= b.byteLength ? v.getUint32(p) : 0)) >>> 0;
  return sum;
}
