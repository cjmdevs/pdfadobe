// Phase 5 pre-check: does an area redaction over a scanned (image-only) page remove
// the pixels under the box, or only paint a box on top? Judged on the image stream
// itself (qpdf decodes it), not on a render, because a render shows the black box
// either way.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR, qpdfBin } from "../corpus/generate.mjs";
import { nodeEngine, toArrayBuffer } from "../helpers/pdfium-node";
import type { Engine } from "../../src/engine/pdfium";
import { fromPdfRect, redact, save } from "../../src/engine/spike";

// The scan is 612x792 pt at 200 dpi. Samples are read from the first channel.
const DPI = 200;
// A band across the top of the page where text-1p's text sits (PDF points).
const BOX = { x: 36, y: 600, width: 540, height: 170 };

interface Gray {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

/** Decoded pixels of the largest image XObject in the file (qpdf JSON v2). */
function largestImage(bytes: Uint8Array): Gray {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-scan-"));
  try {
    const inp = join(dir, "in.pdf");
    writeFileSync(inp, bytes);
    const json = execFileSync(
      qpdfBin(),
      ["--json=2", "--json-key=qpdf", "--json-stream-data=inline", "--decode-level=all", inp],
      { maxBuffer: 1 << 30 },
    ).toString();
    const objects = (JSON.parse(json) as { qpdf: [unknown, Record<string, unknown>] }).qpdf[1];
    let best: Gray | null = null;
    for (const v of Object.values(objects)) {
      const s = (v as { stream?: { dict: Record<string, unknown>; data?: string } }).stream;
      if (!s || s.dict["/Subtype"] !== "/Image" || !s.data) continue;
      const width = Number(s.dict["/Width"]);
      const height = Number(s.dict["/Height"]);
      if (!best || width * height > best.width * best.height) {
        const data = Buffer.from(s.data, "base64");
        best = { width, height, channels: data.length / (width * height), data };
      }
    }
    if (!best) throw new Error("no image XObject");
    return best;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Dark pixels (< 128) inside BOX, in image space. */
function darkInBox(img: Gray): number {
  const k = DPI / 72;
  const x0 = Math.round(BOX.x * k);
  const x1 = Math.round((BOX.x + BOX.width) * k);
  const r0 = Math.round((792 - BOX.y - BOX.height) * k);
  const r1 = Math.round((792 - BOX.y) * k);
  let n = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = x0; c < x1; c++)
      if ((img.data[(r * img.width + c) * img.channels] ?? 255) < 128) n++;
  }
  return n;
}

let engine: Engine;
let before: Gray;
let after: Gray;

beforeAll(async () => {
  engine = await nodeEngine();
  const original = new Uint8Array(readFileSync(join(OUT_DIR, "scanned-image-only.pdf")));
  before = largestImage(original);
  const doc = await engine
    .openDocumentBuffer({ id: "scan", content: toArrayBuffer(original) })
    .toPromise();
  await redact(engine, doc, { areas: [{ pageIndex: 0, rect: fromPdfRect(doc, 0, BOX) }] });
  after = largestImage(new Uint8Array(await save(engine, doc)));
  await engine.closeDocument(doc).toPromise();
});

afterAll(async () => {
  await engine.closeAllDocuments().toPromise();
});

describe("area redaction over a scanned page", () => {
  it("the scan has dark (text) pixels under the box before redaction", () => {
    expect(Number.isInteger(before.channels)).toBe(true);
    expect(after.width).toBe(before.width);
    expect(darkInBox(before)).toBeGreaterThan(1000);
  });

  it("pixels under the box are gone from the image stream after redaction", () => {
    expect(darkInBox(after)).toBe(0);
  });
});
