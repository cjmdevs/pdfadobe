// PDFium in a Web Worker so parsing and rendering never block the UI thread.
// Local WASM only, and fontFallback: null, so the engine makes no network requests
// (CLAUDE.md; see docs/spike-report.md "Network defaults").
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import type { PdfEngine } from "@embedpdf/models";

let engine: PdfEngine | null = null;

export function getEngine(): PdfEngine {
  // The worker resolves the URL itself, from a blob: origin, so it must be absolute.
  engine ??= createPdfiumEngine(new URL(wasmUrl, window.location.href).href, {
    fontFallback: null,
  });
  return engine;
}
