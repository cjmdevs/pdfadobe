// Binary framing for qpdf jobs crossing a process boundary (Tauri IPC, dev server):
//   u32 big-endian header length | header JSON | files concatenated
// See src-tauri/src/qpdf_job.rs for the Rust side. OCR jobs (src-tauri/src/ocr_job.rs)
// use the same framing, with their job `id` in the header.

import type { QpdfJob, QpdfResult } from "./qpdf";

interface Entry {
  name: string;
  size: number;
}

function frame(header: object, files: Uint8Array[]): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + files.reduce((n, f) => n + f.length, 0));
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  let o = 4 + head.length;
  for (const f of files) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

function unframe<H>(bytes: Uint8Array): { header: H; body: Uint8Array } {
  if (bytes.length < 4) throw new Error("qpdf frame is truncated");
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as H;
  return { header, body: bytes.subarray(4 + len) };
}

function slices(entries: Entry[], body: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let o = 0;
  for (const e of entries) {
    if (o + e.size > body.length) throw new Error("qpdf frame is truncated");
    out[e.name] = body.slice(o, o + e.size);
    o += e.size;
  }
  return out;
}

export function encodeJob(job: QpdfJob & { id?: number }): Uint8Array {
  const names = Object.keys(job.inputs);
  const files = names.map((n) => job.inputs[n] ?? new Uint8Array(0));
  return frame(
    {
      ...(job.id === undefined ? {} : { id: job.id }),
      args: job.args,
      outputs: job.outputs,
      inputs: names.map((name, i) => ({ name, size: files[i]?.length ?? 0 })),
    },
    files,
  );
}

export function decodeJob(bytes: Uint8Array): QpdfJob & { id?: number } {
  const { header, body } = unframe<{
    id?: number;
    args: string[];
    outputs: string[];
    inputs: Entry[];
  }>(bytes);
  return {
    ...(header.id === undefined ? {} : { id: header.id }),
    args: header.args,
    outputs: header.outputs,
    inputs: slices(header.inputs, body),
  };
}

export function encodeResult(r: QpdfResult): Uint8Array {
  const names = Object.keys(r.files);
  const files = names.map((n) => r.files[n] ?? new Uint8Array(0));
  return frame(
    {
      stdout: r.stdout,
      warnings: r.warnings,
      files: names.map((name, i) => ({ name, size: files[i]?.length ?? 0 })),
    },
    files,
  );
}

export function decodeResult(bytes: Uint8Array): QpdfResult {
  const { header, body } = unframe<{ stdout: string; warnings: boolean; files: Entry[] }>(bytes);
  return { stdout: header.stdout, warnings: header.warnings, files: slices(header.files, body) };
}
