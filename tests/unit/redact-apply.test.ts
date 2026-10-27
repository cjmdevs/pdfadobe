// Phase 5 stage 2: clipping geometry and applying redactions to page content.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb, LineCapStyle } from "pdf-lib";
import { createPdfium, type PdfiumModule } from "../../src/engine/pdfium";
import { RawDoc } from "../../src/engine/pages/raw";
import { fillOutside, strokeOutside, type SubPath } from "../../src/engine/redact/clip";
import { DEFAULT_OVERLAY, redactContent } from "../../src/engine/redact/apply";
import { renderPage, type Render } from "../helpers/edit-render";

const require = createRequire(import.meta.url);
let m: PdfiumModule;

beforeAll(async () => {
  m = (await createPdfium(readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm")))).module;
});

const rectPath = (l: number, b: number, r: number, t: number): SubPath => ({
  start: { x: l, y: b },
  segs: [
    { kind: "line", to: { x: r, y: b } },
    { kind: "line", to: { x: r, y: t } },
    { kind: "line", to: { x: l, y: t } },
  ],
  closed: true,
});

const polyArea = (sp: SubPath) => {
  const p = [sp.start, ...sp.segs.map((s) => s.to)];
  let a = 0;
  p.forEach((q, i) => {
    const n = p[(i + 1) % p.length]!;
    a += q.x * n.y - n.x * q.y;
  });
  return Math.abs(a / 2);
};

describe("clip geometry", () => {
  it("a fill loses exactly the part inside the box", () => {
    const out = fillOutside([rectPath(0, 0, 100, 10)], { l: 40, b: -5, r: 60, t: 15 });
    expect(out.reduce((s, sp) => s + polyArea(sp), 0)).toBeCloseTo(800);
  });

  it("subpaths away from the box are kept as they were (curves too)", () => {
    const far: SubPath = {
      start: { x: 200, y: 0 },
      segs: [{ kind: "curve", c1: { x: 210, y: 10 }, c2: { x: 220, y: 10 }, to: { x: 230, y: 0 } }],
      closed: false,
    };
    expect(fillOutside([far], { l: 0, b: 0, r: 10, t: 10 })).toEqual([far]);
    expect(strokeOutside([far], { l: 0, b: 0, r: 10, t: 10 })).toEqual([{ ...far, dashOffset: 0 }]);
  });

  it("a stroke is cut into the pieces outside the box", () => {
    const line: SubPath = {
      start: { x: 0, y: 5 },
      segs: [{ kind: "line", to: { x: 100, y: 5 } }],
      closed: false,
    };
    const out = strokeOutside([line], { l: 40, b: 0, r: 60, t: 10 });
    expect(out.map((sp) => [sp.start.x, sp.segs.at(-1)?.to.x])).toEqual([
      [0, 40],
      [60, 100],
    ]);
    // The second piece starts 60 pt along the line, so a dash pattern carries on.
    expect(out.map((sp) => sp.dashOffset)).toEqual([0, 60]);
  });

  it("a frame around the box (box in the gap) is left alone", () => {
    const frame = rectPath(0, 0, 100, 100);
    expect(strokeOutside([frame], { l: 40, b: 40, r: 60, t: 60 })).toEqual([
      { ...frame, dashOffset: 0 },
    ]);
  });
});

// Box over: a text line, a form XObject, half a JPEG, a whole PNG, a red bar sticking
// out, a dashed line and a circle crossing the edge.
const BOX = { l: 60, b: 500, r: 300, t: 760 };

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const src = await PDFDocument.create();
  const sp = src.addPage([200, 60]);
  sp.drawText("FORM-SECRET", {
    x: 10,
    y: 20,
    size: 14,
    font: await src.embedFont(StandardFonts.Helvetica),
  });
  const [form] = await doc.embedPdf(await src.save());
  const p = doc.addPage([612, 792]);
  p.drawText("PAGE-SECRET 000-12-3456", { x: 80, y: 740, size: 14, font });
  p.drawPage(form!, { x: 80, y: 680 });
  const jpg = await doc.embedJpg(readFileSync("tests/corpus/fixtures/photo-rgb.jpg"));
  p.drawImage(jpg, { x: 200, y: 600, width: 200, height: 60 });
  p.drawImage(jpg, { x: 80, y: 560, width: 60, height: 30 });
  p.drawRectangle({ x: 250, y: 520, width: 200, height: 20, color: rgb(0.8, 0, 0) });
  p.drawLine({
    start: { x: 20, y: 510 },
    end: { x: 400, y: 510 },
    thickness: 2,
    color: rgb(0, 0, 0),
    dashArray: [6, 3],
    lineCap: LineCapStyle.Butt,
  });
  p.drawCircle({ x: 300, y: 620, size: 30, borderColor: rgb(0, 0, 1), borderWidth: 1.5 });
  p.drawText("OUTSIDE", { x: 400, y: 740, size: 14, font });
  return doc.save();
}

function pageText(bytes: Uint8Array): string {
  const doc = RawDoc.open(m, bytes);
  try {
    return doc.withPage(0, (page) => {
      const tp = m.FPDFText_LoadPage(page);
      let s = "";
      for (let i = 0; i < m.FPDFText_CountChars(tp); i++)
        s += String.fromCodePoint(m.FPDFText_GetUnicode(tp, i));
      m.FPDFText_ClosePage(tp);
      return s;
    });
  } finally {
    doc.close();
  }
}

function render(bytes: Uint8Array): Render {
  const doc = RawDoc.open(m, bytes);
  try {
    return renderPage(m, doc, 0, 2);
  } finally {
    doc.close();
  }
}

/** Pixels outside `keep` that differ by more than anti-aliasing (curves are re-split). */
function changedOutside(a: Render, b: Render, keep: typeof BOX): number {
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    const py = (a.height - y) / a.scale;
    for (let x = 0; x < a.width; x++) {
      const px = x / a.scale;
      if (px >= keep.l && px <= keep.r && py >= keep.b && py <= keep.t) continue;
      const i = (y * a.width + x) * 4;
      const d = [0, 1, 2].reduce((s, k) => s + Math.abs(a.data[i + k]! - b.data[i + k]!), 0);
      if (d > 24) n++;
    }
  }
  return n;
}

