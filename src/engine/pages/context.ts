import type { Engine, PdfiumModule } from "../pdfium";
import type { Qpdf } from "./qpdf";

/** What page operations need: EmbedPDF's engine, the raw PDFium module, and qpdf. */
export interface PagesCtx {
  engine: Engine;
  module: PdfiumModule;
  qpdf: Qpdf;
}

/** A page in an assembly plan: `file` 0 is the document itself, 1.. are extra inputs. */
export interface PageRef {
  file: number;
  page: number;
}
