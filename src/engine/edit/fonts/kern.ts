// Edit PDF (B3 stage 2): pair kerning for new text. PDFium writes text unkerned, so
// the kerning is worked out here and written as TJ adjustments (`spacing.ts`).
//
//   fonts from files   HarfBuzz's shaper (harfbuzz.wasm from harfbuzzjs, MIT): each
//                      letter's advance shaped with the "kern" feature on and off;
//                      ligatures and other substitutions stay off, so letters and
//                      glyphs line up one to one
//   standard 14        their AFM kerning pairs (@pdf-lib/standard-fonts, MIT)
//   the PDF's own      none: subset fonts keep no kerning data
//
// Results are fractions of the size, after each letter of the text (0: none).

import { Encodings, Font, FontNames, type FontNames as FontName } from "@pdf-lib/standard-fonts";

/** Kerning for one face of a font file: a function of the text. */
export type Kerner = (font: Uint8Array, faceIndex: number) => (text: string) => number[];

/** Faces kept loaded in HarfBuzz (the fonts of the last few edits). */
const KEEP = 4;

/** A cheap key for font bytes: length and a sample of them. */
function keyOf(font: Uint8Array, faceIndex: number): string {
  let h = 2166136261;
  for (let i = 0; i < font.length; i += 997) h = Math.imul(h ^ (font[i] ?? 0), 16777619) >>> 0;
  return `${font.length}:${h}:${faceIndex}`;
}

interface ShapeExports {
  memory: { buffer: ArrayBuffer; grow(pages: number): number };
  __wasm_call_ctors(): void;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_get_upem(face: number): number;
  hb_font_create(face: number): number;
  hb_font_destroy(font: number): void;
  hb_buffer_create(): number;
  hb_buffer_destroy(buf: number): void;
  hb_buffer_add_utf16(buf: number, text: number, len: number, offset: number, item: number): void;
  hb_buffer_guess_segment_properties(buf: number): void;
  hb_buffer_get_length(buf: number): number;
  hb_buffer_get_glyph_positions(buf: number, lenOut: number): number;
  hb_feature_from_string(str: number, len: number, feature: number): number;
  hb_shape(font: number, buf: number, features: number, count: number): void;
}

const HB_MEMORY_MODE_READONLY = 1;
/** Substitutions off (one glyph per letter); kerning on or off. */
const FEATURES = ["-liga", "-clig", "-dlig", "-calt", "-rlig", "-ccmp", "-locl"];

