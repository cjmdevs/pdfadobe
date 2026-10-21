// Boots EmbedPDF's PDFium engine in Node for tests and scripts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createEngine, type Engine } from "../../src/engine/pdfium";

const require = createRequire(import.meta.url);

export async function nodeEngine(): Promise<Engine> {
  return createEngine(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")));
}

/** Exact-size ArrayBuffer copy. Node pools small Buffers, so `buf.buffer` may hold other data. */
export function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function readPdf(path: string): ArrayBuffer {
  return toArrayBuffer(readFileSync(path));
}
