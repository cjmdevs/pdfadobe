// PDFium (EmbedPDF) bootstrap. Runs in Node and in the WebView.
//
// The caller supplies the WASM bytes: the app bundles pdfium.wasm as a local asset
// and Node reads it from node_modules. Never use EmbedPDF's DEFAULT_PDFIUM_WASM_URL
// (jsDelivr CDN): CLAUDE.md forbids network calls.

import { init } from "@embedpdf/pdfium";
import { PdfiumNative } from "@embedpdf/engines/pdfium";

export type Engine = PdfiumNative;

export async function createEngine(wasm: ArrayBuffer | Uint8Array): Promise<Engine> {
  const wasmBinary =
    wasm instanceof Uint8Array
      ? (wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
      : wasm;
  const module = await init({ wasmBinary });
  // fontFallback: null disables EmbedPDF's on-demand CJK/Arabic/Hebrew font downloads
  // from jsDelivr. Missing glyphs render with PDFium's built-in fallbacks instead.
  return new PdfiumNative(module, { fontFallback: null });
}
