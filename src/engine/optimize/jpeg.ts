// JPEG encoding for Optimize (jpeg-js 0.4.4, BSD-3-Clause; pure JS, runs in Node and the
// page worker). jpeg-js writes 3-component (YCbCr) JPEGs only, so grey images are
// encoded as RGB with flat colour channels (a few percent larger than a grey JPEG).
import { encode } from "jpeg-js";

/** jpeg-js ends with `Buffer.from(bytes)` when it sees a CommonJS `module` (bundlers
 * provide one); the worker has no Buffer, so it gets a stand-in for that one call. */
function withBuffer<T>(fn: () => T): T {
  const g = globalThis as unknown as { Buffer?: unknown };
  if (g.Buffer !== undefined) return fn();
  g.Buffer = { from: (a: ArrayLike<number>) => Uint8Array.from(a) };
  try {
    return fn();
  } finally {
    delete g.Buffer;
  }
}

/** RGB (3 bytes/pixel) or grey (1 byte/pixel) pixels to JPEG at `quality` (1-100). */
export function encodeJpeg(
  width: number,
  height: number,
  pixels: Uint8Array,
  channels: 1 | 3,
  quality: number,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const r = pixels[j] ?? 0;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = channels === 3 ? (pixels[j + 1] ?? 0) : r;
    rgba[i * 4 + 2] = channels === 3 ? (pixels[j + 2] ?? 0) : r;
    rgba[i * 4 + 3] = 255;
  }
  const out = withBuffer(() => encode({ width, height, data: rgba }, quality));
  return new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength);
}
