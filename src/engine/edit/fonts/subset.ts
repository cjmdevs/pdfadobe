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
  hb_set_add(set: number, cp: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;

// The Node build of the engine compiles without DOM types, so the WebAssembly global
// is described here (only the two calls used).
interface WasmApi {
  compile(bytes: ArrayBuffer): Promise<object>;
  instantiate(module: object): Promise<{ exports: object }>;
}
const wasmApi = () => (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

export type Subsetter = (font: Uint8Array, faceIndex: number, text: string) => Uint8Array;

/** Boots harfbuzz-subset.wasm and returns a subset function. */
export async function createSubsetter(wasm: Uint8Array | ArrayBuffer): Promise<Subsetter> {
  const bytes = wasm instanceof Uint8Array ? (wasm.slice().buffer as ArrayBuffer) : wasm;
  const wa = wasmApi();
  const instance = await wa.instantiate(await wa.compile(bytes));
  const x = instance.exports as unknown as SubsetExports;
  return (font, faceIndex, text) => {
    const p = x.malloc(font.byteLength);
    new Uint8Array(x.memory.buffer).set(font, p);
    const blob = x.hb_blob_create(p, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    const face = x.hb_face_create(blob, faceIndex);
    x.hb_blob_destroy(blob);
    const input = x.hb_subset_input_create_or_fail();
    try {
      if (!input) throw new Error("HarfBuzz could not start a subset");
      const unicodes = x.hb_subset_input_unicode_set(input);
      // Space is always kept: justified lines are written word by word, but the
      // paragraph still reads back with spaces.
      for (const cp of new Set([...text, " "].map((c) => c.codePointAt(0) ?? 32))) {
        x.hb_set_add(unicodes, cp);
      }
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