interface WasmApi {
  compile(bytes: ArrayBuffer): Promise<object>;
  instantiate(module: object, imports: object): Promise<{ exports: object }>;
}
const wasmApi = () => (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

/** Boots harfbuzz.wasm (an Emscripten build: its few runtime imports are stubbed). */
export async function createKerner(wasm: Uint8Array | ArrayBuffer): Promise<Kerner> {
  const bytes = wasm instanceof Uint8Array ? (wasm.slice().buffer as ArrayBuffer) : wasm;
  let x: ShapeExports | null = null;
  const fail = () => {
    throw new Error("HarfBuzz stopped");
  };
  const imports = {
    env: {
      _emscripten_runtime_keepalive_clear: () => undefined,
      _abort_js: fail,
      _setitimer_js: () => 0,
      emscripten_resize_heap: (want: number) => {
        if (!x) return 0;
        const have = x.memory.buffer.byteLength;
        return x.memory.grow(Math.ceil((want - have) / 65536)) >= 0 ? 1 : 0;
      },
    },
    wasi_snapshot_preview1: { proc_exit: fail },
  };
  const wa = wasmApi();
  const instance = await wa.instantiate(await wa.compile(bytes), imports);
  x = instance.exports as unknown as ShapeExports;
  x.__wasm_call_ctors();
  const hb = x;

  /** hb_feature_t list (16 bytes each), kerning on or off. */
  const features = (kern: boolean) => {
    const list = [...FEATURES, kern ? "+kern" : "-kern"];
    const p = hb.malloc(16 * list.length);
    list.forEach((f, i) => {
      const s = hb.malloc(f.length + 1);
      new Uint8Array(hb.memory.buffer).set(new TextEncoder().encode(f), s);
      hb.hb_feature_from_string(s, f.length, p + 16 * i);
      hb.free(s);
    });
    return { p, n: list.length };
  };
  const on = features(true);
  const off = features(false);

  interface Loaded {
    fp: number;
    blob: number;
    face: number;
    font: number;
    upem: number;
  }
  const loaded = new Map<string, Loaded>();
  const load = (bytes: Uint8Array, faceIndex: number): Loaded => {
    const key = keyOf(bytes, faceIndex);
    const had = loaded.get(key);
    if (had) {
      // Most recently used last.
      loaded.delete(key);
      loaded.set(key, had);
      return had;
    }
    const fp = hb.malloc(bytes.byteLength);
    new Uint8Array(hb.memory.buffer).set(bytes, fp);
    const blob = hb.hb_blob_create(fp, bytes.byteLength, HB_MEMORY_MODE_READONLY, 0, 0);
    const face = hb.hb_face_create(blob, faceIndex);
    const f = {
      fp,
      blob,
      face,
      font: hb.hb_font_create(face),
      upem: hb.hb_face_get_upem(face) || 1000,
    };
    loaded.set(key, f);
    for (const [k, old] of loaded) {
      if (loaded.size <= KEEP) break;
      hb.hb_font_destroy(old.font);
      hb.hb_face_destroy(old.face);
      hb.hb_blob_destroy(old.blob);
      hb.free(old.fp);
      loaded.delete(k);
    }
    return f;
  };

  return (bytes, faceIndex) => (text) => {
    const chars = [...text];
    const f = load(bytes, faceIndex);
    const advances = (feat: { p: number; n: number }): number[] | null => {
      const units = new Uint16Array([...text].flatMap((c) => [...c].map((u) => u.charCodeAt(0))));
      const tp = hb.malloc(units.byteLength);
      new Uint16Array(hb.memory.buffer, tp, units.length).set(units);
      const buf = hb.hb_buffer_create();
      try {
        hb.hb_buffer_add_utf16(buf, tp, units.length, 0, units.length);
        hb.hb_buffer_guess_segment_properties(buf);
        hb.hb_shape(f.font, buf, feat.p, feat.n);
        const n = hb.hb_buffer_get_length(buf);
        // One glyph per letter, or no kerning at all (a mark, a surrogate pair...).
        if (n !== chars.length) return null;
        const pos = hb.hb_buffer_get_glyph_positions(buf, 0);
        const view = new Int32Array(hb.memory.buffer, pos, n * 5);
        return Array.from({ length: n }, (_, i) => view[i * 5] ?? 0);
      } finally {
        hb.hb_buffer_destroy(buf);
        hb.free(tp);
      }
    };
    const kerned = advances(on);
    const plain = advances(off);
    if (!kerned || !plain) return chars.map(() => 0);
    return kerned.map((a, i) => (a - (plain[i] ?? a)) / f.upem);
  };
}

/** AFM kerning for a standard 14 font by name ("Helvetica-Bold"); none for others. */
export function standardKerner(name: string): (text: string) => number[] {
  const known = (Object.values(FontNames) as string[]).includes(name);
  const font = known ? Font.load(name as FontName) : null;
  const glyph = (c: string) => {
    try {
      return Encodings.WinAnsi.encodeUnicodeCodePoint(c.codePointAt(0) ?? 0).name;
    } catch {
      return null;
    }
  };
  return (text) => {
    const chars = [...text];
    return chars.map((c, i) => {
      const next = chars[i + 1];
      if (!font || !next) return 0;
      const a = glyph(c);
      const b = glyph(next);
      return a && b ? (font.getXAxisKerningForPair(a, b) ?? 0) / 1000 : 0;
    });
  };
}

/** Caches a kerner's answers per text (layout measures the same words many times). */
export function kernCache(fn: (text: string) => number[]): (text: string) => number[] {
  const cache = new Map<string, number[]>();
  return (text) => {
    let k = cache.get(text);
    if (!k) {
      k = fn(text);
      cache.set(text, k);
    }
    return k;
  };
}
