// Main-thread client for the page-engine worker (src/app/pagesWorker.ts).
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import subsetWasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import shapeWasmUrl from "harfbuzzjs/dist/harfbuzz.wasm?url";
import { platform } from "../platform";
import { OcrCancelled } from "../engine/ocr/tesseract";
import type { Ops, WorkerRequest, WorkerResponse } from "./pagesWorker";

type Rest<F> = F extends (ctx: never, ...args: infer A) => unknown ? A : never;
type Result<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never;

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
const listeners = new Map<number, (value: unknown) => void>();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function start(): Worker {
  const w = new Worker(new URL("./pagesWorker.ts", import.meta.url), { type: "module" });
  const send = (m: WorkerRequest, transfer: Transferable[] = []) => w.postMessage(m, transfer);
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === "qpdf") {
      platform.qpdf.run(msg.job).then(
        (result) => send({ type: "qpdfResult", id: msg.id, result }),
        (err: unknown) => send({ type: "qpdfResult", id: msg.id, error: message(err) }),
      );
      return;
    }
    if (msg.type === "ocr") {
      platform.ocr.run(msg.job).then(
        (result) => send({ type: "ocrResult", id: msg.id, result }),
        (err: unknown) => send({ type: "ocrResult", id: msg.id, error: message(err) }),
      );
      return;
    }
    if (msg.type === "ocrCancel") {
      void platform.ocr.cancel(msg.id);
      return;
    }
    if (msg.type === "progress") {
      listeners.get(msg.id)?.(msg.value);
      return;
    }
    const p = waiting.get(msg.id);
    waiting.delete(msg.id);
    listeners.delete(msg.id);
    if (msg.cancelled) p?.reject(new OcrCancelled());
    else if (msg.error !== undefined) p?.reject(new Error(msg.error));
    else p?.resolve(msg.value);
  };
  // Local WASM only (no CDN). Absolute, like src/app/engine.ts.
  send({
    type: "init",
    wasmUrl: new URL(wasmUrl, window.location.href).href,
    subsetWasmUrl: new URL(subsetWasmUrl, window.location.href).href,
    shapeWasmUrl: new URL(shapeWasmUrl, window.location.href).href,
  });
  return w;
}

/**
 * Runs a page operation in the worker. Byte arrays passed in are copied (the caller
 * keeps them for undo); results arrive by transfer.
 */
export function pageOp<K extends keyof Ops>(op: K, ...args: Rest<Ops[K]>): Promise<Result<Ops[K]>> {
  return pageTask(op, () => undefined, ...args).done;
}

/** A long page operation (OCR): progress as it goes, and a way to stop it. */
export interface PageTask<T> {
  done: Promise<T>;
  /** Stops it; `done` then rejects with OcrCancelled. */
  cancel(): void;
}

export function pageTask<K extends keyof Ops, Progress = unknown>(
  op: K,
  onProgress: (p: Progress) => void,
  ...args: Rest<Ops[K]>
): PageTask<Result<Ops[K]>> {
  const w = (worker ??= start());
  const id = ++seq;
  listeners.set(id, onProgress as (v: unknown) => void);
  const done = new Promise<Result<Ops[K]>>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ type: "call", id, op, args } satisfies WorkerRequest);
  });
  return { done, cancel: () => w.postMessage({ type: "cancel", id } satisfies WorkerRequest) };
}
