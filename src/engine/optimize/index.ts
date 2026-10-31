// Reduce File Size (Phase 7). Three presets: images resampled and stored as JPEG
// (images.ts), fully embedded TrueType fonts subset (fonts.ts), then one qpdf pass that
// drops unused objects and resources, recompresses and packs objects into object
// streams, then linearizes (fast web view) unless that makes the file bigger than the
// original (its hint tables cost ~0.3 KB a page). The input bytes are never changed:
// the caller saves the result as a new file.

import type { PdfiumModule } from "../pdfium";
import { runToFile, type Qpdf } from "../pages/qpdf";
import { PdfObjects } from "../redact/objects";
import type { GlyphSubsetter } from "../edit/fonts/subset";
import { optimizeImages, type ImagePreset, type ImageReport } from "./images";
import { subsetFonts } from "./fonts";

export type OptimizePresetId = "email" | "standard" | "archive";

export const OPTIMIZE_PRESETS: Record<
  OptimizePresetId,
  ImagePreset & { label: string; description: string }
> = {
  email: {
    label: "Email",
    description: "Smallest file: images at 100 dpi, lower JPEG quality",
    dpi: 100,
    quality: 50,
  },
  standard: {
    label: "Standard",
    description: "Images at 150 dpi, good quality for reading and printing drafts",
    dpi: 150,
    quality: 70,
  },
  archive: {
    label: "Archive",
    description: "Images at 300 dpi, high quality; mostly removes waste",
    dpi: 300,
    quality: 85,
  },
};

export interface OptimizeReport extends ImageReport {
  bytes: Uint8Array;
  before: number;
  after: number;
  fontsSubset: number;
  /** Fast web view: false when linearizing would have made the file bigger. */
  linearized: boolean;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

export async function optimizeDocument(
  m: PdfiumModule,
  qpdf: Qpdf,
  subsetter: GlyphSubsetter,
  bytes: Uint8Array,
  preset: OptimizePresetId,
): Promise<OptimizeReport> {
  const objs = await PdfObjects.read(qpdf, bytes);
  const images = await optimizeImages(m, qpdf, objs, bytes, OPTIMIZE_PRESETS[preset]);
  const fonts = await subsetFonts(qpdf, objs, bytes, subsetter);
  const edited = objs.hasChanges ? "edit.json" : null;
  const packed = await runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, ...(edited ? { "edit.json": utf8(objs.updateJson()) } : {}) },
    args: [
      "in0.pdf",
      ...(edited ? [`--update-from-json=${edited}`] : []),
      "--remove-unreferenced-resources=yes",
      "--object-streams=generate",
      "--recompress-flate",
      "--compression-level=9",
      "out.pdf",
    ],
    outputs: ["out.pdf"],
  });
  const linear = await runToFile(qpdf, {
    inputs: { "in0.pdf": packed },
    args: ["in0.pdf", "--object-streams=preserve", "--linearize", "out.pdf"],
    outputs: ["out.pdf"],
  });
  const linearized = linear.length < bytes.length;
  const out = linearized ? linear : packed;
  return {
    bytes: out,
    before: bytes.length,
    after: out.length,
    fontsSubset: fonts.subset,
    linearized,
    ...images,
  };
}
