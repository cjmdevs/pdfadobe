// Optimize, fonts: subsets fully embedded TrueType fonts down to the glyphs the document
// draws. Only composite fonts whose codes are glyph ids (/Type0, /Identity-H,
// /CIDFontType2 with an identity /CIDToGIDMap) qualify: the glyphs used can be read
// straight from the content streams, and with retained glyph ids nothing else changes.
//
// A font is left whole when: it is already a subset (ABCDEF+Name), the form's /DR lists
// it (fields are typed in it later), any stream that can select it cannot be scanned
// (inline images), or a stream without its own resources might use it.

import type { Qpdf } from "../pages/qpdf";
import { isRef, type JDict, type JVal, type PdfObjects } from "../redact/objects";
import type { GlyphSubsetter } from "../edit/fonts/subset";
import { streamData, stringBytes, tokenize } from "../edit/spacing";

interface FontCandidate {
  /** The /Type0 font dictionary. */
  ref: string;
  descendant: string;
  descriptor: string;
  file: string;
  baseFont: string;
}

const SUBSET_TAG = /^\/[A-Z]{6}\+/;

function candidates(objs: PdfObjects): Map<string, FontCandidate> {
  const out = new Map<string, FontCandidate>();
  for (const ref of objs.refs()) {
    const d = objs.dict(ref);
    if (!d || d["/Type"] !== "/Font" || d["/Subtype"] !== "/Type0") continue;
    if (d["/Encoding"] !== "/Identity-H") continue;
    const kids = objs.get(d["/DescendantFonts"]);
    const kid = Array.isArray(kids) ? kids[0] : undefined;
    const cid = objs.dict(kid);
    if (!isRef(kid) || !cid || cid["/Subtype"] !== "/CIDFontType2") continue;
    const map = cid["/CIDToGIDMap"];
    if (map !== undefined && map !== "/Identity") continue;
    const descriptor = cid["/FontDescriptor"];
    const file = objs.dict(descriptor)?.["/FontFile2"];
    const baseFont = typeof d["/BaseFont"] === "string" ? d["/BaseFont"] : "";
    if (!isRef(descriptor) || !isRef(file) || SUBSET_TAG.test(baseFont)) continue;
    out.set(ref, { ref, descendant: kid, descriptor, file, baseFont });
  }
  return out;
}

/** Font name -> font ref in a resource dictionary. */
function fontsIn(objs: PdfObjects, res: JVal | undefined): Map<string, string> {
  const fonts = objs.dict(objs.dict(res)?.["/Font"]);
  const out = new Map<string, string>();
  for (const [name, v] of Object.entries(fonts ?? {})) if (isRef(v)) out.set(name, v);
  return out;
}

function inheritedResources(objs: PdfObjects, pageRef: string): JVal | undefined {
  let node: JDict | undefined = objs.dict(pageRef);
  for (let depth = 0; node && depth < 32; depth++) {
    if (node["/Resources"] !== undefined) return node["/Resources"];
    node = objs.dict(node["/Parent"]);
  }
  return undefined;
}

/** Content streams with the fonts they can select. `fonts` null: unknown (no resources). */
function contentStreams(objs: PdfObjects): { ref: string; fonts: Map<string, string> | null }[] {
  const out: { ref: string; fonts: Map<string, string> | null }[] = [];
  for (const pageRef of objs.pages()) {
    const page = objs.dict(pageRef);
    const fonts = fontsIn(objs, inheritedResources(objs, pageRef));
    const c = page?.["/Contents"];
    const list = Array.isArray(objs.get(c)) ? (objs.get(c) as JVal[]) : [c];
    for (const s of list) if (isRef(s)) out.push({ ref: s, fonts });
  }
  // Form XObjects (including annotation appearances) and tiling patterns.
  for (const ref of objs.refs()) {
    const d = objs.dict(ref);
    if (!d || !(d["/Subtype"] === "/Form" || d["/PatternType"] === 1)) continue;
    out.push({ ref, fonts: d["/Resources"] === undefined ? null : fontsIn(objs, d["/Resources"]) });
  }
  return out;
}

