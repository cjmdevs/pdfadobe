// Operations that add, remove or reorder pages. All of them go through one qpdf
// --pages run with the document itself as the primary input, so form fields,
// annotations, page labels and document-level data come along; bookmarks follow their
// pages. Afterwards the bookmark tree is rewritten only when it has to change.

import type { PagesCtx, PageRef } from "./context";
import { firstPositions, hasDanglingTargets, remapOutline, type Outline } from "./outline";
import { pageCountOf, readOutline, writeOutline } from "./outline-io";
import { QpdfError, runToFile } from "./qpdf";
import { toQpdfRange } from "./ranges";

export interface AssembleOptions {
  /** Other files the plan takes pages from (PageRef.file 1, 2, ...). */
  extra?: Uint8Array[];
  /**
   * The bookmark tree for the result, already in new page numbers. When omitted, the
   * document's own tree is kept and only bookmarks to removed pages are fixed.
   */
  outline?: Outline;
}

const inputName = (file: number) => `in${file}.pdf`;

/** qpdf `--pages` arguments for a plan: runs of the same file share one page spec. */
export function pagesArgs(plan: PageRef[]): string[] {
  const runs: { file: number; pages: number[] }[] = [];
  for (const r of plan) {
    const last = runs[runs.length - 1];
    if (last?.file === r.file) last.pages.push(r.page);
    else runs.push({ file: r.file, pages: [r.page] });
  }
  return runs.flatMap((r) => [r.file === 0 ? "." : inputName(r.file), toQpdfRange(r.pages)]);
}

export async function assemble(
  ctx: PagesCtx,
  base: Uint8Array,
  plan: PageRef[],
  opts: AssembleOptions = {},
): Promise<Uint8Array> {
  if (!plan.length) throw new QpdfError("a PDF must keep at least one page");
  const inputs: Record<string, Uint8Array> = { [inputName(0)]: base };
  (opts.extra ?? []).forEach((b, i) => (inputs[inputName(i + 1)] = b));
  let out = await runToFile(ctx.qpdf, {
    inputs,
    args: [inputName(0), "--pages", ...pagesArgs(plan), "--", "out.pdf"],
    outputs: ["out.pdf"],
  });
  out = await cleanAfterRestructure(ctx, out);
  if (opts.outline) return writeOutline(ctx.engine, out, opts.outline);
  const old = await readOutline(ctx.engine, base);
  const map = firstPositions(plan.map((r) => (r.file === 0 ? r.page : null)));
  if (hasDanglingTargets(old, map)) return writeOutline(ctx.engine, out, remapOutline(old, map));
  return out;
}

/** Self-pages plan from old indices. */
export function selfPlan(indices: number[]): PageRef[] {
  return indices.map((page) => ({ file: 0, page }));
}

/** Moves `indices` (in the given order) so they start before old page `before` (or to the end when null). */
export function moveOrder(pageCount: number, indices: number[], before: number | null): number[] {
  const moving = new Set(indices);
  const rest = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !moving.has(i));
  let at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0 && before !== null) {
    // `before` is itself being moved: insert where the first later unmoved page is.
    const next = rest.findIndex((i) => i > before);
    at = next < 0 ? rest.length : next;
  }
  return [...rest.slice(0, at), ...indices, ...rest.slice(at)];
}

export async function movePages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  indices: number[],
  before: number | null,
): Promise<Uint8Array> {
  const n = await pageCountOf(ctx.engine, bytes);
  return assemble(ctx, bytes, selfPlan(moveOrder(n, indices, before)));
}

/** Any new order of old indices (drag-and-drop in the Organize grid). */
export async function reorderPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  order: number[],
): Promise<Uint8Array> {
  return assemble(ctx, bytes, selfPlan(order));
}

export async function deletePages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const n = await pageCountOf(ctx.engine, bytes);
  const gone = new Set(indices);
  const keep = Array.from({ length: n }, (_, i) => i).filter((i) => !gone.has(i));
  if (!keep.length) throw new QpdfError("You cannot delete every page of a PDF.");
  return assemble(ctx, bytes, selfPlan(keep));
}

/** Copies of the selected pages go right after the last selected page. */
export async function duplicatePages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const n = await pageCountOf(ctx.engine, bytes);
  const sorted = [...indices].sort((a, b) => a - b);
  const last = sorted[sorted.length - 1] ?? n - 1;
  const order = Array.from({ length: n }, (_, i) => i);
  order.splice(last + 1, 0, ...sorted);
  return assemble(ctx, bytes, selfPlan(order));
}

/** A new document with only these pages (bookmarks into them are kept). */
export async function extractPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  indices: number[],
  outline?: Outline,
): Promise<Uint8Array> {
  return assemble(ctx, bytes, selfPlan(indices), outline ? { outline } : {});
}

/**
 * Inserts `otherPages` of `other` before page `at` (or at the end when `at` equals the
 * page count). The other file's bookmarks come along, placed among the document's
 * top-level bookmarks by page.
 */
export async function insertPages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  other: Uint8Array,
  otherPages: number[],
  at: number,
): Promise<Uint8Array> {
  const n = await pageCountOf(ctx.engine, bytes);
  const plan: PageRef[] = [
    ...selfPlan(range(0, at)),
    ...otherPages.map((page) => ({ file: 1, page })),
    ...selfPlan(range(at, n)),
  ];
  const own = remapOutline(await readOutline(ctx.engine, bytes), (p) =>
    p < at ? p : p + otherPages.length,
  );
  const theirs = remapOutline(await readOutline(ctx.engine, other), (p) => {
    const i = otherPages.indexOf(p);
    return i < 0 ? null : at + i;
  });
  return assemble(ctx, bytes, plan, { extra: [other], outline: mergeTopLevel(own, theirs) });
}

