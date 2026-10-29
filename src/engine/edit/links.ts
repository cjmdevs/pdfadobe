// Edit PDF (B3 stage 2): links (the Link button on the Edit toolbar). A link is a
// standard /Link annotation: a rectangle on the page that opens a web address
// (/A /URI) or goes to a page of this document (/A /GoTo, fit to the window), with an
// invisible or a visible border. Acrobat and every reader follow them.
//
// Objects are edited with qpdf (--update-from-json), like the redaction object edits:
// PDFium can't set a link's action. Links our tickmarks make (Phase 4: a letter pick
// linked to its partner, tagged with pwType) are left alone by Remove web links.

import { runToFile, type Qpdf } from "../pages/qpdf";
import { isRef, PdfObjects, withKey, type JDict, type JVal } from "../redact/objects";
import { EditRefused } from "./refusal";
import type { Rect } from "./chars";

export type LinkTarget = { kind: "uri"; uri: string } | { kind: "page"; page: number };

export interface PageLink {
  /** The annotation's object ("12 0 R"). */
  ref: string;
  rect: Rect;
  target: LinkTarget | { kind: "other" };
  /** Border width in points (0: invisible) and colour (0..1). */
  width: number;
  color: [number, number, number];
}

export interface LinkSpec {
  rect: Rect;
  target: LinkTarget;
  /** Border width in points; 0 for an invisible link. */
  width: number;
  color: [number, number, number];
}

/** A qpdf JSON string's text. */
function text(v: JVal | undefined): string | null {
  if (typeof v !== "string") return null;
  if (v.startsWith("u:")) return v.slice(2);
  if (v.startsWith("b:")) {
    const hex = v.slice(2);
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2)
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }
  return null;
}

/**
 * A web address a link may open: http(s) or mailto. Without a scheme, https is
 * assumed. Anything else (javascript:, file:, a launch) is refused.
 */
export function cleanUri(raw: string): string {
  const s = raw.trim();
  if (!s) throw new EditRefused("Type a web address or an email address.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (/^(https?|mailto):/i.test(s)) return s;
    throw new EditRefused("Links can open web addresses (http, https) and email addresses only.");
  }
  return s.includes("@") && !s.includes("/") ? `mailto:${s}` : `https://${s}`;
}

/** The links on page `page` (0-based). */
export async function listLinks(qpdf: Qpdf, bytes: Uint8Array, page: number): Promise<PageLink[]> {
  const objs = await PdfObjects.read(qpdf, bytes);
  return linksOn(objs, page);
}

function linksOn(objs: PdfObjects, page: number): PageLink[] {
  const pages = objs.pages();
  const pd = objs.dict(pages[page]);
  const annots = objs.get(pd?.["/Annots"]);
  if (!Array.isArray(annots)) return [];
  const out: PageLink[] = [];
  for (const ref of annots) {
    const a = objs.dict(ref);
    if (!isRef(ref) || !a || a["/Subtype"] !== "/Link") continue;
    const r = objs.get(a["/Rect"]);
    if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === "number")) continue;
    const [x1, y1, x2, y2] = r as number[] as [number, number, number, number];
    const action = objs.dict(a["/A"]);
    let target: PageLink["target"] = { kind: "other" };
    if (action?.["/S"] === "/URI") {
      const uri = text(objs.get(action["/URI"]));
      if (uri !== null) target = { kind: "uri", uri };
    } else {
      const dest = objs.get(action?.["/S"] === "/GoTo" ? action["/D"] : a["/Dest"]);
      const first = Array.isArray(dest) ? dest[0] : undefined;
      const at = isRef(first) ? pages.indexOf(first) : -1;
      if (at >= 0) target = { kind: "page", page: at };
    }
    const border = objs.get(a["/Border"]);
    const bs = objs.dict(a["/BS"]);
    const width =
      typeof bs?.["/W"] === "number"
        ? bs["/W"]
        : Array.isArray(border) && typeof border[2] === "number"
          ? border[2]
          : 1;
    const c = objs.get(a["/C"]);
    const color: [number, number, number] =
      Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === "number")
        ? (c as [number, number, number])
        : [0, 0, 0];
    out.push({
      ref,
      rect: { l: Math.min(x1, x2), r: Math.max(x1, x2), b: Math.min(y1, y2), t: Math.max(y1, y2) },
      target,
      width,
      color,
    });
  }
  return out;
}