/** Glyph ids each candidate font draws; fonts that must stay whole are removed. */
async function glyphsUsed(
  qpdf: Qpdf,
  bytes: Uint8Array,
  objs: PdfObjects,
  fonts: Map<string, FontCandidate>,
): Promise<Map<string, Set<number>>> {
  const used = new Map([...fonts.keys()].map((k) => [k, new Set<number>()]));
  const drop = (ref: string) => used.delete(ref);
  // Fields are filled in later with the form's default fonts.
  const acro = objs.dict(objs.catalog["/AcroForm"]);
  for (const ref of fontsIn(objs, acro?.["/DR"]).values()) drop(ref);
  const streams = contentStreams(objs);
  if (streams.some((s) => s.fonts === null)) return new Map();
  const relevant = streams.filter((s) => [...(s.fonts?.values() ?? [])].some((f) => used.has(f)));
  // Read in groups, so a large document is never decoded all at once.
  for (let i = 0; i < relevant.length && used.size; i += 50) {
    const group = relevant.slice(i, i + 50);
    const data = await streamData(
      qpdf,
      bytes,
      group.map((s) => s.ref),
    );
    for (const s of group) {
      const raw = data.get(s.ref);
      let text = "";
      for (const b of raw ?? []) text += String.fromCharCode(b);
      const toks = raw ? tokenize(text) : null;
      if (!toks) {
        for (const f of s.fonts?.values() ?? []) drop(f);
        continue;
      }
      // The font is part of the graphics state: q saves it, Q restores it.
      const stack: (string | null)[] = [];
      let font: string | null = null;
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (!t || t.kind !== "op") continue;
        if (t.text === "q") stack.push(font);
        else if (t.text === "Q") font = stack.pop() ?? null;
        else if (t.text === "Tf") {
          const name = toks[k - 2];
          font = name?.kind === "name" ? (s.fonts?.get(name.text) ?? null) : null;
        } else if (font && used.has(font) && /^(Tj|TJ|'|")$/.test(t.text)) {
          const arg = toks[k - 1];
          const set = used.get(font);
          if (!arg || !set) continue;
          const strings = arg.kind === "arr" ? (tokenize(arg.text.slice(1, -1)) ?? []) : [arg];
          for (const str of strings) {
            if (str.kind !== "str" && str.kind !== "hex") continue;
            const b = stringBytes(str);
            for (let j = 0; j + 1 < b.length; j += 2) set.add(((b[j] ?? 0) << 8) | (b[j + 1] ?? 0));
          }
        }
      }
    }
  }
  return used;
}

/** A subset tag from the glyph set: six capital letters, the same for the same glyphs. */
function tag(gids: Set<number>): string {
  let h = 2166136261;
  for (const g of [...gids].sort((a, b) => a - b)) h = Math.imul(h ^ g, 16777619) >>> 0;
  let s = "";
  for (let i = 0; i < 6; i++, h = Math.floor(h / 26)) s += String.fromCharCode(65 + (h % 26));
  return s;
}

export interface FontReport {
  subset: number;
}

/** Subsets qualifying fonts in `objs` (written by the caller). */
export async function subsetFonts(
  qpdf: Qpdf,
  objs: PdfObjects,
  bytes: Uint8Array,
  subsetter: GlyphSubsetter,
): Promise<FontReport> {
  const fonts = candidates(objs);
  if (!fonts.size) return { subset: 0 };
  const used = await glyphsUsed(qpdf, bytes, objs, fonts);
  const files = await streamData(
    qpdf,
    bytes,
    [...used.keys()].flatMap((r) => {
      const f = fonts.get(r);
      return f ? [f.file] : [];
    }),
  );
  let subset = 0;
  for (const [ref, gids] of used) {
    const f = fonts.get(ref);
    const program = f && files.get(f.file);
    if (!f || !program) continue;
    let out: Uint8Array;
    try {
      out = subsetter(program, gids);
    } catch {
      continue;
    }
    if (out.length >= program.length * 0.9) continue;
    const fileDict = objs.dict(f.file) ?? {};
    const keep: JDict = {};
    for (const [k, v] of Object.entries(fileDict))
      if (!["/Filter", "/DecodeParms", "/Length", "/Length1"].includes(k)) keep[k] = v;
    objs.setStream(f.file, { ...keep, "/Length1": out.length }, out);
    const name = `/${tag(gids)}+${f.baseFont.slice(1)}`;
    const rename = (r: string, key: string) => {
      const d = objs.dict(r);
      if (d) objs.set(r, { ...d, [key]: name });
    };
    rename(f.ref, "/BaseFont");
    rename(f.descendant, "/BaseFont");
    rename(f.descriptor, "/FontName");
    subset++;
  }
  return { subset };
}
