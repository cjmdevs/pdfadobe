// A PagesCtx for Node tests: EmbedPDF engine + raw PDFium module + qpdf on PATH.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createPdfium } from "../../src/engine/pdfium";
import type { PagesCtx } from "../../src/engine/pages";
import { nodeQpdf } from "./qpdf-node";

const require = createRequire(import.meta.url);

export async function nodePagesCtx(): Promise<PagesCtx> {
  const { engine, module } = await createPdfium(
    readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")),
  );
  return { engine, module, qpdf: nodeQpdf() };
}
