// Edit PDF (B3): the font index. Faces from the Windows fonts folder, the user's fonts
// folder and the firm font share, described once and cached by path + size + modified
// time, so a rebuild only reads new or changed files. Listing the folders (and keeping
// a local copy of the firm share for offline use) is the host's job; this module only
// needs a listing and a way to read a file. Node-safe.

import { describeFont, embeddingOf, type Embedding, type FaceInfo, FaceMetrics } from "./sfnt";

export type FontSource = "firm" | "user" | "windows";

/** One font file from the host's folder listing. */
export interface FontFileEntry {
  path: string;
  source: FontSource;
  size: number;
  /** Last modified, ms since epoch. */
  mtime: number;
}

export interface FontIndexCache {
  version: 1;
  files: (FontFileEntry & { faces: FaceInfo[] })[];
}

export interface IndexedFace extends FaceInfo {
  path: string;
  source: FontSource;
  embedding: Embedding;
}

const FONT_FILE = /\.(ttf|otf|ttc)$/i;

/**
 * Brings `cache` up to date with `listing`. Unchanged files keep their cached faces;
 * new or changed files are read and described; files no longer listed are dropped.
 * A file that can't be read (locked, removed meanwhile) is skipped this time.
 */
export async function updateFontIndex(
  cache: FontIndexCache | null,
  listing: FontFileEntry[],
  read: (path: string) => Promise<Uint8Array>,
): Promise<FontIndexCache> {
  const old = new Map((cache?.version === 1 ? cache.files : []).map((f) => [f.path, f]));
  const files: FontIndexCache["files"] = [];
  for (const entry of listing) {
    if (!FONT_FILE.test(entry.path)) continue;
    const hit = old.get(entry.path);
    if (hit && hit.size === entry.size && hit.mtime === entry.mtime) {
      files.push({ ...hit, source: entry.source });
      continue;
    }
    try {
      const faces = describeFont(await read(entry.path));
      if (faces.length) files.push({ ...entry, faces });
    } catch {
      // unreadable or locked: skipped; the next rebuild tries again
    }
  }
  return { version: 1, files };
}

/** Every face in the index, firm fonts first, then user, then Windows. */
export function indexedFaces(cache: FontIndexCache): IndexedFace[] {
  const order: Record<FontSource, number> = { firm: 0, user: 1, windows: 2 };
  return cache.files
    .flatMap((f) =>
      f.faces.map((face) => ({
        ...face,
        path: f.path,
        source: f.source,
        embedding: embeddingOf(face.fsType),
      })),
    )
    .sort((a, b) => order[a.source] - order[b.source]);
}

export interface PdfFontName {
  postscript: string;
  family: string;
  bold: boolean;
  italic: boolean;
}

