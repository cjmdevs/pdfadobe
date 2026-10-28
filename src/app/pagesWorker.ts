// Web Worker running the page engine (src/engine/pages) off the UI thread. It has its own
// PDFium instance; qpdf jobs are passed back to the main thread, which owns the platform
// (Tauri IPC is not available inside workers).

import * as P from "../engine/pages";
import { createPdfium } from "../engine/pdfium";
import { flattenMarkup, type FlattenTarget } from "../engine/flatten";
import { summarizeComments } from "../engine/summary";
import { documentXfdf } from "../engine/xfdf";
import type { QpdfJob, QpdfResult } from "../engine/pages";
import { editPageInfo } from "../engine/edit/pageInfo";
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
  type BoxRef,
  type ImageEdit,
  type ImageRef,
  type PlainStyle,
} from "../engine/edit/document";
import type { Placement } from "../engine/edit/images";
import { createSubsetter, type Subsetter } from "../engine/edit/fonts/subset";

type Ctx = P.PagesCtx;

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
    paragraphs: string[],
    styles: (Partial<PlainStyle> | undefined)[] = [],
    width?: number,
  ) => editBoxText(c.module, b, ref, paragraphs, { subset: await subsetter() }, styles, width),
  editImage: async (c: Ctx, b: Uint8Array, ref: ImageRef, op: ImageEdit) =>
    editImage(c.module, b, ref, op),
  addImage: async (c: Ctx, b: Uint8Array, page: number, data: Uint8Array, at: Placement) =>
    addImageToPage(c.module, b, page, data, at),
  addText: async (
    c: Ctx,
    b: Uint8Array,
    page: number,
    at: { x: number; y: number; width: number | null },
    paragraphs: string[],
    style: PlainStyle,
  ) => addTextBox(c.module, b, page, at, paragraphs, style, { subset: await subsetter() }),
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
};

export type Ops = typeof OPS;

export type WorkerRequest =
  | { type: "init"; wasmUrl: string; subsetWasmUrl: string }
  | { type: "call"; id: number; op: keyof Ops; args: unknown[] }
  | { type: "qpdfResult"; id: number; result?: QpdfResult; error?: string };

export type WorkerResponse =
  | { type: "result"; id: number; value?: unknown; error?: string }
  | { type: "qpdf"; id: number; job: QpdfJob };

const scope = self as unknown as {
  postMessage(m: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let ctx: Promise<Ctx> | null = null;
/** HarfBuzz's subsetter (Edit PDF), loaded from the local asset on first use. */
let subsetWasmUrl = "";
let subset: Promise<Subsetter> | null = null;
const subsetter = () =>
  (subset ??= fetch(subsetWasmUrl)
    .then((r) => r.arrayBuffer())
    .then(createSubsetter));
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
    ctx = fetch(msg.wasmUrl)
      .then((r) => r.arrayBuffer())
      .then(createPdfium)
      .then(({ engine, module }) => ({ engine, module, qpdf }));
    return;
  }
  if (msg.type === "qpdfResult") {
    const w = qpdfWaiting.get(msg.id);
    qpdfWaiting.delete(msg.id);
    if (msg.result) w?.resolve(msg.result);
    else w?.reject(new P.QpdfError(msg.error ?? "qpdf failed"));
    return;
  }
  const { id, op, args } = msg;
  void (async () => {
    try {
      if (!ctx) throw new Error("page engine not initialised");
      const fn = OPS[op] as (c: Ctx, ...a: unknown[]) => Promise<unknown>;
      const value = await fn(await ctx, ...args);
      scope.postMessage({ type: "result", id, value }, [...buffersIn(value)]);
    } catch (err) {
      scope.postMessage({
        type: "result",
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
};
