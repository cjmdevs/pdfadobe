// Everything the tools run on: PDFium (from local WASM bytes, never the CDN), HarfBuzz
// for font subsetting, and the qpdf and Tesseract sidecars. Node has no CSP, so the
// rules CLAUDE.md gets from the WebView's CSP are kept here by construction: WASM is
// read from disk, `createPdfium` sets fontFallback: null, and nothing opens a socket.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createGlyphSubsetter, type GlyphSubsetter } from "../../../src/engine/edit/fonts/subset";
import type { Ocr } from "../../../src/engine/ocr/tesseract";
import type { Qpdf } from "../../../src/engine/pages/qpdf";
import { createPdfium, type Engine, type PdfiumModule } from "../../../src/engine/pdfium";
import { nodeOcr } from "./ocr";
import { nodeQpdf } from "./qpdf";

export interface RuntimePaths {
  pdfiumWasm: string;
  harfbuzzSubsetWasm: string;
  qpdfExe: string;
  /** Folder with tesseract.exe and tessdata\. */
  tesseractDir: string;
}

/** Layout inside the .mcpb: everything next to server.mjs (see mcp-server/build.mjs). */
export function bundledPaths(serverDir: string): RuntimePaths {
  return {
    pdfiumWasm: join(serverDir, "pdfium.wasm"),
    harfbuzzSubsetWasm: join(serverDir, "harfbuzz-subset.wasm"),
    qpdfExe: join(serverDir, "bin", "qpdf", "qpdf.exe"),
    tesseractDir: join(serverDir, "bin", "tesseract"),
  };
}

/** Layout in the repo: node_modules plus the vendored sidecars (tests, `npm run mcp:dev`). */
export function repoPaths(repoRoot: string): RuntimePaths {
  const require = createRequire(join(repoRoot, "package.json"));
  return {
    pdfiumWasm: require.resolve("@embedpdf/pdfium/pdfium.wasm"),
    harfbuzzSubsetWasm: require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"),
    qpdfExe: join(repoRoot, "src-tauri", "vendor", "qpdf", "qpdf.exe"),
    tesseractDir: join(repoRoot, "src-tauri", "vendor", "tesseract"),
  };
}

/** Bundle layout when server.mjs sits next to pdfium.wasm, else the repo layout. */
export function findPaths(serverDir: string): RuntimePaths {
  if (existsSync(join(serverDir, "pdfium.wasm"))) return bundledPaths(serverDir);
  let dir = serverDir;
  while (!existsSync(join(dir, "package.json")) || !existsSync(join(dir, "src", "engine"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("cannot find pdfium.wasm or the repository root");
    dir = up;
  }
  return repoPaths(dir);
}

export interface Runtime {
  engine: Engine;
  module: PdfiumModule;
  subsetter(): Promise<GlyphSubsetter>;
  /** qpdf with job folders under `workDir` (a task folder in _workspace). */
  qpdf(workDir: string): Qpdf;
  ocr(workDir: string): Ocr;
}

export async function loadRuntime(paths: RuntimePaths): Promise<Runtime> {
  const { engine, module } = await createPdfium(readFileSync(paths.pdfiumWasm));
  let subsetter: Promise<GlyphSubsetter> | null = null;
  return {
    engine,
    module,
    subsetter: () => (subsetter ??= createGlyphSubsetter(readFileSync(paths.harfbuzzSubsetWasm))),
    qpdf: (workDir) => nodeQpdf(paths.qpdfExe, () => workDir),
    ocr: (workDir) => nodeOcr(paths.tesseractDir, () => workDir),
  };
}