/** "ABCDEF+Calibri-Bold" / "LiberationSans-Bold-6940" / "Arial,BoldItalic" -> parts. */
export function parsePdfFontName(name: string): PdfFontName {
  let n = name.replace(/^[A-Z]{6}\+/, "");
  n = n.replace(/-\d{3,}$/, ""); // pdf-lib style random suffix
  const style = (/[-,](.*)$/.exec(n)?.[1] ?? "").toLowerCase();
  // "TimesNewRomanPS-BoldMT" -> family "TimesNewRomanPS"; "MT"/"PS" are noise.
  const family = n.replace(/[-,].*$/, "").replace(/(PS)?(MT)?$/, "");
  return {
    postscript: n,
    family,
    bold: /bold|black|heavy|semibold|demi/.test(style),
    italic: /italic|oblique/.test(style),
  };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isBold = (f: FaceInfo) => f.weight >= 600;

/**
 * The standard 14 fonts are usually not embedded (tax software output). Each has a
 * metric-compatible twin with the same advance widths, so line breaks stay put.
 */
const METRIC_TWINS: Record<string, string[]> = {
  helvetica: ["Arial", "Liberation Sans"],
  arial: ["Liberation Sans"],
  times: ["Times New Roman", "Liberation Serif"],
  timesroman: ["Times New Roman", "Liberation Serif"],
  timesnewroman: ["Liberation Serif"],
  courier: ["Courier New", "Liberation Mono"],
  couriernew: ["Liberation Mono"],
  calibri: ["Carlito"],
  cambria: ["Caladea"],
};

/** The face of `family` with this weight/slant, or null (then fake bold / oblique). */
export function findStyle(
  faces: IndexedFace[],
  family: string,
  bold: boolean,
  italic: boolean,
): IndexedFace | null {
  const fam = squash(family);
  return (
    faces.find(
      (f) => squash(f.family) === fam && isBold(f) === bold && f.italic === italic && !f.cff,
    ) ?? null
  );
}

export interface Proposal {
  face: IndexedFace;
  /** Width of the original line set in this face / its original width (1 = same). */
  widthRatio: number | null;
}

export interface FontMatch {
  /** The same font (by name), or its metric twin when `twin`. */
  exact: IndexedFace | null;
  twin: boolean;
  /** Closest faces when there is no exact match, best first (up to 3). */
  proposals: Proposal[];
}

export interface MatchOptions {
  /** Letters the edit needs: proposals must have all of them. */
  needs?: string;
  /** A line of the original text and its width at 1000 pt: ranks by how the width compares. */
  sample?: { text: string; width: number };
  /** Metrics of a face (the caller reads and caches the file); null if unreadable. */
  metrics: (face: IndexedFace) => Promise<FaceMetrics | null>;
}

const SERIF = /times|georgia|garamond|cambria|book|serif|roman|palatino|century|minion/i;
const SANS =
  /sans|arial|helvetica|calibri|verdana|tahoma|segoe|gothic|univers|futura|myriad|aptos/i;
const OFFICE =
  /^(times new roman|georgia|cambria|garamond|book antiqua|palatino linotype|arial|calibri|aptos|segoe ui|verdana|tahoma|century gothic|courier new)$/i;
const SYMBOL = /symbol|dings|emoji|math|marlett|mdl2|holomdl|icons|fluent/i;
const guessSerif = (family: string) =>
  SANS.test(family) ? false : SERIF.test(family) ? true : null;

/** Finds the PDF font `pdfName` in the index, its metric twin, or the closest faces. */
export async function matchFont(
  faces: IndexedFace[],
  pdfName: string,
  opts: MatchOptions,
): Promise<FontMatch> {
  const usable = faces.filter((f) => !f.cff);
  const want = parsePdfFontName(pdfName);
  const ps = squash(want.postscript);
  const sameStyle = (f: FaceInfo) => isBold(f) === want.bold && f.italic === want.italic;
  const exact =
    usable.find((f) => squash(f.postscript) === ps) ??
    usable.find((f) => squash(f.family) === squash(want.family) && sameStyle(f));
  if (exact) return { exact, twin: false, proposals: [] };
  for (const twin of METRIC_TWINS[squash(want.family)] ?? []) {
    const face = usable.find((f) => squash(f.family) === squash(twin) && sameStyle(f));
    if (face) return { exact: face, twin: true, proposals: [] };
  }

  const wantSerif = guessSerif(want.family);
  const wantMono = /mono|courier|consol/i.test(want.family);
  const score = (f: IndexedFace) => {
    let s = 0;
    const a = squash(f.family);
    const b = squash(want.family);
    if (a && b && (a.includes(b) || b.includes(a))) s += 60;
    s -= Math.abs(f.weight - (want.bold ? 700 : 400)) / 10;
    if (f.italic !== want.italic) s -= 30;
    if (f.monospace !== wantMono) s -= 40;
    const fSerif = f.serif ?? guessSerif(f.family);
    if (wantSerif !== null && fSerif !== null) s += fSerif === wantSerif ? 30 : -30;
    // Everyday office fonts first among equals: they are on every firm PC.
    if (OFFICE.test(f.family)) s += 10;
    if (SYMBOL.test(f.family)) s -= 200;
    if (!f.embedding.allowed) s -= 1000;
    return s;
  };
  const ranked = [...usable].sort((a, b) => score(b) - score(a));
  // Only faces that have every letter needed (checked on the top few only).
  const candidates: { face: IndexedFace; s: number; widthRatio: number | null }[] = [];
  for (const face of ranked.slice(0, 40)) {
    if (candidates.length === 12) break;
    const m = opts.needs || opts.sample ? await opts.metrics(face) : null;
    if (opts.needs && (!m || m.missing(opts.needs).length)) continue;
    let widthRatio: number | null = null;
    let s = score(face);
    if (opts.sample && m) {
      // Same text at the same width keeps the layout: width is the signal that matters.
      widthRatio = m.width(opts.sample.text, 1000) / opts.sample.width;
      s -= Math.abs(1 - widthRatio) * 300;
    }
    candidates.push({ face, s, widthRatio });
  }
  candidates.sort((a, b) => b.s - a.s);
  return {
    exact: null,
    twin: false,
    proposals: candidates.slice(0, 3).map(({ face, widthRatio }) => ({ face, widthRatio })),
  };
}
