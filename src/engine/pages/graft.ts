// Draws pages of a small "layer" PDF onto pages of a document, behind or in front of
// their content, without touching that content: each layer page becomes a form XObject
// (copied in with its resources by qpdf --update-from-json) and the page gets one extra
// content stream that draws it. qpdf's own --overlay is not used because it turns the
// page's original content into a form XObject too, which Edit PDF and redaction treat
// differently from content drawn directly on the page.
//
// Everything added carries /PWDecor <kind> (the form and the content streams), so it can
// be found and removed again (`removeGrafts`). Used by Recognize Text (the invisible text
// layer) and by headers/footers, Bates numbers, watermarks and backgrounds.

import type { PdfiumModule } from "../pdfium";
import { RawDoc, readBox } from "./raw";
import { runToFile, type Qpdf } from "./qpdf";
import { isDict, isRef, PdfObjects, withKey, type JDict, type JVal } from "../redact/objects";

/** PDF matrix [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];

export interface Graft {
  /** Target page (0-based). */
  page: number;
  /** Page of the layer PDF drawn there (0-based). */
  layerPage: number;
  /** Drawn before the page's content (a background) instead of after it. */
  behind: boolean;
  /** Maps the layer page's space onto the target page's user space. */
  matrix: Matrix;
}

/** What a graft is, for finding it again: "ocr", "header", "watermark", ... */
export type GraftKind = string;

/** A page as displayed: size in points and the map from display space to user space. */
export interface PageFrame {
  width: number;
  height: number;
  /** Display space (bottom-left origin, /Rotate applied, crop box) -> user space. */
  toUser: Matrix;
}

