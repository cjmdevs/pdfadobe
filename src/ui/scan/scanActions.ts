// Recognize Text on an open document (one undo step) and on every PDF in a folder
// (new files beside the originals). OCR runs in the page-engine worker; Tesseract runs as
// the bundled sidecar. Recognised text is never logged.
import type { WorkbenchApi } from "../../app/workbench";
import { pageOp, pageTask } from "../../app/pages";
import { OcrCancelled, type OcrOptions, type OcrProgress, type OcrReport } from "../../engine/ocr";
import { formatRanges } from "../../engine/pages/ranges";
import { platform } from "../../platform";
import { baseName, dirName } from "../../platform/types";
import { scan } from "./scanStore";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Read 3 pages; 2 already had text (1-2); no words on page 5." */
export function describeReport(r: Omit<OcrReport, "bytes">): string {
  const parts = [r.read.length ? `Read ${plural(r.read.length, "page")}` : "No pages read"];
  if (r.hadText.length)
    parts.push(`${plural(r.hadText.length, "page")} already had text (${formatRanges(r.hadText)})`);
  if (r.noWords.length)
    parts.push(`no words found on ${formatRanges(r.noWords).replace(/^/, "page ")}`);
  return `${parts.join("; ")}.`;
}

/** Runs Recognize Text on `pages` (all when undefined) of an open document. */
export async function recognize(wb: WorkbenchApi, documentId: string, pages?: number[]) {
  if (scan.get().run) {
    wb.toast("Recognize Text is already running. Wait for it or cancel it first.", "error");
    return;
  }
  const { skipText, straighten } = scan.get();
  const opts: OcrOptions = { skipText, straighten, ...(pages ? { pages } : {}) };
  let outcome: string | null = null;
  // A tab's document id changes with every edit: the outcome is kept by store id.
  const storeId = wb.meta[documentId]?.storeId ?? documentId;
  await wb.edit(documentId, "Recognize text", async (bytes) => {
    const task = pageTask<"ocrDocument", OcrProgress>(
      "ocrDocument",
      (p) => scan.progress(p),
      bytes,
      opts,
    );
    scan.start({
      kind: "document",
      documentId,
      page: null,
      done: 0,
      total: 0,
      cancel: task.cancel,
    });
    try {
      const r = await task.done;
      outcome = describeReport(r);
      return r.read.length ? r.bytes : null;
    } catch (e) {
      if (e instanceof OcrCancelled) outcome = "Cancelled: nothing was changed.";
      throw e;
    } finally {
      scan.finish(storeId, outcome);
    }
  });
  if (outcome) wb.toast(`Recognize text: ${outcome}`);
}

/** Enhance > Straighten Pages / Turn Pages Upright on `list` (0-based pages). */
export async function enhance(
  wb: WorkbenchApi,
  documentId: string,
  how: "straighten" | "upright",
  list: number[],
) {
  let message = "";
  await wb.edit(
    documentId,
    how === "straighten" ? "Straighten pages" : "Turn pages upright",
    async (bytes) => {
      const r =
        how === "straighten"
          ? await pageOp("straightenPages", bytes, list)
          : await pageOp("turnPagesUpright", bytes, list);
      const pagesTurned = r.turned.map((t) => t.page);
      message = pagesTurned.length
        ? `${how === "straighten" ? "Straightened" : "Turned"} ${plural(pagesTurned.length, "page")} (${formatRanges(pagesTurned)}).`
        : how === "straighten"
          ? "No tilted pages found."
          : "Every page is already upright (or has too little text to tell).";
      return pagesTurned.length ? r.bytes : null;
    },
    list[0] === undefined ? {} : { page: list[0] },
  );
  if (message) wb.toast(message);
}

export interface BatchFile {
  path: string;
  status: "waiting" | "reading" | "done" | "skipped" | "failed" | "cancelled";
  /** Written file, or why it was skipped or failed (no document text). */
  detail?: string;
}

/** `name.pdf` -> `name_OCR.pdf`. */
export const ocrFileName = (path: string) => baseName(path).replace(/(\.pdf)?$/i, "_OCR.pdf");

/**
 * Recognize Text in each PDF, writing `<name>_OCR.pdf` beside it (never over a file:
 * `writeNewFile` adds " (2)"). Files that already have text everywhere are left alone.
 * `update` is called after every change to `files`.
 */
export async function recognizeFiles(paths: string[], update: (files: BatchFile[]) => void) {
  const files: BatchFile[] = paths.map((path) => ({ path, status: "waiting" }));
  const show = () => update(files.map((f) => ({ ...f })));
  let cancelled = false;
  let current: (() => void) | null = null;
  const { skipText, straighten } = scan.get();
  scan.start({
    kind: "batch",
    documentId: null,
    page: null,
    done: 0,
    total: files.length,
    cancel: () => {
      cancelled = true;
      current?.();
    },
  });
  show();
  try {
    for (const [i, f] of files.entries()) {
      if (cancelled) {
        f.status = "cancelled";
        continue;
      }
      f.status = "reading";
      scan.progress({ page: null, done: i, total: files.length });
      show();
      try {
        const opened = await platform.readPath(f.path);
        const task = pageTask<"ocrDocument", OcrProgress>(
          "ocrDocument",
          () => undefined,
          new Uint8Array(opened.bytes),
          { skipText, straighten },
        );
        current = task.cancel;
        const r = await task.done;
        if (r.read.length) {
          const written = await platform.writeNewFile(
            dirName(f.path),
            ocrFileName(f.path),
            r.bytes,
          );
          f.status = "done";
          f.detail = `${describeReport(r)} Saved as ${baseName(written)}`;
        } else {
          f.status = "skipped";
          f.detail = describeReport(r);
        }
      } catch (e) {
        f.status = e instanceof OcrCancelled ? "cancelled" : "failed";
        if (!(e instanceof OcrCancelled)) f.detail = e instanceof Error ? e.message : String(e);
      } finally {
        current = null;
      }
      show();
    }
  } finally {
    scan.finish(null, null);
    show();
  }
}
