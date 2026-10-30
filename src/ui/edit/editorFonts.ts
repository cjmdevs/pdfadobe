// Edit PDF (B3): the in-place editor shows text in the real font, not a look-alike.
// Each font the editor needs is loaded once per session as a browser FontFace from
// its file:
//   a font picked from a file        that file
//   a PDF font ("ABCDEF+Calibri")    the installed (Windows / firm) face with the same
//                                    name, or its metric twin (Helvetica -> Arial)
// A PDF's own subset fonts can't be loaded by the browser (no cmap or name tables), so
// the same-named installed font stands in for them; that is the same design in almost
// every case. Collections (.ttc) are skipped: the browser can't pick a face in one.
// Without a file the editor falls back to `cssFont` (a CSS family list).

import type { PlainFont } from "../../engine/edit";
import { matchFont, type IndexedFace } from "../../engine/edit/fonts";
import type { FontIndex } from "../../app/fontIndex";
import { cssFont } from "./cssFont";

interface Loaded {
  /** CSS family the FontFace is registered under. */
  family: string;
  /** The face is itself bold / italic (no synthetic style on top). */
  bold: boolean;
  italic: boolean;
}

/** Key -> loaded face, null when there is none, or the load in progress. */
const faces = new Map<string, Loaded | null>();
const loading = new Map<string, Promise<void>>();
let next = 0;

const keyOf = (fontName: string, font?: PlainFont) =>
  font?.kind === "file" ? `file:${font.face.path}#${font.face.index}` : `pdf:${fontName}`;

/** CSS for text in `fontName` (and its chosen font), bold / italic as asked. */
export function fontCss(
  fontName: string,
  font: PlainFont | undefined,
  bold: boolean,
  italic: boolean,
): { family: string; weight: number; style: "normal" | "italic" } {
  const hit = faces.get(keyOf(fontName, font));
  if (hit) {
    const fallback = cssFont(fontName).family;
    return {
      family: `"${hit.family}", ${fallback}`,
      // The face's own weight and slant; asked-for bold / italic it lacks is simulated,
      // as the PDF does.
      weight: bold && !hit.bold ? 700 : 400,
      style: italic && !hit.italic ? "italic" : "normal",
    };
  }
  const f = cssFont(fontName);
  return {
    family: f.family,
    weight: bold ? 700 : f.weight,
    style: italic ? "italic" : f.style,
  };
}

/**
 * Loads the fonts for these (font name, chosen font) pairs. Resolves true when any new
 * face was loaded (the editor then draws again).
 */
export async function loadFonts(
  wanted: { fontName: string; font?: PlainFont | undefined }[],
  index: FontIndex | null,
): Promise<boolean> {
  const jobs = wanted.map(({ fontName, font }) => {
    const key = keyOf(fontName, font);
    if (faces.has(key)) return Promise.resolve(false);
    let job = loading.get(key);
    if (!job) {
      job = loadOne(key, fontName, font, index).catch(() => {
        faces.set(key, null);
      });
      loading.set(key, job);
    }
    return job.then(() => faces.get(key) != null);
  });
  return (await Promise.all(jobs)).some(Boolean);
}

async function loadOne(
  key: string,
  fontName: string,
  font: PlainFont | undefined,
  index: FontIndex | null,
): Promise<void> {
  let face: IndexedFace | null = null;
  let bytes: Uint8Array | null = null;
  if (font?.kind === "file") {
    face = font.face;
    bytes = font.bytes;
  } else if (index) {
    const name = font?.kind === "standard" ? font.name : fontName;
    face = (await matchFont(index.faces, name, { metrics: index.metrics })).exact;
    if (face) bytes = await index.bytes(face);
  }
  if (!face || !bytes || /\.ttc$/i.test(face.path)) {
    faces.set(key, null);
    return;
  }
  const family = `pwb-font-${next++}`;
  const ff = new FontFace(family, bytes.slice().buffer as ArrayBuffer);
  await ff.load();
  document.fonts.add(ff);
  faces.set(key, { family, bold: face.weight >= 600, italic: face.italic });
}
