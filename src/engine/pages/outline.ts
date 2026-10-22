// Bookmark tree model. Pure functions over EmbedPDF's PdfBookmarkObject tree; reading
// and writing the PDF happens in outline-io.ts.
//
// A path addresses a node: [2, 0] = first child of the third top-level bookmark.

import {
  PdfActionType,
  PdfZoomMode,
  type PdfBookmarkObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from "@embedpdf/models";

export type Outline = PdfBookmarkObject[];
export type OutlinePath = number[];

export interface FlatNode {
  path: OutlinePath;
  depth: number;
  node: PdfBookmarkObject;
}

/** Page a bookmark jumps to, or null (no target, URL, other file, unknown). */
export function targetPage(b: PdfBookmarkObject): number | null {
  const d = destinationOf(b.target);
  return d && d.pageIndex >= 0 ? d.pageIndex : null;
}

function destinationOf(t: PdfLinkTarget | undefined): PdfDestinationObject | null {
  if (!t) return null;
  if (t.type === "destination") return t.destination;
  return t.action.type === PdfActionType.Goto ? t.action.destination : null;
}

/** Same target kind and view, different page. */
export function withPage(t: PdfLinkTarget | undefined, pageIndex: number): PdfLinkTarget {
  const d = destinationOf(t);
  const destination: PdfDestinationObject = d
    ? { ...d, pageIndex }
    : { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] };
  if (t?.type === "action" && t.action.type === PdfActionType.Goto) {
    return { type: "action", action: { type: PdfActionType.Goto, destination } };
  }
  return { type: "destination", destination };
}