/** Pixels inside `r` (shrunk by 1 pt for anti-aliasing) that are not `rgb`. */
function offColour(img: Render, r: typeof BOX, rgb: number[]): number {
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    const py = (img.height - y) / img.scale;
    if (py < r.b + 1 || py > r.t - 1) continue;
    for (let x = 0; x < img.width; x++) {
      const px = x / img.scale;
      if (px < r.l + 1 || px > r.r - 1) continue;
      const i = (y * img.width + x) * 4;
      if (
        Math.abs(img.data[i]! - rgb[0]!) +
          Math.abs(img.data[i + 1]! - rgb[1]!) +
          Math.abs(img.data[i + 2]! - rgb[2]!) >
        6
      )
        n++;
    }
  }
  return n;
}

describe("redactContent", () => {
  let original: Uint8Array;
  beforeAll(async () => {
    original = await fixture();
  });

  it("nothing is left under the box (no overlay: the box area renders white)", () => {
    const { bytes, report } = redactContent(m, original, [{ pageIndex: 0, rects: [BOX] }], {
      ...DEFAULT_OVERLAY,
      fill: null,
    });
    expect(pageText(bytes)).not.toMatch(/SECRET|3456/);
    expect(pageText(bytes)).toContain("OUTSIDE");
    expect(offColour(render(bytes), BOX, [255, 255, 255])).toBe(0);
    expect(report.imagesRemoved).toBe(1);
    expect(report.pathsClipped).toBeGreaterThanOrEqual(3);
    expect(report.pathsRemovedWhole).toEqual([]);
    expect(report.removedText[0]?.text).toContain("000-12-3456");
  });

  it("outside the box the page looks the same", () => {
    const { bytes } = redactContent(m, original, [{ pageIndex: 0, rects: [BOX] }]);
    const before = render(original);
    const after = render(bytes);
    // 2 pt margin for anti-aliasing along the cut edges and the flattened circle.
    const keep = { l: BOX.l - 2, b: BOX.b - 2, r: BOX.r + 2, t: BOX.t + 2 };
    expect(changedOutside(before, after, keep)).toBe(0);
    expect(offColour(after, BOX, [0, 0, 0])).toBe(0);
  });

  it("overlay text is drawn into the box (once, or repeated)", () => {
    const small = { l: 60, b: 500, r: 300, t: 520 };
    const once = redactContent(m, original, [{ pageIndex: 0, rects: [small] }], {
      ...DEFAULT_OVERLAY,
      text: "Redacted",
    });
    expect(pageText(once.bytes).match(/Redacted/g)).toHaveLength(1);
    const many = redactContent(m, original, [{ pageIndex: 0, rects: [BOX] }], {
      ...DEFAULT_OVERLAY,
      text: "Redacted",
      repeat: true,
    });
    expect(pageText(many.bytes).match(/Redacted/g)!.length).toBeGreaterThan(10);
  });
});