/** The link annotation for `spec` on page `page`. */
function linkDict(objs: PdfObjects, pageRef: string, spec: LinkSpec, keep: JDict = {}): JDict {
  const pages = objs.pages();
  const { l, b, r, t } = spec.rect;
  let action: JDict;
  if (spec.target.kind === "uri") {
    action = { "/S": "/URI", "/URI": `u:${cleanUri(spec.target.uri)}` };
  } else {
    const dest = pages[spec.target.page];
    if (!dest) throw new EditRefused(`This document has no page ${spec.target.page + 1}.`);
    action = { "/S": "/GoTo", "/D": [dest, "/Fit"] };
  }
  let d: JDict = {
    ...keep,
    "/Type": "/Annot",
    "/Subtype": "/Link",
    "/Rect": [l, b, r, t],
    "/P": pageRef,
    "/A": action,
    "/Border": [0, 0, spec.width],
    "/BS": { "/W": spec.width, "/S": "/S" },
    "/C": spec.color,
    // Shown inverted while clicked, like Acrobat's default.
    "/H": "/I",
  };
  d = withKey(d, "/Dest", undefined);
  return d;
}

async function write(qpdf: Qpdf, bytes: Uint8Array, objs: PdfObjects): Promise<Uint8Array> {
  if (!objs.hasChanges) return bytes;
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": new TextEncoder().encode(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}

/** Adds a link on page `page`, or (with `ref`) changes that link. */
export async function setLink(
  qpdf: Qpdf,
  bytes: Uint8Array,
  page: number,
  spec: LinkSpec,
  ref: string | null = null,
): Promise<Uint8Array> {
  if (spec.rect.r - spec.rect.l < 2 || spec.rect.t - spec.rect.b < 2)
    throw new EditRefused("Drag a rectangle for the link.");
  const objs = await PdfObjects.read(qpdf, bytes);
  const pageRef = objs.pages()[page];
  const pd = objs.dict(pageRef);
  if (!pageRef || !pd) throw new Error(`no page ${page + 1}`);
  if (ref) {
    const old = objs.dict(ref);
    if (!old || old["/Subtype"] !== "/Link") throw new EditRefused("This link no longer exists.");
    // Keep what we don't set (its name, flags, structure parent).
    objs.set(ref, linkDict(objs, pageRef, spec, old));
    return write(qpdf, bytes, objs);
  }
  const add = objs.newRef();
  objs.set(add, linkDict(objs, pageRef, spec));
  const annots = pd["/Annots"];
  if (isRef(annots)) {
    const list = objs.get(annots);
    objs.set(annots, [...(Array.isArray(list) ? list : []), add]);
  } else objs.set(pageRef, withKey(pd, "/Annots", [...(Array.isArray(annots) ? annots : []), add]));
  return write(qpdf, bytes, objs);
}

/** Removes links `refs` from page `page`. */
export async function removeLinks(
  qpdf: Qpdf,
  bytes: Uint8Array,
  page: number,
  refs: string[],
): Promise<Uint8Array> {
  const objs = await PdfObjects.read(qpdf, bytes);
  dropAnnots(objs, objs.pages()[page], new Set(refs));
  return write(qpdf, bytes, objs);
}

/** Removes every web link (/URI) in the document; our tickmark links stay. */
export async function removeWebLinks(
  qpdf: Qpdf,
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; removed: number }> {
  const objs = await PdfObjects.read(qpdf, bytes);
  let removed = 0;
  objs.pages().forEach((pageRef, i) => {
    const web = linksOn(objs, i)
      .filter((l) => l.target.kind === "uri" && !objs.dict(l.ref)?.["/pwType"])
      .map((l) => l.ref);
    removed += web.length;
    if (web.length) dropAnnots(objs, pageRef, new Set(web));
  });
  return { bytes: await write(qpdf, bytes, objs), removed };
}

function dropAnnots(objs: PdfObjects, pageRef: string | undefined, refs: Set<string>) {
  const pd = objs.dict(pageRef);
  if (!pageRef || !pd) return;
  const annots = pd["/Annots"];
  const list = objs.get(annots);
  if (!Array.isArray(list)) return;
  const keep = list.filter((a) => !(isRef(a) && refs.has(a)));
  if (keep.length === list.length) return;
  if (isRef(annots)) objs.set(annots, keep);
  else objs.set(pageRef, withKey(pd, "/Annots", keep.length ? keep : undefined));
  for (const r of refs) objs.set(r, null);
}