/** Destination at a point on a page ("add bookmark from current view"). */
export function pageTarget(
  pageIndex: number,
  at?: { x: number; y: number; zoom: number },
): PdfLinkTarget {
  return {
    type: "destination",
    destination: at
      ? { pageIndex, zoom: { mode: PdfZoomMode.XYZ, params: at }, view: [] }
      : { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
  };
}

export function bookmark(
  title: string,
  pageIndex: number,
  children: Outline = [],
): PdfBookmarkObject {
  return { title, target: pageTarget(pageIndex), children };
}

/** Depth-first, document order. */
export function flatten(outline: Outline, base: OutlinePath = []): FlatNode[] {
  const out: FlatNode[] = [];
  outline.forEach((node, i) => {
    const path = [...base, i];
    out.push({ path, depth: path.length - 1, node });
    out.push(...flatten(node.children ?? [], path));
  });
  return out;
}

export function nodeAt(outline: Outline, path: OutlinePath): PdfBookmarkObject {
  let list = outline;
  let node: PdfBookmarkObject | undefined;
  for (const i of path) {
    node = list[i];
    if (!node) throw new RangeError(`no bookmark at ${path.join(".")}`);
    list = node.children ?? [];
  }
  if (!node) throw new RangeError("empty bookmark path");
  return node;
}

/** Returns a copy with `fn` applied to the child list at `parent` ([] = top level). */
function editList(outline: Outline, parent: OutlinePath, fn: (list: Outline) => Outline): Outline {
  if (!parent.length) return fn([...outline]);
  const [head, ...rest] = parent;
  return outline.map((n, i) =>
    i === head ? { ...n, children: editList(n.children ?? [], rest, fn) } : n,
  );
}

/** Parent path and index within it. */
function split(path: OutlinePath): [OutlinePath, number] {
  const index = path[path.length - 1];
  if (index === undefined) throw new RangeError("empty bookmark path");
  return [path.slice(0, -1), index];
}

export function removeAt(outline: Outline, path: OutlinePath): Outline {
  const [parent, index] = split(path);
  return editList(outline, parent, (l) => (l.splice(index, 1), l));
}

export function insertAt(
  outline: Outline,
  parent: OutlinePath,
  index: number,
  node: PdfBookmarkObject,
): Outline {
  return editList(outline, parent, (l) => (l.splice(Math.min(index, l.length), 0, node), l));
}

export function updateAt(
  outline: Outline,
  path: OutlinePath,
  fn: (n: PdfBookmarkObject) => PdfBookmarkObject,
): Outline {
  const [parent, index] = split(path);
  return editList(outline, parent, (l) => {
    const node = l[index];
    if (!node) throw new RangeError(`no bookmark at ${path.join(".")}`);
    l[index] = fn(node);
    return l;
  });
}

export function isAncestor(a: OutlinePath, b: OutlinePath): boolean {
  return a.length <= b.length && a.every((v, i) => b[i] === v);
}

/**
 * Moves a node (with its children) to `index` within `toParent`, where `toParent` and
 * `index` are given in the tree as it is BEFORE the move. Returns the new tree and the
 * node's new path.
 */
export function moveNode(
  outline: Outline,
  from: OutlinePath,
  toParent: OutlinePath,
  index: number,
): { outline: Outline; path: OutlinePath } {
  if (isAncestor(from, toParent)) throw new RangeError("cannot move a bookmark into itself");
  const node = nodeAt(outline, from);
  // Removing `from` shifts later siblings (and paths through them) up by one.
  const [fromParent, fromIndex] = split(from);
  const parent = [...toParent];
  const k = fromParent.length;
  const step = parent[k];
  if (isAncestor(fromParent, parent) && step !== undefined && step > fromIndex)
    parent[k] = step - 1;
  let i = index;
  if (
    fromParent.length === toParent.length &&
    isAncestor(fromParent, toParent) &&
    index > fromIndex
  )
    i--;
  const removed = removeAt(outline, from);
  return { outline: insertAt(removed, parent, i, node), path: [...parent, i] };
}

/** Last page a node or any of its descendants targets. */
function maxPage(node: PdfBookmarkObject): number | null {
  let best = targetPage(node);
  for (const c of node.children ?? []) {
    const p = maxPage(c);
    if (p !== null && (best === null || p > best)) best = p;
  }
  return best;
}

/**
 * Pages a bookmark "owns": from its page up to the page before the next bookmark at the
 * same or a higher level that points further into the document (the last page if there
 * is none). Extended to cover its descendants if they point further.
 */
export function bookmarkRange(
  outline: Outline,
  path: OutlinePath,
  pageCount: number,
): { start: number; end: number } | null {
  const node = nodeAt(outline, path);
  const start = targetPage(node) ?? firstDescendantPage(node);
  if (start === null) return null;
  const flat = flatten(outline);
  const at = flat.findIndex((f) => samePath(f.path, path));
  const depth = path.length - 1;
  let end = pageCount - 1;
  for (const f of flat.slice(at + 1)) {
    if (f.depth > depth) continue;
    const p = targetPage(f.node);
    if (p !== null && p > start) {
      end = p - 1;
      break;
    }
  }
  const deepest = maxPage(node);
  if (deepest !== null && deepest > end) end = deepest;
  return { start, end };
}

function firstDescendantPage(node: PdfBookmarkObject): number | null {
  for (const c of node.children ?? []) {
    const p = targetPage(c) ?? firstDescendantPage(c);
    if (p !== null) return p;
  }
  return null;
}

export function samePath(a: OutlinePath, b: OutlinePath): boolean {
  return a.length === b.length && a.every((v, i) => b[i] === v);
}

/**
 * Re-points every bookmark through `map` (old page index -> new index, or null when the
 * page is gone). A bookmark whose page is gone keeps its place if it still has children
 * (it then targets its first surviving child's page); otherwise it is dropped.
 * Bookmarks without a page target (URLs, other files) are kept as they are.
 */
export function remapOutline(outline: Outline, map: (old: number) => number | null): Outline {
  const out: Outline = [];
  for (const node of outline) {
    const children = remapOutline(node.children ?? [], map);
    const old = targetPage(node);
    if (old === null) {
      out.push({ ...node, children });
      continue;
    }
    const now = map(old);
    if (now !== null) {
      out.push({ ...node, target: withPage(node.target, now), children });
      continue;
    }
    const firstChild = children
      .map((c) => targetPage(c) ?? firstDescendantPage(c))
      .find((p) => p !== null);
    if (firstChild !== undefined && firstChild !== null) {
      out.push({ ...node, target: withPage(node.target, firstChild), children });
    } else if (children.length) {
      out.push({ ...node, target: undefined, children });
    }
  }
  return out;
}

/** True when some bookmark targets a page `map` drops. */
export function hasDanglingTargets(outline: Outline, map: (old: number) => number | null): boolean {
  return flatten(outline).some((f) => {
    const p = targetPage(f.node);
    return p !== null && map(p) === null;
  });
}

/**
 * Drops targets PDFium cannot write back (links to other files, unsupported actions) so
 * saving the tree never fails; the bookmark itself is kept.
 */
export function writable(outline: Outline): Outline {
  return outline.map((n) => {
    const t = n.target;
    const ok =
      !t ||
      t.type === "destination" ||
      t.action.type === PdfActionType.Goto ||
      t.action.type === PdfActionType.URI ||
      t.action.type === PdfActionType.LaunchAppOrOpenFile;
    const target = ok && t && destinationOf(t)?.pageIndex === -1 ? undefined : ok ? t : undefined;
    return { title: n.title, target, children: writable(n.children ?? []) };
  });
}

/** Old index -> first new position, from a new page order of old indices. */
export function firstPositions(order: (number | null)[]): (old: number) => number | null {
  const pos = new Map<number, number>();
  order.forEach((old, i) => {
    if (old !== null && !pos.has(old)) pos.set(old, i);
  });
  return (old) => pos.get(old) ?? null;
}

/** "Page 1" .. "Page N" (or page labels when given). */
export function perPageOutline(pageCount: number, labels?: (string | null)[]): Outline {
  return Array.from({ length: pageCount }, (_, i) =>
    bookmark(labels?.[i] ? `Page ${labels[i]}` : `Page ${i + 1}`, i),
  );
}

/** "Return 2025.pdf" -> "Return 2025". */
export function titleFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[a-z0-9]{1,5}$/i, "") || base;
}
