// Edit PDF (B3): font subsetting with HarfBuzz (harfbuzzjs, MIT; HarfBuzz "Old MIT",
// owner-approved 2026-10-26). Only the standalone harfbuzz-subset.wasm is used: it has
// no imports, so it boots the same in Node, the page worker and the WebView. The
// caller supplies the WASM bytes (the app bundles them; nothing is fetched).

interface SubsetExports {
  memory: { buffer: ArrayBuffer };
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, lenOut: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_glyph_set(input: number): number;
  hb_subset_input_get_flags(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_set_add(set: number, cp: number): void;
  hb_set_clear(set: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
/** Glyph ids stay where they are (dropped glyphs become empty). */
const HB_SUBSET_FLAGS_RETAIN_GIDS = 0x2;

// The Node build of the engine compiles without DOM types, so the WebAssembly global
// is described here (only the two calls used).
interface WasmApi {
  compile(bytes: ArrayBuffer): Promise<object>;
  instantiate(module: object): Promise<{ exports: object }>;
}
const wasmApi = () => (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

export type Subsetter = (font: Uint8Array, faceIndex: number, text: string) => Uint8Array;

/**
 * Keeps only glyphs `gids` (plus .notdef), each at its old id, so text already written
 * with those ids still points at the right glyphs (Optimize, Phase 7).
 */
export type GlyphSubsetter = (font: Uint8Array, gids: Iterable<number>) => Uint8Array;

type Fill = (x: SubsetExports, input: number) => void;

async function boot(wasm: Uint8Array | ArrayBuffer) {
  const bytes = wasm instanceof Uint8Array ? (wasm.slice().buffer as ArrayBuffer) : wasm;
  const wa = wasmApi();
  const instance = await wa.instantiate(await wa.compile(bytes));
  const x = instance.exports as unknown as SubsetExports;
  return (font: Uint8Array, faceIndex: number, fill: Fill): Uint8Array => {
    const p = x.malloc(font.byteLength);
    new Uint8Array(x.memory.buffer).set(font, p);
    const blob = x.hb_blob_create(p, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    const face = x.hb_face_create(blob, faceIndex);
    x.hb_blob_destroy(blob);
    const input = x.hb_subset_input_create_or_fail();
    try {
      if (!input) throw new Error("HarfBuzz could not start a subset");
      fill(x, input);
      const sub = x.hb_subset_or_fail(face, input);
      if (!sub) throw new Error("HarfBuzz could not subset the font");
      const outBlob = x.hb_face_reference_blob(sub);
      const len = x.hb_blob_get_length(outBlob);
      const data = x.hb_blob_get_data(outBlob, 0);
      const out = new Uint8Array(x.memory.buffer).slice(data, data + len);
      x.hb_blob_destroy(outBlob);
      x.hb_face_destroy(sub);
      return out;
    } finally {
      if (input) x.hb_subset_input_destroy(input);
      x.hb_face_destroy(face);
      x.free(p);
    }
  };
}

/** Boots harfbuzz-subset.wasm and returns a subset function. */
export async function createSubsetter(wasm: Uint8Array | ArrayBuffer): Promise<Subsetter> {
  const run = await boot(wasm);
  return (font, faceIndex, text) =>
    run(font, faceIndex, (x, input) => {
      const unicodes = x.hb_subset_input_unicode_set(input);
      // Space is always kept: justified lines are written word by word, but the
      // paragraph still reads back with spaces.
      for (const cp of new Set([...text, " "].map((c) => c.codePointAt(0) ?? 32))) {
        x.hb_set_add(unicodes, cp);
      }
    });
}

export async function createGlyphSubsetter(
  wasm: Uint8Array | ArrayBuffer,
): Promise<GlyphSubsetter> {
  const run = await boot(wasm);
  return (font, gids) =>
    run(font, 0, (x, input) => {
      const set = x.hb_subset_input_glyph_set(input);
      x.hb_set_add(set, 0);
      for (const g of gids) x.hb_set_add(set, g);
      // Only glyphs asked for: no unicodes pulled in from the cmap.
      x.hb_set_clear(x.hb_subset_input_unicode_set(input));
      x.hb_subset_input_set_flags(
        input,
        x.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_RETAIN_GIDS,
      );
    });
}
