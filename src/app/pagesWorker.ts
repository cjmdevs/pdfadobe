// Web Worker running the page engine (src/engine/pages) off the UI thread. It has its own
// PDFium instance; qpdf and Tesseract jobs are passed back to the main thread, which owns
// the platform (Tauri IPC is not available inside workers). Long operations (OCR) post
// progress and can be cancelled.

import * as P from "../engine/pages";
import { createPdfium } from "../engine/pdfium";
import { flattenMarkup, type FlattenTarget } from "../engine/flatten";
import { summarizeComments } from "../engine/summary";
import { documentXfdf } from "../engine/xfdf";
import type { QpdfJob, QpdfResult } from "../engine/pages";
import { editPageInfo } from "../engine/edit/pageInfo";
import {
  OcrCancelled,
  OcrControl,
  OcrError,
  ocrDocument,
  straightenPages,
  turnPagesUpright,
  type Ocr,
  type OcrJob,
  type OcrOptions,
  type OcrResult,
} from "../engine/ocr";
import { pageNumbers } from "../engine/flyer/numbers";
import {
  RedactionLeakError,
  pageMarks,
  redactDocument,
  sanitizeDocument,
  searchDocument,
  type LeakHit,
  type RedactRequest,
  type SanitizeOptions,
  type SanitizeReport,
  type SearchSpec,
} from "../engine/redact";
import {
  addImageToPage,
  addTextBox,
  editBoxText,
  editImage,
  joinBoxes,
  moveBox,
  alignObjects,
  arrangeBox,
  exportImage,
  type AlignHow,
  type AlignItem,
  splitBox,
  type BoxRef,
  type Caret,
  type EditOutcome,
  type RichText,
  type ImageEdit,
  type ImageRef,
  type PlainStyle,
} from "../engine/edit/document";
import type { Placement } from "../engine/edit/images";
import {
  createGlyphSubsetter,
  createSubsetter,
  type GlyphSubsetter,
  type Subsetter,
} from "../engine/edit/fonts/subset";
import { optimizeDocument, type OptimizePresetId } from "../engine/optimize";
import {
  addBackground,
  addHeaderFooter,
  addWatermark,
  removeDecorations,
  type BackgroundSpec,
  type BatesSpec,
  type DecorKind,
  type HeaderFooterSpec,
  type TokenValues,
  type WatermarkSpec,
} from "../engine/decorate";
import { graftKinds } from "../engine/pages/graft";
import { createKerner, type Kerner } from "../engine/edit/fonts/kern";
import { applySpacing } from "../engine/edit/spacing";
import { addPdflyerKeys } from "../engine/flyer/pdflyer";
import type { Arrange } from "../engine/edit/arrange";
import {
  listLinks,
  removeLinks,
  removeWebLinks,
  setLink,
  type LinkSpec,
} from "../engine/edit/links";
import {
  fillAndCalculate,
  rawNumberValues,
  readCalcSetup,
  type CalcSetup,
  addField,
  addFields,
  detectFields,
  readFieldProps,
  removeOrphanFields,
  setFieldProps,
  type FieldProps,
  type NewField,
  fillCopy,
  flattenForm,
  formKind,
  bytesForSave,
  formValues,
  parseFormData,
  readFields,
  resetFields,
  type DataFormat,
  type FieldValues,
  type ResetRequest,
  type XfaPolicy,
} from "../engine/forms";

/** One call's own channel: progress to the main thread, and its cancel switch. */
interface Call {
  progress(value: unknown): void;
  control: OcrControl;
}

type Ctx = P.PagesCtx & { ocr: Ocr; call: Call };

