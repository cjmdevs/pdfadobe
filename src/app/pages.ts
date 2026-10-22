// Main-thread client for the page-engine worker (src/app/pagesWorker.ts).
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { platform } from "../platform";
import type { Ops, WorkerRequest, WorkerResponse } from "./pagesWorker";

type Rest<F> = F extends (ctx: never, ...args: infer A) => unknown ? A : never;
type Result<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never;

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function start(): Worker {
  const w = new Worker(new URL("./pagesWorker.ts", import.meta.url), { type: "module" });
  const send = (m: WorkerRequest, transfer: Transferable[] = []) => w.postMessage(m, transfer);
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === "qpdf") {
      platform.qpdf.run(msg.job).then(
        (result) => send({ type: "qpdfResult", id: msg.id, result }),
        (err: unknown) =>
          send({
            type: "qpdfResult",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      return;
    }
    const p = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error !== undefined) p?.reject(new Error(msg.error));
    else p?.resolve(msg.value);
  };
  // Local WASM only (no CDN). Absolute, like src/app/engine.ts.
  send({ type: "init", wasmUrl: new URL(wasmUrl, window.location.href).href });
  return w;
}

/**
 * Runs a page operation in the worker. Byte arrays passed in are copied (the caller
 * keeps them for undo); results arrive by transfer.
 */
export function pageOp<K extends keyof Ops>(op: K, ...args: Rest<Ops[K]>): Promise<Result<Ops[K]>> {
  worker ??= start();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker?.postMessage({ type: "call", id, op, args } satisfies WorkerRequest);
  });
}
