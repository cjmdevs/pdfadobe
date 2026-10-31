// Wraps a page's content in extra operators without touching its own streams: two new
// content streams go before and after the existing ones (qpdf --update-from-json).
// Used by Straighten Pages (a rotation around the whole page, lossless: the scan's
// image bytes stay as they are).

import { runToFile, type Qpdf } from "./qpdf";
import { isRef, PdfObjects, withKey, type JVal } from "../redact/objects";

export interface ContentWrap {
  /** 0-based page. */
  page: number;
  /** Operators that apply to the page's own content: drawn first, inside one q ... Q
   * around it (e.g. a "cm" that turns the page). */
  before: string;
  /** Operators drawn after that Q, on top of the page. */
  after: string;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

export async function wrapContents(
  qpdf: Qpdf,
  bytes: Uint8Array,
  wraps: ContentWrap[],
): Promise<Uint8Array> {
  if (!wraps.length) return bytes;
  const objs = await PdfObjects.read(qpdf, bytes);
  const pages = objs.pages();
  for (const w of wraps) {
    const ref = pages[w.page];
    const page = objs.dict(ref);
    if (!ref || !page) throw new RangeError(`page ${w.page + 1} does not exist`);
    const c = page["/Contents"];
    // /Contents is a stream, an array of streams (maybe indirect), or missing.
    const own: JVal[] =
      c === undefined ? [] : Array.isArray(objs.get(c)) ? (objs.get(c) as JVal[]) : [c];
    const stream = (text: string) => {
      const r = objs.newRef();
      objs.setStream(r, {}, utf8(`${text}\n`));
      return r;
    };
    // The leading "q" also guards against a page that leaves its graphics state changed.
    const list = [stream(`q ${w.before}`), ...own.filter(isRef), stream(`Q ${w.after}`)];
    objs.set(ref, withKey(page, "/Contents", list));
  }
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": utf8(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}