/** Every operation the app can request. The first argument is always the context. */
export const OPS = {
  movePages: P.movePages,
  reorderPages: P.reorderPages,
  deletePages: P.deletePages,
  duplicatePages: P.duplicatePages,
  extractPages: P.extractPages,
  insertPages: P.insertPages,
  replacePages: P.replacePages,
  combine: P.combine,
  splitParts: P.splitParts,
  splitBySize: P.splitBySize,
  readOutline: (c: Ctx, b: Uint8Array) => P.readOutline(c.engine, b),
  writeOutline: (c: Ctx, b: Uint8Array, o: P.Outline) => P.writeOutline(c.engine, b, o),
  pageCount: (c: Ctx, b: Uint8Array) => P.pageCountOf(c.engine, b),
  bookmarkPages: P.bookmarkPages,
  deleteBookmarkWithPages: P.deleteBookmarkWithPages,
  extractBookmarkPages: P.extractBookmarkPages,
  moveBookmarkWithPages: P.moveBookmarkWithPages,
  rotatePages: async (c: Ctx, b: Uint8Array, i: number[], t: P.QuarterTurns) =>
    P.rotatePages(c.module, b, i, t),
  cropPages: async (c: Ctx, b: Uint8Array, i: number[], m: P.Margins) =>
    P.cropPages(c.module, b, i, m),
  setPageSize: async (c: Ctx, b: Uint8Array, i: number[], s: { width: number; height: number }) =>
    P.setPageSize(c.module, b, i, s),
  insertBlankPages: async (
    c: Ctx,
    b: Uint8Array,
    at: number,
    count: number,
    size?: { width: number; height: number },
  ) => P.insertBlankPages(c.module, b, at, count, size),
  // Markup (Phase 3).
  flattenMarkup: (c: Ctx, b: Uint8Array, t: FlattenTarget) => flattenMarkup(c.engine, b, t),
  exportXfdf: (c: Ctx, b: Uint8Array, fileName: string) => documentXfdf(c.engine, b, fileName),
  summarizeComments: (c: Ctx, b: Uint8Array, fileName: string, locale: string) =>
    summarizeComments(c.engine, b, {
      fileName,
      generated: new Date(),
      formatDate: (d) => d.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }),
    }),
  // Workpaper Tools (Phase 4): amounts printed on a page, for the calculator.
  pageNumbers: async (c: Ctx, b: Uint8Array, page: number) => pageNumbers(c.module, b, page),
  // Edit PDF (backlog B3).
  editPageInfo: async (c: Ctx, b: Uint8Array, page: number) => editPageInfo(c.module, b, page),
  editText: async (
    c: Ctx,
    b: Uint8Array,
    ref: BoxRef,
    paragraphs: (string | RichText)[],
    styles: (Partial<PlainStyle> | undefined)[] = [],
    width?: number,
    opts: { left?: number; dy?: number; push?: boolean } = {},
  ) =>
    spaced(
      c,
      editBoxText(c.module, b, ref, paragraphs, await textDeps(), styles, width, opts),
      ref.page,
    ),
  moveText: async (c: Ctx, b: Uint8Array, ref: BoxRef, dx: number, dy: number) =>
    moveBox(c.module, b, ref, dx, dy),
  arrangeText: async (c: Ctx, b: Uint8Array, ref: BoxRef, how: Arrange) =>
    arrangeBox(c.module, b, ref, how),
  alignObjects: async (c: Ctx, b: Uint8Array, page: number, items: AlignItem[], how: AlignHow) =>
    alignObjects(c.module, b, page, items, how),
  exportImage: async (c: Ctx, b: Uint8Array, ref: ImageRef) => exportImage(c.module, b, ref),
  // Links (the Edit toolbar's Link button).
  listLinks: (c: Ctx, b: Uint8Array, page: number) => listLinks(c.qpdf, b, page),
  setLink: (c: Ctx, b: Uint8Array, page: number, spec: LinkSpec, ref: string | null) =>
    setLink(c.qpdf, b, page, spec, ref),
  removeLinks: (c: Ctx, b: Uint8Array, page: number, refs: string[]) =>
    removeLinks(c.qpdf, b, page, refs),
  removeWebLinks: (c: Ctx, b: Uint8Array) => removeWebLinks(c.qpdf, b),
  joinText: async (c: Ctx, b: Uint8Array, refs: BoxRef[]) => joinBoxes(c.module, b, refs),
  splitText: async (
    c: Ctx,
    b: Uint8Array,
    ref: BoxRef,
    paragraphs: (string | RichText)[],
    caret: Caret,
    styles: (Partial<PlainStyle> | undefined)[] = [],
  ) => spaced(c, splitBox(c.module, b, ref, paragraphs, caret, await textDeps(), styles), ref.page),
  editImage: async (c: Ctx, b: Uint8Array, ref: ImageRef, op: ImageEdit) =>
    editImage(c.module, b, ref, op),
  addImage: async (c: Ctx, b: Uint8Array, page: number, data: Uint8Array, at: Placement) =>
    addImageToPage(c.module, b, page, data, at),
  addText: async (
    c: Ctx,
    b: Uint8Array,
    page: number,
    at: { x: number; y: number; width: number | null },
    paragraphs: (string | RichText)[],
    style: PlainStyle,
  ) => spaced(c, addTextBox(c.module, b, page, at, paragraphs, style, await textDeps()), page),
  // Fill Forms (Phase 6): Reset form / Clear fields.
  resetFields: (c: Ctx, b: Uint8Array, req: ResetRequest) => resetFields(c, b, req),
  // Form data import/export and fill-from-CSV.
  formFields: async (c: Ctx, b: Uint8Array) => {
    const doc = await c.engine
      .openDocumentBuffer({ id: `fields-${crypto.randomUUID()}`, content: b.slice().buffer })
      .toPromise();
    try {
      return await readFields(c.engine, doc);
    } finally {
      await c.engine.closeDocument(doc).toPromise();
    }
  },
  formValues: (c: Ctx, b: Uint8Array) => formValues(c.engine, b),
  flattenForm: (c: Ctx, b: Uint8Array) => flattenForm(c, b),
  formKind: async (c: Ctx, b: Uint8Array) => formKind(c.module, b),
  // Save / Save As: a hybrid form is written without its XFA twin and /Perms.
  bytesForSave: async (c: Ctx, b: Uint8Array) => addPdflyerKeys(c.qpdf, await bytesForSave(c, b)),
  // Prepare Form.
  addField: (c: Ctx, b: Uint8Array, spec: NewField) => addField(c, b, spec),
  readFieldProps: (c: Ctx, b: Uint8Array, name: string) => readFieldProps(c, b, name),
  setFieldProps: (c: Ctx, b: Uint8Array, name: string, props: Partial<FieldProps>) =>
    setFieldProps(c, b, name, props),
  removeOrphanFields: (c: Ctx, b: Uint8Array) => removeOrphanFields(c, b),
  detectFields: async (c: Ctx, b: Uint8Array, taken: string[]) =>
    detectFields(c.module, b, new Set(taken)),
  addFields: (c: Ctx, b: Uint8Array, specs: NewField[]) => addFields(c, b, specs),
  // Import: fill, then Acrobat's calculations (engine/forms/calc.ts).
  fillForm: (c: Ctx, b: Uint8Array, values: FieldValues) => fillAndCalculate(c, b, values),
  calcSetup: (c: Ctx, b: Uint8Array) => readCalcSetup(c, b),
  rawNumberValues: (c: Ctx, b: Uint8Array, setup: CalcSetup) => rawNumberValues(c, b, setup),
  fillCopy: (c: Ctx, b: Uint8Array, values: FieldValues, xfa: XfaPolicy) =>
    fillCopy(c, b, values, xfa),
  parseFormData: async (_c: Ctx, file: Uint8Array, format: DataFormat) =>
    parseFormData(file, format),
  // Redaction (Phase 5). A leak is a result, not an error: errors cross the worker
  // boundary as text only, and the UI needs the hits to say where.
  redactSearch: async (c: Ctx, b: Uint8Array, spec: SearchSpec) =>
    searchDocument(c.module, b, spec),
  redactPageMarks: async (c: Ctx, b: Uint8Array, pages: number[]) => pageMarks(c.module, b, pages),
  redactApply: async (
    c: Ctx,
    b: Uint8Array,
    req: RedactRequest,
  ): Promise<
    | {
        ok: true;
        bytes: Uint8Array;
        imagesRemoved: number;
        pathsClipped: number;
        pathsRemovedWhole: number;
        annotationsRemoved: number;
        fieldsRemoved: number;
        sanitize: SanitizeReport;
      }
    | { ok: false; hits: LeakHit[] }
  > => {
    try {
      const r = await redactDocument(c.module, c.qpdf, b, req);
      return {
        ok: true,
        bytes: r.bytes,
        imagesRemoved: r.content.imagesRemoved,
        pathsClipped: r.content.pathsClipped,
        pathsRemovedWhole: r.content.pathsRemovedWhole.length,
        annotationsRemoved: r.objects.annotationsRemoved,
        fieldsRemoved: r.objects.fieldsRemoved.length,
        sanitize: r.sanitize,
      };
    } catch (e) {
      if (e instanceof RedactionLeakError) return { ok: false, hits: e.hits };
      throw e;
    }
  },
  sanitize: async (c: Ctx, b: Uint8Array, opt: SanitizeOptions) =>
    sanitizeDocument(c.module, c.qpdf, b, opt),
  /** Images (JPEG/PNG/TIFF files) -> one PDF, one page per image. */
  imagesToPdf: async (_c: Ctx, files: Uint8Array[]) =>
    P.imagesToPdf(files.flatMap((f) => P.imagePages(f))),
  /** Recognize Text (Phase 7): progress per page, cancellable. */
  ocrDocument: (c: Ctx, b: Uint8Array, opts: OcrOptions) =>
    ocrDocument(c.module, c.ocr, c.qpdf, b, opts, c.call.control, c.call.progress),
  /** Reduce File Size (Phase 7): the result is saved as a new file by the caller. */
  optimize: async (c: Ctx, b: Uint8Array, preset: OptimizePresetId) =>
    optimizeDocument(c.module, c.qpdf, await glyphSubsetter(), b, preset),
  /** Header & Footer, or Bates numbers with `bates` (Phase 7). */
  addHeaderFooter: (
    c: Ctx,
    b: Uint8Array,
    spec: HeaderFooterSpec,
    values: TokenValues,
    bates?: BatesSpec,
  ) => addHeaderFooter(c.module, c.qpdf, b, spec, values, bates),
  addWatermark: (c: Ctx, b: Uint8Array, spec: WatermarkSpec) =>
    addWatermark(c.module, c.qpdf, b, spec),
  addBackground: (c: Ctx, b: Uint8Array, spec: BackgroundSpec) =>
    addBackground(c.module, c.qpdf, b, spec),
  removeDecorations: (c: Ctx, b: Uint8Array, kinds: DecorKind[]) =>
    removeDecorations(c.qpdf, b, kinds),
  /** Which kinds of added layers the document has ("header", "watermark", "ocr"...). */
  decorKinds: async (c: Ctx, b: Uint8Array) => [...(await graftKinds(c.qpdf, b))],
  /** Enhance: turn tilted pages level (lossless). */
  straightenPages: (c: Ctx, b: Uint8Array, pages: number[]) =>
    straightenPages(c.module, c.qpdf, b, pages),
  /** Enhance: /Rotate sideways and upside-down pages upright. */
  turnPagesUpright: (c: Ctx, b: Uint8Array, pages: number[]) =>
    turnPagesUpright(c.module, c.ocr, b, pages, c.call.control),
};