/**
 * Replaces the pages `targets` (in order) with `otherPages` of `other`, one for one.
 * Bookmarks that pointed at a replaced page now point at its replacement.
 */
export async function replacePages(
  ctx: PagesCtx,
  bytes: Uint8Array,
  targets: number[],
  other: Uint8Array,
  otherPages: number[],
): Promise<Uint8Array> {
  if (targets.length !== otherPages.length) {
    throw new QpdfError(
      `Choose the same number of pages to replace (${targets.length}) and to insert (${otherPages.length}).`,
    );
  }
  const n = await pageCountOf(ctx.engine, bytes);
  const replacement = new Map(targets.map((t, i) => [t, otherPages[i] ?? 0]));
  const plan: PageRef[] = range(0, n).map((page) => {
    const theirs = replacement.get(page);
    return theirs === undefined ? { file: 0, page } : { file: 1, page: theirs };
  });
  const outline = await readOutline(ctx.engine, bytes);
  return assemble(ctx, bytes, plan, { extra: [other], outline });
}

/** Insert `theirs` among `own` top-level nodes, keeping top-level page order. */
function mergeTopLevel(own: Outline, theirs: Outline): Outline {
  if (!theirs.length) return own;
  const first = pageOfTree(theirs);
  const at = own.findIndex((b) => {
    const p = pageOfTree([b]);
    return p !== null && first !== null && p > first;
  });
  const out = [...own];
  out.splice(at < 0 ? out.length : at, 0, ...theirs);
  return out;
}

function pageOfTree(outline: Outline): number | null {
  for (const b of outline) {
    const d = b.target;
    const dest =
      d?.type === "destination"
        ? d.destination
        : d?.type === "action" && "destination" in d.action
          ? d.action.destination
          : null;
    if (dest && dest.pageIndex >= 0) return dest.pageIndex;
    const c = pageOfTree(b.children ?? []);
    if (c !== null) return c;
  }
  return null;
}

export function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/**
 * After pages change, two things in fillable government forms go stale:
 * - /XFA (the form's XML twin). Viewers that prefer XFA would show the old pages/values.
 * - /Perms (Adobe "Reader extensions" usage-rights signature). It no longer verifies,
 *   and Reader then warns that the document was changed.
 * Both are removed with qpdf's JSON update (an exact object edit, nothing else changes).
 */
export async function cleanAfterRestructure(ctx: PagesCtx, bytes: Uint8Array): Promise<Uint8Array> {
  // Read only the objects involved (trailer -> catalog -> AcroForm), not the whole file.
  const objects = async (ids: string[]) => {
    const r = await ctx.qpdf.run({
      inputs: { "in0.pdf": bytes },
      args: [
        "--json=2",
        "--json-key=qpdf",
        ...ids.map((id) => `--json-object=${id}`),
        "in0.pdf",
        "-",
      ],
      outputs: [],
    });
    return JSON.parse(r.stdout) as QpdfJson;
  };
  const refOf = (json: QpdfJson, id: string, key: string) => {
    const v = (json.qpdf[1][id]?.value as JsonDict | undefined)?.[key];
    return typeof v === "string" ? v : null;
  };
  const first = await objects(["trailer"]);
  const root = refOf(first, "trailer", "/Root");
  if (!root) return bytes;
  const second = await objects(["trailer", root]);
  const form = refOf(second, `obj:${root}`, "/AcroForm");
  const json = form ? await objects(["trailer", root, form]) : second;
  const patch = stalePatch(json);
  if (!patch) return bytes;
  return runToFile(ctx.qpdf, {
    inputs: { "in0.pdf": bytes, "patch.json": new TextEncoder().encode(JSON.stringify(patch)) },
    args: ["in0.pdf", "--update-from-json=patch.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

type JsonDict = Record<string, unknown>;
interface QpdfJson {
  qpdf: [JsonDict, Record<string, { value?: unknown }>];
}

/** qpdf JSON v2 update that drops /AcroForm /XFA and catalog /Perms; null if neither exists. */
export function stalePatch(json: QpdfJson): object | null {
  const [header, objs] = json.qpdf;
  const trailer = objs["trailer"]?.value as JsonDict | undefined;
  const rootRef = trailer?.["/Root"];
  if (typeof rootRef !== "string") return null;
  const catalog = { ...(objs[`obj:${rootRef}`]?.value as JsonDict) };
  const changes: Record<string, { value: JsonDict }> = {};
  let catalogChanged = false;
  if ("/Perms" in catalog) {
    delete catalog["/Perms"];
    catalogChanged = true;
  }
  const af = catalog["/AcroForm"];
  if (typeof af === "string") {
    const form = { ...(objs[`obj:${af}`]?.value as JsonDict) };
    if ("/XFA" in form) {
      delete form["/XFA"];
      changes[`obj:${af}`] = { value: form };
    }
  } else if (af && typeof af === "object" && "/XFA" in af) {
    const form = { ...(af as JsonDict) };
    delete form["/XFA"];
    catalog["/AcroForm"] = form;
    catalogChanged = true;
  }
  if (catalogChanged) changes[`obj:${rootRef}`] = { value: catalog };
  if (!Object.keys(changes).length) return null;
  return {
    qpdf: [
      {
        jsonversion: 2,
        pushedinheritedpageresources: false,
        calledgetallpages: false,
        maxobjectid: header["maxobjectid"],
      },
      changes,
    ],
  };
}
