// Independent view of a PDF's annotations, read with qpdf's JSON (no PDFium code).
// Used to check that markup written by PDFium is standard PDF that other readers see.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qpdfBin } from "../corpus/generate.mjs";

/** One annotation dictionary as qpdf sees it. Names keep their slash ("/Square"). */
export interface RawAnnot {
  page: number;
  ref: string;
  subtype: string;
  /** PDF user space, bottom-left origin: [x0, y0, x1, y1]. */
  rect: number[];
  contents: string | null;
  author: string | null;
  subject: string | null;
  /** /C and /IC as 0..1 numbers, or null when absent. */
  color: number[] | null;
  interior: number[] | null;
  flags: number;
  hasAppearance: boolean;
  /** The whole dictionary, values as qpdf JSON v2 writes them. */
  dict: Record<string, unknown>;
}

type QpdfObjects = Record<string, { value?: unknown; stream?: { dict: unknown } }>;

export function inspectAnnots(bytes: Uint8Array): RawAnnot[] {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-annots-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, bytes);
    const json = JSON.parse(
      execFileSync(qpdfBin(), ["--json=2", "--json-key=pages", "--json-key=qpdf", file], {
        maxBuffer: 256 * 1024 * 1024,
        encoding: "utf8",
      }),
    ) as { pages: { object: string }[]; qpdf: [unknown, QpdfObjects] };
    const objects = json.qpdf[1];
    const get = (ref: unknown): unknown => {
      if (typeof ref !== "string" || !/^\d+ \d+ R$/.test(ref)) return ref;
      const o = objects[`obj:${ref}`];
      return o?.value ?? o?.stream?.dict;
    };
    const out: RawAnnot[] = [];
    json.pages.forEach((p, i) => {
      const page = get(p.object) as Record<string, unknown>;
      const annots = (get(page["/Annots"]) as unknown[] | undefined) ?? [];
      for (const ref of annots) {
        const d = get(ref) as Record<string, unknown>;
        const nums = (v: unknown) =>
          Array.isArray(get(v)) ? (get(v) as number[]).map(Number) : null;
        out.push({
          page: i,
          ref: String(ref),
          subtype: String(d["/Subtype"]),
          rect: nums(d["/Rect"]) ?? [],
          contents: text(get(d["/Contents"])),
          author: text(get(d["/T"])),
          subject: text(get(d["/Subj"])),
          color: nums(d["/C"]),
          interior: nums(d["/IC"]),
          flags: Number(get(d["/F"]) ?? 0),
          hasAppearance: d["/AP"] !== undefined,
          dict: d,
        });
      }
    });
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** qpdf JSON v2 strings: "u:text" (Unicode) or "b:hex" (binary). */
export function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (v.startsWith("u:")) return v.slice(2);
  if (v.startsWith("b:")) return Buffer.from(v.slice(2), "hex").toString("latin1");
  return v;
}

/** "#rrggbb" -> [r, g, b] in 0..1, for comparing with /C and /IC. */
export function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
}
