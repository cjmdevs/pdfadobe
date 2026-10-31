// Signature pictures (Phase 8): a typed name in a script font, a drawing, or an imported
// image with its paper background removed. Each ends as a tightly cropped PNG with a
// transparent background. The fonts are bundled (@fontsource, OFL-1.1): no downloads.
import "@fontsource/dancing-script/400.css";
import "@fontsource/great-vibes/400.css";
import "@fontsource/allura/400.css";
import "@fontsource/caveat/400.css";

export const SCRIPT_FONTS = [
  { id: "dancing", label: "Dancing Script", family: "'Dancing Script'" },
  { id: "vibes", label: "Great Vibes", family: "'Great Vibes'" },
  { id: "allura", label: "Allura", family: "Allura" },
  { id: "caveat", label: "Caveat", family: "Caveat" },
] as const;

export type ScriptFont = (typeof SCRIPT_FONTS)[number]["id"];

export const INK = "#0b1f4d";

const familyOf = (f: ScriptFont) => SCRIPT_FONTS.find((x) => x.id === f)?.family ?? "cursive";

/** A typed name drawn in `font`, as a cropped PNG. */
export async function typedSignature(text: string, font: ScriptFont): Promise<Uint8Array> {
  const px = 120;
  const css = `${px}px ${familyOf(font)}`;
  await document.fonts.load(css, text);
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("drawing is not available");
  probe.font = css;
  const w = Math.ceil(probe.measureText(text).width + px);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = Math.ceil(px * 1.8);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("drawing is not available");
  ctx.font = css;
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText(text, px / 2, canvas.height / 2);
  return cropToPng(canvas);
}

/** Pixels lighter than this (0-255) count as paper when importing an image. */
const PAPER = 215;

/** An image file made transparent where it is paper-white, then cropped. */
export async function imageSignature(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = bytes.slice();
  const bitmap = await createImageBitmap(new Blob([copy.buffer]));
  // Keep it a sensible size: signatures do not need camera resolution.
  const k = Math.min(1, 1600 / bitmap.width, 800 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("drawing is not available");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
    if (lum >= PAPER) d[i + 3] = 0;
    // Soft edge between ink and paper.
    else if (lum > PAPER - 40)
      d[i + 3] = Math.round((((d[i + 3] ?? 255) * (PAPER - lum)) / 40) | 0);
  }
  ctx.putImageData(img, 0, 0);
  return cropToPng(canvas);
}

/** The canvas cropped to its non-transparent pixels (plus a small margin), as PNG. */
export async function cropToPng(src: HTMLCanvasElement): Promise<Uint8Array> {
  const ctx = src.getContext("2d");
  if (!ctx) throw new Error("drawing is not available");
  const { width, height } = src;
  const d = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((d[(y * width + x) * 4 + 3] ?? 0) > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error("the signature is empty");
  const m = 4;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(width - 1, x1 + m);
  y1 = Math.min(height - 1, y1 + m);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")?.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
  if (!blob) throw new Error("the signature could not be saved as an image");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Size of a PNG in pixels (IHDR). */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}