export type Ops = typeof OPS;

export type WorkerRequest =
  | { type: "init"; wasmUrl: string; subsetWasmUrl: string; shapeWasmUrl: string }
  | { type: "call"; id: number; op: keyof Ops; args: unknown[] }
  | { type: "qpdfResult"; id: number; result?: QpdfResult; error?: string }
  | { type: "ocrResult"; id: number; result?: OcrResult; error?: string }
  /** Cancel call `id` (only OCR calls listen). */
  | { type: "cancel"; id: number };

export type WorkerResponse =
  | { type: "result"; id: number; value?: unknown; error?: string; cancelled?: boolean }
  | { type: "progress"; id: number; value: unknown }
  | { type: "qpdf"; id: number; job: QpdfJob }
  | { type: "ocr"; id: number; job: OcrJob }
  | { type: "ocrCancel"; id: number };

const scope = self as unknown as {
  postMessage(m: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let ctx: Promise<Omit<Ctx, "call">> | null = null;
/** HarfBuzz's shaper (kerning for fonts from files), loaded on first use. */
let shapeWasmUrl = "";
let kern: Promise<Kerner> | null = null;
const kerner = () =>
  (kern ??= fetch(shapeWasmUrl)
    .then((r) => r.arrayBuffer())
    .then(createKerner));
const textDeps = async () => ({ subset: await subsetter(), kerner: await kerner() });
/** After a text edit: writes the spacing PDFium can't (`spacing.ts`), if any. */
async function spaced(c: Ctx, out: EditOutcome, page: number): Promise<EditOutcome> {
  return out.result?.spaced
    ? { ...out, bytes: await applySpacing(c.qpdf, out.bytes, [page]) }
    : out;
}
/** HarfBuzz's subsetter (Edit PDF), loaded from the local asset on first use. */
let subsetWasmUrl = "";
let subset: Promise<Subsetter> | null = null;
const subsetter = () =>
  (subset ??= fetch(subsetWasmUrl)
    .then((r) => r.arrayBuffer())
    .then(createSubsetter));
/** The same WASM as a glyph-id subsetter (Optimize). */
let glyphSubset: Promise<GlyphSubsetter> | null = null;
const glyphSubsetter = () =>
  (glyphSubset ??= fetch(subsetWasmUrl)
    .then((r) => r.arrayBuffer())
    .then(createGlyphSubsetter));
let qpdfSeq = 0;
const qpdfWaiting = new Map<number, { resolve(r: QpdfResult): void; reject(e: Error): void }>();

const qpdf: P.Qpdf = {
  run(job) {
    const id = ++qpdfSeq;
    return new Promise((resolve, reject) => {
      qpdfWaiting.set(id, { resolve, reject });
      scope.postMessage({ type: "qpdf", id, job });
    });
  },
};

const ocrWaiting = new Map<number, { resolve(r: OcrResult): void; reject(e: Error): void }>();
/** Tesseract on the main thread; `id` is the job id the engine picked. */
const ocr: Ocr = {
  run(job) {
    return new Promise((resolve, reject) => {
      ocrWaiting.set(job.id, { resolve, reject });
      scope.postMessage({ type: "ocr", id: job.id, job });
    });
  },
  async cancel(id) {
    scope.postMessage({ type: "ocrCancel", id });
  },
};
/** Running calls' cancel switches, by call id. */
const controls = new Map<number, OcrControl>();

/** ArrayBuffers in a result, so they move to the main thread instead of being copied. */
function buffersIn(v: unknown, out: Set<ArrayBuffer> = new Set()): Set<ArrayBuffer> {
  if (v instanceof Uint8Array && v.buffer instanceof ArrayBuffer) out.add(v.buffer);
  else if (Array.isArray(v)) v.forEach((x) => buffersIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => buffersIn(x, out));
  return out;
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    subsetWasmUrl = msg.subsetWasmUrl;
    shapeWasmUrl = msg.shapeWasmUrl;
    ctx = fetch(msg.wasmUrl)
      .then((r) => r.arrayBuffer())
      .then(createPdfium)
      .then(({ engine, module }) => ({ engine, module, qpdf, ocr }));
    return;
  }
  if (msg.type === "qpdfResult") {
    const w = qpdfWaiting.get(msg.id);
    qpdfWaiting.delete(msg.id);
    if (msg.result) w?.resolve(msg.result);
    else w?.reject(new P.QpdfError(msg.error ?? "qpdf failed"));
    return;
  }
  if (msg.type === "ocrResult") {
    const w = ocrWaiting.get(msg.id);
    ocrWaiting.delete(msg.id);
    if (msg.result) w?.resolve(msg.result);
    else w?.reject(new OcrError(msg.error ?? "OCR failed"));
    return;
  }
  if (msg.type === "cancel") {
    void controls.get(msg.id)?.cancel();
    return;
  }
  const { id, op, args } = msg;
  const control = new OcrControl(ocr);
  controls.set(id, control);
  const call: Call = {
    progress: (value) => scope.postMessage({ type: "progress", id, value }),
    control,
  };
  void (async () => {
    try {
      if (!ctx) throw new Error("page engine not initialised");
      const fn = OPS[op] as (c: Ctx, ...a: unknown[]) => Promise<unknown>;
      const value = await fn({ ...(await ctx), call }, ...args);
      scope.postMessage({ type: "result", id, value }, [...buffersIn(value)]);
    } catch (err) {
      scope.postMessage({
        type: "result",
        id,
        error: err instanceof Error ? err.message : String(err),
        cancelled: err instanceof OcrCancelled,
      });
    } finally {
      controls.delete(id);
    }
  })();
};
