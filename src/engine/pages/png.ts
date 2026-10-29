// Minimal PNG decoder (all color types, bit depths 1-16, Adam7 interlace) to RGBA8.
// Used for PNG inputs so they can be stored compactly (PDFium re-encodes PNGs as RGB).
// And a minimal RGBA8 encoder (Edit PDF hands an image to another program as a PNG).

import { unzlibSync, zlibSync } from "fflate";

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

const be32 = (b: Uint8Array, o: number) =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;

export function decodePng(b: Uint8Array): Rgba {
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array = new Uint8Array(0);
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= b.length) {
    const len = be32(b, o);
    const t = String.fromCharCode(...b.subarray(o + 4, o + 8));
    const d = b.subarray(o + 8, o + 8 + len);
    if (t === "IHDR") {
      width = be32(d, 0);
      height = be32(d, 4);
      depth = d[8] ?? 0;
      type = d[9] ?? 0;
      interlace = d[12] ?? 0;
    } else if (t === "PLTE") palette = d;
    else if (t === "tRNS") trns = d;
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    o += 12 + len;
  }
  if (!width || !height) throw new Error("PNG has no image header");
  const total = idat.reduce((n, p) => n + p.length, 0);
  const z = new Uint8Array(total);
  let k = 0;
  for (const p of idat) {
    z.set(p, k);
    k += p.length;
  }
  const raw = unzlibSync(z);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`unsupported PNG color type ${type}`);
  const out = new Uint8Array(width * height * 4);
  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per pixel for filtering
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  let pos = 0;
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * channels * depth) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[pos++] ?? 0;
      const line = raw.slice(pos, pos + stride);
      pos += stride;
      unfilter(filter, line, prev, bpp);
      for (let x = 0; x < pw; x++) {
        writePixel(
          out,
          ((y0 + y * dy) * width + x0 + x * dx) * 4,
          line,
          x,
          channels,
          depth,
          type,
          palette,
          trns,
        );
      }
      prev = line;
    }
  }
  return { width, height, data: out };
}

function unfilter(f: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? (line[i - bpp] ?? 0) : 0;
    const up = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    let v = line[i] ?? 0;
    if (f === 1) v += a;
    else if (f === 2) v += up;
    else if (f === 3) v += (a + up) >> 1;
    else if (f === 4) {
      const p = a + up - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
    }
    line[i] = v & 0xff;
  }
}

function sample(line: Uint8Array, index: number, depth: number): number {
  if (depth === 8) return line[index] ?? 0;
  if (depth === 16) return line[index * 2] ?? 0; // high byte
  const perByte = 8 / depth;
  const byte = line[Math.floor(index / perByte)] ?? 0;
  const shift = 8 - depth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function writePixel(
  out: Uint8Array,
  o: number,
  line: Uint8Array,
  x: number,
  channels: number,
  depth: number,
  type: number,
  palette: Uint8Array,
  trns: Uint8Array | null,
): void {
  const s = (c: number) => sample(line, x * channels + c, depth);
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  if (type === 3) {
    const i = s(0);
    out[o] = palette[i * 3] ?? 0;
    out[o + 1] = palette[i * 3 + 1] ?? 0;
    out[o + 2] = palette[i * 3 + 2] ?? 0;
    out[o + 3] = trns && i < trns.length ? (trns[i] ?? 0) : 255;
    return;
  }
  if (type === 0 || type === 4) {
    const raw = s(0);
    const g = Math.round(raw * scale);
    out[o] = out[o + 1] = out[o + 2] = g;
    // tRNS for gray is one 16-bit sample value (compared on the high byte for 16-bit).
    const key =
      trns && type === 0
        ? depth === 16
          ? (trns[0] ?? 0)
          : ((trns[0] ?? 0) << 8) | (trns[1] ?? 0)
        : -1;
    out[o + 3] = type === 4 ? s(1) : raw === key ? 0 : 255;
    return;
  }
  out[o] = s(0);
  out[o + 1] = s(1);
  out[o + 2] = s(2);
  out[o + 3] = type === 6 ? s(3) : 255;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGBA8 pixels as a PNG file (no filtering: zlib does the work). */
export function encodePng(img: Rgba): Uint8Array {
  const { width, height, data } = img;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
