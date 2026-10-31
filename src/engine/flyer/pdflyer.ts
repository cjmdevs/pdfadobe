// PDFlyer compatibility on save (backlog B6). PDFlyer marks its own tickmarks with a
// /Name of "#V3JpdHRlbiBCeSBOYW4u" (a "#", then base64 of "Written By Nan."), a
// "Category:Item" subject and a closed /Popup (owner's sample, 2026-10-28). PDFium can't
// write a stamp /Name outside the standard set, so this pass adds them with qpdf, like
// the link and redaction object edits, to every tickmark we tagged (pwType). It also
// drops popups whose parent is gone. Node-safe.

import { runToFile, type Qpdf } from "../pages/qpdf";
import { isRef, PdfObjects, withKey, type JDict, type JVal } from "../redact/objects";

/** PDFlyer's /Name on its tickmarks, as a qpdf JSON name. */
export const PDFLYER_NAME = "/#V3JpdHRlbiBCeSBOYW4u";

const ascii = (s: string) => new TextEncoder().encode(s);

function contains(bytes: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
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

function pwType(d: JDict): string | null {
  const raw = text(d["/EPDFCustom"]);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { pwType?: unknown };
    return typeof v.pwType === "string" ? v.pwType : null;
  } catch {
    return null;
  }
}

/** Adds PDFlyer's keys to our tickmarks; the bytes as they were when nothing changes. */
export async function addPdflyerKeys(qpdf: Qpdf, bytes: Uint8Array): Promise<Uint8Array> {
  // Our tags are plain text in an uncompressed object, unless a rewrite packed objects.
  if (!contains(bytes, ascii("pwType")) && !contains(bytes, ascii("/ObjStm"))) return bytes;
  const objs = await PdfObjects.read(qpdf, bytes);
  for (const pageRef of objs.pages()) {
    const page = objs.dict(pageRef);
    if (!page) continue;
    const listRef = isRef(page["/Annots"]) ? page["/Annots"] : null;
    const list = objs.get(page["/Annots"]);
    if (!Array.isArray(list)) continue;
    const live = new Set(list.filter(isRef));
    const width = (Array.isArray(page["/MediaBox"]) && Number(page["/MediaBox"][2])) || 612;
    let next = list.filter((r) => {
      // A popup whose parent left this page goes too.
      const d = objs.dict(r);
      return !(d?.["/Subtype"] === "/Popup" && isRef(d["/Parent"]) && !live.has(d["/Parent"]));
    });
    let changed = next.length !== list.length;
    for (const ref of [...next]) {
      if (!isRef(ref)) continue;
      let d = objs.dict(ref);
      if (!d || d["/Subtype"] !== "/Stamp" || pwType(d) !== "Tickmark") continue;
      const before = d;
      if (d["/Name"] !== PDFLYER_NAME) d = withKey(d, "/Name", PDFLYER_NAME);
      if (!d["/CreationDate"] && d["/M"]) d = withKey(d, "/CreationDate", d["/M"]);
      const popup = objs.dict(d["/Popup"]);
      if (!popup || popup["/Parent"] !== ref) {
        const rect = Array.isArray(d["/Rect"]) ? d["/Rect"].map(Number) : [0, 0, 0, 0];
        const top = Math.max(rect[1] ?? 0, rect[3] ?? 0);
        const add = objs.newRef();
        objs.set(add, {
          "/Type": "/Annot",
          "/Subtype": "/Popup",
          "/F": 28,
          "/Open": false,
          "/Parent": ref,
          "/Rect": [width, top - 114, width + 204, top],
        });
        d = withKey(d, "/Popup", add);
        next = [...next, add];
        changed = true;
      }
      if (d !== before) objs.set(ref, d);
    }
    if (!changed) continue;
    if (listRef) objs.set(listRef, next);
    else objs.set(pageRef, withKey(page, "/Annots", next));
  }
  if (!objs.hasChanges) return bytes;
  return runToFile(qpdf, {
    inputs: { "in0.pdf": bytes, "edit.json": ascii(objs.updateJson()) },
    args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
    outputs: ["out.pdf"],
  });
}
