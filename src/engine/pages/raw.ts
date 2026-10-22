// Direct PDFium calls for page edits EmbedPDF's engine does not expose (page boxes,
// content transforms, new pages, image pages). Each call opens its own document handle
// from bytes and frees it, so it never shares state with EmbedPDF's page cache.

import type { PdfiumModule } from "../pdfium";

interface Heap {
  HEAPU8: Uint8Array;
}

export class RawDoc {
  private constructor(
    private readonly m: PdfiumModule,
    readonly ptr: number,
    private readonly filePtr: number,
  ) {}

  static open(m: PdfiumModule, bytes: Uint8Array): RawDoc {
    const filePtr = m.pdfium.wasmExports.malloc(bytes.byteLength);
    heap(m).set(bytes, filePtr);
    const ptr = m.FPDF_LoadMemDocument(filePtr, bytes.byteLength, "");
    if (!ptr) {
      m.pdfium.wasmExports.free(filePtr);
      throw new Error(`PDFium could not open the document (error ${m.FPDF_GetLastError()})`);
    }
    return new RawDoc(m, ptr, filePtr);
  }

  static create(m: PdfiumModule): RawDoc {
    const ptr = m.FPDF_CreateNewDocument();
    if (!ptr) throw new Error("PDFium could not create a document");
    return new RawDoc(m, ptr, 0);
  }

  get pageCount(): number {
    return this.m.FPDF_GetPageCount(this.ptr);
  }

  /** Runs `fn` with a loaded page, regenerating its content stream afterwards if asked. */
  withPage<T>(index: number, fn: (page: number) => T, regenerate = false): T {
    const page = this.m.FPDF_LoadPage(this.ptr, index);
    if (!page) throw new RangeError(`page ${index + 1} could not be loaded`);
    try {
      const r = fn(page);
      if (regenerate && !this.m.FPDFPage_GenerateContent(page)) {
        throw new Error(`page ${index + 1}: content could not be regenerated`);
      }
      return r;
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  save(): Uint8Array {
    const m = this.m;
    const writer = m.PDFiumExt_OpenFileWriter();
    try {
      if (!m.PDFiumExt_SaveAsCopy(this.ptr, writer)) throw new Error("PDFium could not save");
      const size = m.PDFiumExt_GetFileWriterSize(writer);
      const data = m.pdfium.wasmExports.malloc(size);
      try {
        m.PDFiumExt_GetFileWriterData(writer, data, size);
        return heap(m).slice(data, data + size);
      } finally {
        m.pdfium.wasmExports.free(data);
      }
    } finally {
      m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  close(): void {
    this.m.FPDF_CloseDocument(this.ptr);
    if (this.filePtr) this.m.pdfium.wasmExports.free(this.filePtr);
  }
}

export function heap(m: PdfiumModule): Uint8Array {
  return (m.pdfium as unknown as Heap).HEAPU8;
}

/** Opens `bytes`, runs `fn`, saves, and always frees the handle. */
export function editRaw(m: PdfiumModule, bytes: Uint8Array, fn: (doc: RawDoc) => void): Uint8Array {
  const doc = RawDoc.open(m, bytes);
  try {
    fn(doc);
    return doc.save();
  } finally {
    doc.close();
  }
}

/** Reads a FS_RECTF-style box (left, bottom, right, top) through four float out-params. */
export function readBox(
  m: PdfiumModule,
  get: (l: number, b: number, r: number, t: number) => boolean,
): Box | null {
  const p = m.pdfium.wasmExports.malloc(16);
  try {
    if (!get(p, p + 4, p + 8, p + 12)) return null;
    const f = (o: number) => m.pdfium.getValue(p + o, "float");
    return { left: f(0), bottom: f(4), right: f(8), top: f(12) };
  } finally {
    m.pdfium.wasmExports.free(p);
  }
}

/** A page box in PDF user space (points, bottom-left origin). */
export interface Box {
  left: number;
  bottom: number;
  right: number;
  top: number;
}
