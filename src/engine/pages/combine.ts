// Combine Files and Split.

import type { PagesCtx } from "./context";
import {
  bookmark,
  bookmarkRange,
  firstPositions,
  remapOutline,
  targetPage,
  titleFromFileName,
  type Outline,
} from "./outline";
import { pageCountOf, readOutline, writeOutline } from "./outline-io";
import { QpdfError, runToFile } from "./qpdf";
import { allPages, toQpdfRange } from "./ranges";
import { cleanAfterRestructure, extractPages, range } from "./structure";

export interface CombineSource {
  /** File name, used for the per-file bookmark. */
  name: string;
  bytes: Uint8Array;
  /** 0-based pages to take, in order. All pages when omitted. */
  pages?: number[];
}

/**
 * Concatenates the sources. Form fields from every file are kept; clashing names are
 * renamed by qpdf ("taxpayer.name" -> "taxpayer+1.name") so values never cross-link.
 * Each file's bookmarks come along, optionally under one bookmark named after the file.
 */
export async function combine(
  ctx: PagesCtx,
  sources: CombineSource[],
  opts: { bookmarkPerFile?: boolean } = {},
): Promise<Uint8Array> {
  if (!sources.length) throw new QpdfError("add at least one file");
  const inputs: Record<string, Uint8Array> = {};
  const args = ["--empty", "--pages"];
  const outline: Outline = [];
  let offset = 0;
  for (const [i, s] of sources.entries()) {
    const name = `in${i}.pdf`;
    inputs[name] = s.bytes;
    const n = await pageCountOf(ctx.engine, s.bytes).catch(() => {
      throw new QpdfError(`${s.name} could not be read (it may be damaged or password-protected)`);
    });
    const pages = s.pages ?? allPages(n);
    if (!pages.length) continue;
    args.push(name, toQpdfRange(pages));
    const map = firstPositions(pages);
    const own = remapOutline(await readOutline(ctx.engine, s.bytes), (p) => {
      const at = map(p);
      return at === null ? null : offset + at;
    });
    if (opts.bookmarkPerFile) outline.push(bookmark(titleFromFileName(s.name), offset, own));
    else outline.push(...own);
    offset += pages.length;
  }
  if (!offset) throw new QpdfError("no pages selected");
  args.push("--", "out.pdf");
  const out = await cleanAfterRestructure(
    ctx,
    await runToFile(ctx.qpdf, { inputs, args, outputs: ["out.pdf"] }),
  );
  return outline.length ? writeOutline(ctx.engine, out, outline) : out;
}

export interface SplitPart {
  /** Suffix for the output file name, e.g. "Part 1" or a bookmark title. */
  label: string;
  pages: number[];
}

export function partsByCount(pageCount: number, perFile: number): SplitPart[] {
  if (!(perFile >= 1)) throw new RangeError("pages per file must be at least 1");
  const parts: SplitPart[] = [];
  for (let s = 0, k = 1; s < pageCount; s += perFile, k++) {
    parts.push({ label: `Part ${k}`, pages: range(s, Math.min(pageCount, s + perFile)) });
  }
  return parts;
}

/** One file per top-level bookmark; pages before the first bookmark join the first file. */
export function partsByBookmarks(outline: Outline, pageCount: number): SplitPart[] {
  const starts: { label: string; start: number }[] = [];
  outline.forEach((b, i) => {
    const r = bookmarkRange(outline, [i], pageCount);
    if (r && !starts.some((s) => s.start === r.start))
      starts.push({ label: b.title, start: r.start });
  });
  starts.sort((a, b) => a.start - b.start);
  if (!starts.length) throw new RangeError("the document has no top-level bookmarks with pages");
  return starts.map((s, i) => ({
    label: s.label,
    pages: range(i === 0 ? 0 : s.start, starts[i + 1]?.start ?? pageCount),
  }));
}

export interface SplitResult {
  label: string;
  pages: number[];
  bytes: Uint8Array;
  /** A single page that is already over the size limit (split by size only). */
  oversize?: boolean;
}

export async function splitParts(
  ctx: PagesCtx,
  bytes: Uint8Array,
  parts: SplitPart[],
): Promise<SplitResult[]> {
  const out: SplitResult[] = [];
  for (const p of parts) out.push({ ...p, bytes: await extractPages(ctx, bytes, p.pages) });
  return out;
}

/**
 * Greedy split by file size: each part takes as many following pages as fit under
 * `maxBytes` (found by doubling, then binary search). A page that alone is over the
 * limit becomes its own part, flagged `oversize`.
 */
export async function splitBySize(
  ctx: PagesCtx,
  bytes: Uint8Array,
  maxBytes: number,
): Promise<SplitResult[]> {
  const n = await pageCountOf(ctx.engine, bytes);
  const out: SplitResult[] = [];
  const cache = new Map<string, Uint8Array>();
  const sized = async (s: number, count: number) => {
    const key = `${s}:${count}`;
    let b = cache.get(key);
    if (!b) {
      b = await extractPages(ctx, bytes, range(s, s + count));
      cache.set(key, b);
    }
    return b;
  };
  let start = 0;
  while (start < n) {
    const left = n - start;
    let good = 0;
    let bad = left + 1;
    // Doubling: 1, 2, 4, ... until a part is too big or all pages fit.
    for (let c = 1; ; c = Math.min(left, c * 2)) {
      if ((await sized(start, c)).byteLength <= maxBytes) {
        good = c;
        if (c === left) break;
      } else {
        bad = c;
        break;
      }
    }
    while (bad - good > 1 && good < left) {
      const mid = Math.floor((good + bad) / 2);
      if ((await sized(start, mid)).byteLength <= maxBytes) good = mid;
      else bad = mid;
    }
    const count = Math.max(1, good);
    out.push({
      label: `Part ${out.length + 1}`,
      pages: range(start, start + count),
      bytes: await sized(start, count),
      ...(good === 0 ? { oversize: true } : {}),
    });
    start += count;
  }
  return out;
}

/** Keeps only bookmarks into `pages`, renumbered to the part. */
export function outlineForPart(outline: Outline, pages: number[]): Outline {
  return remapOutline(outline, firstPositions(pages));
}

export { targetPage };