/** Each page's displayed frame (crop box and /Rotate, inherited values included). */
export function pageFrames(m: PdfiumModule, bytes: Uint8Array): PageFrame[] {
  const doc = RawDoc.open(m, bytes);
  try {
    return Array.from({ length: doc.pageCount }, (_, i) =>
      doc.withPage(i, (page) => {
        const box = readBox(m, (l, b, r, t) => m.FPDFPage_GetCropBox(page, l, b, r, t)) ??
          readBox(m, (l, b, r, t) => m.FPDFPage_GetMediaBox(page, l, b, r, t)) ?? {
            left: 0,
            bottom: 0,
            right: m.FPDF_GetPageWidthF(page),
            top: m.FPDF_GetPageHeightF(page),
          };
        const x0 = Math.min(box.left, box.right);
        const x1 = Math.max(box.left, box.right);
        const y0 = Math.min(box.bottom, box.top);
        const y1 = Math.max(box.bottom, box.top);
        const rot = ((m.FPDFPage_GetRotation(page) % 4) + 4) % 4;
        // Display (u, v) -> user (x, y), for each /Rotate.
        const toUser: Matrix =
          rot === 1
            ? [0, 1, -1, 0, x1, y0] // x = x1 - v, y = y0 + u
            : rot === 2
              ? [-1, 0, 0, -1, x1, y1]
              : rot === 3
                ? [0, -1, 1, 0, x0, y1] // x = x0 + v, y = y1 - u
                : [1, 0, 0, 1, x0, y0];
        const turned = rot % 2 === 1;
        return {
          width: turned ? y1 - y0 : x1 - x0,
          height: turned ? x1 - x0 : y1 - y0,
          toUser,
        };
      }),
    );
  } finally {
    doc.close();
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const num = (v: number) => Number(v.toFixed(6));

interface RawObject {
  value?: JVal;
  stream?: { dict: JDict; data?: string };
}

/** The layer PDF's objects with raw (still filtered) stream data, contents coalesced. */
async function readLayer(qpdf: Qpdf, layer: Uint8Array) {
  const one = await runToFile(qpdf, {
    inputs: { "in0.pdf": layer },
    args: ["in0.pdf", "--coalesce-contents", "--object-streams=disable", "out.pdf"],
    outputs: ["out.pdf"],
  });
  const r = await qpdf.run({
    inputs: { "in0.pdf": one },
    args: [
      "--json=2",
      "--json-key=qpdf",
      "--json-stream-data=inline",
      "--decode-level=none",
      "in0.pdf",
    ],
    outputs: [],
  });
  const objects = (JSON.parse(r.stdout) as { qpdf: [JVal, Record<string, RawObject>] }).qpdf[1];
  const get = (ref: string) => objects[`obj:${ref}`];
  const dict = (v: JVal | undefined): JDict | undefined => {
    if (isRef(v)) {
      const o = get(v);
      return o?.stream?.dict ?? (isDict(o?.value) ? o.value : undefined);
    }
    return isDict(v) ? v : undefined;
  };
  const pages: string[] = [];
  const walk = (ref: JVal | undefined) => {
    const d = dict(ref);
    if (!d || !isRef(ref)) return;
    const kids = d["/Kids"];
    if (Array.isArray(kids)) kids.forEach(walk);
    else pages.push(ref);
  };
  const trailer = objects["trailer"]?.value;
  walk(dict(isDict(trailer) ? trailer["/Root"] : undefined)?.["/Pages"]);
  return { get, dict, pages };
}

const b64bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Adds `grafts` from `layer` to the document, marked as `kind`. */
export async function graftLayers(
  qpdf: Qpdf,
  bytes: Uint8Array,
  layer: Uint8Array,
  grafts: Graft[],
  kind: GraftKind,
): Promise<Uint8Array> {
  if (!grafts.length) return bytes;
  const objs = await PdfObjects.read(qpdf, bytes);
  const src = await readLayer(qpdf, layer);
  const targets = objs.pages();
  // Each layer object is copied once (shared fonts stay shared).
  const copied = new Map<string, string>();
  const copy = (v: JVal | undefined): JVal => {
    if (isRef(v)) {
      const done = copied.get(v);
      if (done) return done;
      const ref = objs.newRef();
      copied.set(v, ref);
      const o = src.get(v);
      if (o?.stream) {
        const d = copy(o.stream.dict) as JDict;
        objs.setStream(ref, d, b64bytes(o.stream.data ?? ""));
      } else objs.set(ref, copy(o?.value ?? null));
      return ref;
    }
    if (Array.isArray(v)) return v.map(copy);
    if (isDict(v)) {
      const out: JDict = {};
      for (const [k, x] of Object.entries(v)) if (k !== "/Parent") out[k] = copy(x);
      return out;
    }
    return v ?? null;
  };
  const forms = new Map<number, string>();
  const form = (layerPage: number): string => {
    const have = forms.get(layerPage);
    if (have) return have;
    const pageRef = src.pages[layerPage];
    const page = src.dict(pageRef);
    if (!page) throw new RangeError(`layer page ${layerPage + 1} does not exist`);
    const contents = page["/Contents"];
    const stream = isRef(contents) ? src.get(contents)?.stream : undefined;
    const box = page["/MediaBox"] ?? [0, 0, 612, 792];
    const ref = objs.newRef();
    const dict: JDict = {
      "/Type": "/XObject",
      "/Subtype": "/Form",
      "/BBox": copy(box),
      "/Resources": copy(page["/Resources"] ?? {}),
      "/PWDecor": `/${kind}`,
    };
    for (const k of ["/Filter", "/DecodeParms"]) {
      const v = stream?.dict[k];
      if (v !== undefined) dict[k] = copy(v);
    }
    objs.setStream(ref, dict, b64bytes(stream?.data ?? ""));
    forms.set(layerPage, ref);
    return ref;
  };

  const byPage = new Map<number, Graft[]>();
  for (const g of grafts) byPage.set(g.page, [...(byPage.get(g.page) ?? []), g]);
  for (const [index, list] of byPage) {
    const pageRef = targets[index];
    let page = objs.dict(pageRef);
    if (!pageRef || !page) throw new RangeError(`page ${index + 1} does not exist`);
    // The page's own XObject names, so ours never clash.
    const res = resourcesOf(objs, pageRef);
    const xo: JDict = { ...(objs.dict(res["/XObject"]) ?? {}) };
    const stream = (text: string) => {
      const r = objs.newRef();
      objs.setStream(r, { "/PWDecor": `/${kind}` }, utf8(`${text}\n`));
      return r;
    };
    const behind: string[] = [];
    const front: string[] = [];
    for (const g of list) {
      let n = 1;
      while (xo[`/PWDecor${n}`] !== undefined) n++;
      const name = `/PWDecor${n}`;
      xo[name] = form(g.layerPage);
      const draw = `q ${g.matrix.map(num).join(" ")} cm /Artifact BMC ${name} Do EMC Q`;
      (g.behind ? behind : front).push(draw);
    }
    page = withKey(page, "/Resources", withKey(res, "/XObject", xo));
    const own = contentList(objs, page["/Contents"]);
    // Drawn after the page's content: that content is put in q ... Q first, so a page
    // that leaves its graphics state changed cannot move what we draw.
    const list2 = [
      ...(behind.length ? [stream(behind.join("\n"))] : []),
      ...(front.length ? [stream("q")] : []),
      ...own,
      ...(front.length ? [stream(`Q\n${front.join("\n")}`)] : []),
    ];
    objs.set(pageRef, withKey(page, "/Contents", list2));
  }
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": utf8(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

/** A page's resource dictionary as a plain value (inherited ones copied in). */
function resourcesOf(objs: PdfObjects, pageRef: string): JDict {
  let node: JDict | undefined = objs.dict(pageRef);
  for (let depth = 0; node && depth < 32; depth++) {
    const r = objs.dict(node["/Resources"]);
    if (r) return r;
    node = objs.dict(node["/Parent"]);
  }
  return {};
}

function contentList(objs: PdfObjects, c: JVal | undefined): string[] {
  if (c === undefined) return [];
  const v = objs.get(c);
  return (Array.isArray(v) ? v : [c]).filter(isRef);
}

/** Removes everything added as `kinds` (forms, their content streams and names). */
export async function removeGrafts(
  qpdf: Qpdf,
  bytes: Uint8Array,
  kinds: GraftKind[],
): Promise<{ bytes: Uint8Array; pages: number[] }> {
  const objs = await PdfObjects.read(qpdf, bytes);
  const marks = new Set(kinds.map((k) => `/${k}`));
  const ours = (ref: JVal | undefined) => {
    const d = objs.dict(ref);
    return d !== undefined && typeof d["/PWDecor"] === "string" && marks.has(d["/PWDecor"]);
  };
  const pages: number[] = [];
  objs.pages().forEach((pageRef, i) => {
    const page = objs.dict(pageRef);
    if (!page) return;
    const own = contentList(objs, page["/Contents"]);
    const keep = own.filter((r) => !ours(r));
    if (keep.length === own.length) return;
    // A front graft's "q" guard and its "Q ... Do" stream are both marked: both go.
    let next = withKey(page, "/Contents", keep);
    const res = resourcesOf(objs, pageRef);
    const xo = objs.dict(res["/XObject"]);
    if (xo) {
      const left: JDict = {};
      for (const [k, v] of Object.entries(xo)) if (!ours(v)) left[k] = v;
      next = withKey(next, "/Resources", withKey(res, "/XObject", left));
    }
    objs.set(pageRef, next);
    pages.push(i);
  });
  if (!pages.length) return { bytes, pages };
  const out = await runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": utf8(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
  return { bytes: out, pages };
}

/** The kinds of grafts each page carries. */
export async function graftKinds(qpdf: Qpdf, bytes: Uint8Array): Promise<Set<string>> {
  const objs = await PdfObjects.read(qpdf, bytes);
  const out = new Set<string>();
  for (const ref of objs.refs()) {
    const k = objs.dict(ref)?.["/PWDecor"];
    if (typeof k === "string") out.add(k.slice(1));
  }
  return out;
}
