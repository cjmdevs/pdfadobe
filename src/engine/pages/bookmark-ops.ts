// Page operations driven by the bookmark panel: delete a bookmark with its pages,
// extract its pages, and drag a bookmark to move its pages (and child bookmarks).

import type { PagesCtx } from "./context";
import {
  bookmarkRange,
  firstPositions,
  flatten,
  moveNode,
  nodeAt,
  remapOutline,
  removeAt,
  targetPage,
  type Outline,
  type OutlinePath,
} from "./outline";
import { pageCountOf, readOutline } from "./outline-io";
import { QpdfError } from "./qpdf";
import { assemble, range, selfPlan } from "./structure";

async function rangeOf(ctx: PagesCtx, bytes: Uint8Array, path: OutlinePath) {
  const outline = await readOutline(ctx.engine, bytes);
  const n = await pageCountOf(ctx.engine, bytes);
  const r = bookmarkRange(outline, path, n);
  if (!r) throw new QpdfError("This bookmark does not point to a page in this document.");
  return { outline, n, ...r };
}

/** Pages a bookmark owns (for confirmations like "Delete 4 pages?"). */
export async function bookmarkPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  path: OutlinePath,
): Promise<number[]> {
  const r = await rangeOf(ctx, bytes, path);
  return range(r.start, r.end + 1);
}

export async function deleteBookmarkWithPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  path: OutlinePath,
): Promise<Uint8Array> {
  const { outline, n, start, end } = await rangeOf(ctx, bytes, path);
  const keep = range(0, n).filter((i) => i < start || i > end);
  if (!keep.length)
    throw new QpdfError("This bookmark covers every page; a PDF must keep at least one.");
  const map = firstPositions(keep);
  return assemble(ctx, bytes, selfPlan(keep), {
    outline: remapOutline(removeAt(outline, path), map),
  });
}

/** A new document with the bookmark's pages; the bookmark and its children come along. */
export async function extractBookmarkPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  path: OutlinePath,
): Promise<Uint8Array> {
  const { outline, start, end } = await rangeOf(ctx, bytes, path);
  const pages = range(start, end + 1);
  const sub = remapOutline([nodeAt(outline, path)], firstPositions(pages));
  return assemble(ctx, bytes, selfPlan(pages), { outline: sub });
}

/**
 * Drops the bookmark at `from` into `toParent` at `index` (both as the tree is before
 * the move). Its pages move with it: they go before the pages of the bookmark that now
 * follows it, or to the end if nothing follows. Child bookmarks move too.
 */
export async function moveBookmarkWithPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  from: OutlinePath,
  toParent: OutlinePath,
  index: number,
): Promise<Uint8Array> {
  const { outline, n, start, end } = await rangeOf(ctx, bytes, from);
  const moved = moveNode(outline, from, toParent, index);
  const inRange = (p: number) => p >= start && p <= end;
  // First bookmark after the moved subtree (in the new tree) that points outside it.
  const flat = flatten(moved.outline);
  const at = flat.findIndex(
    (f) => f.path.length === moved.path.length && f.path.every((v, i) => v === moved.path[i]),
  );
  let before: number | null = null;
  for (const f of flat.slice(at + 1)) {
    if (
      f.path.length > moved.path.length &&
      f.path.slice(0, moved.path.length).every((v, i) => v === moved.path[i])
    ) {
      continue; // its own children
    }
    const p = targetPage(f.node);
    if (p !== null && !inRange(p)) {
      before = p;
      break;
    }
  }
  const rest = range(0, n).filter((i) => !inRange(i));
  const pos = before === null ? rest.length : rest.indexOf(before);
  const order = [...rest.slice(0, pos), ...range(start, end + 1), ...rest.slice(pos)];
  return assemble(ctx, bytes, selfPlan(order), {
    outline: remapOutline(moved.outline, firstPositions(order)),
  });
}

export type { Outline };
