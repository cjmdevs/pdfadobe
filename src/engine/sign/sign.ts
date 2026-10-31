// Certificate signing (Phase 8): adds a signature field (or fills an empty one), a
// PAdES signature dictionary (/SubFilter /ETSI.CAdES.detached) and its appearance as
// one incremental update, then fills /ByteRange and /Contents in place.
//
// A file that carries no signature yet is first rewritten by qpdf (repairs a damaged
// cross-reference table, so the update lands on a sound file). A signed file is only
// ever appended to, so its earlier signatures stay valid.

import { zlibSync } from "fflate";
import type { PdfiumModule } from "../pdfium";
import { pageFrames, type Matrix } from "../pages/graft";
import { runToFile, type Qpdf } from "../pages/qpdf";
import { isRef, numbers, PdfObjects, withKey, type JDict, type JVal } from "../redact/objects";
import type { Rgba } from "../pages/png";
import { appendUpdate, type UpdateObject } from "./incremental";
import { buildCms, certName, parseCertificate, sha256, type CertSigner } from "./cms";
import { displayDate, pdfDate, signatureAppearance } from "./appearance";

export class SignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignError";
  }
}

/** A box on a page, in points in the page's displayed space (bottom-left origin). */
export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignRequest {
  signer: CertSigner;
  /** Visible signature in a new field. Neither `box` nor `field`: invisible. */
  box?: { page: number; rect: DisplayRect };
  /** Sign this existing, empty signature field (its full name). */
  field?: string;
  reason?: string;
  location?: string;
  /** Appearance options for visible signatures. */
  appearance?: {
    /** Signature image (a saved signature) drawn on the left instead of the name. */
    image?: Rgba | null;
    showDate?: boolean;
    showReason?: boolean;
  };
  date?: Date;
}

const RESERVE = 24 * 1024;
const BYTE_RANGE_PLACEHOLDER = [0, 9999999999, 9999999999, 9999999999];

interface Field {
  ref: string;
  dict: JDict;
  name: string;
  type: string | undefined;
  /** Widgets: the field itself when merged, else its kids without /T. */
  widgets: string[];
}

/** Every terminal form field with its full name and inherited /FT. */
export function formFields(objs: PdfObjects): Field[] {
  const acro = objs.dict(objs.catalog["/AcroForm"]);
  const out: Field[] = [];
  const seen = new Set<string>();
  const walk = (ref: JVal, prefix: string, ft: string | undefined) => {
    if (!isRef(ref) || seen.has(ref)) return;
    seen.add(ref);
    const d = objs.dict(ref);
    if (!d) return;
    const t = d["/T"];
    const part = typeof t === "string" && t.startsWith("u:") ? t.slice(2) : "";
    const name = prefix && part ? `${prefix}.${part}` : prefix || part;
    const type = typeof d["/FT"] === "string" ? d["/FT"] : ft;
    const kids = objs.get(d["/Kids"]);
    const fieldKids = Array.isArray(kids)
      ? kids.filter((k) => objs.dict(k)?.["/T"] !== undefined)
      : [];
    if (Array.isArray(kids) && fieldKids.length) {
      for (const k of fieldKids) walk(k, name, type);
      return;
    }
    const widgets = Array.isArray(kids) && kids.length ? kids.filter(isRef) : [ref];
    out.push({ ref, dict: d, name, type, widgets });
  };
  const fields = objs.get(acro?.["/Fields"]);
  if (Array.isArray(fields)) for (const f of fields) walk(f, "", undefined);
  return out;
}

/** True when some signature field already holds a signature. */
export function hasSignatures(objs: PdfObjects): boolean {
  return formFields(objs).some((f) => f.type === "/Sig" && f.dict["/V"] !== undefined);
}

/** Empty signature fields (what "click to sign" offers). */
export function emptySignatureFields(objs: PdfObjects): string[] {
  return formFields(objs)
    .filter((f) => f.type === "/Sig" && f.dict["/V"] === undefined)
    .map((f) => f.name);
}

const u = (s: string): string => `u:${s}`;

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Signs `bytes` and returns the signed file. The input is never changed. */
export async function signPdf(
  m: PdfiumModule,
  qpdf: Qpdf,
  bytes: Uint8Array,
  req: SignRequest,
): Promise<Uint8Array> {
  const PROTECTED = "This document is password-protected. Remove its security, then sign.";
  let objs = await PdfObjects.read(qpdf, bytes).catch((e: unknown) => {
    throw /password/i.test(String(e)) ? new SignError(PROTECTED) : e;
  });
  if (objs.trailer["/Encrypt"] !== undefined) throw new SignError(PROTECTED);
  let base = bytes;
  if (!hasSignatures(objs)) {
    base = await runToFile(qpdf, {
      inputs: { "in0.pdf": bytes },
      args: ["in0.pdf", "out.pdf"],
      outputs: ["out.pdf"],
    });
    objs = await PdfObjects.read(qpdf, base);
  }
  const frames = pageFrames(m, base);
  const pages = objs.pages();
  const date = req.date ?? new Date();
  const cert = parseCertificate(req.signer.certificates[0] ?? new Uint8Array());
  const signerName = certName(cert);

  const sigRef = objs.newRef();
  const sig: JDict = {
    "/Type": "/Sig",
    "/Filter": "/Adobe.PPKLite",
    "/SubFilter": "/ETSI.CAdES.detached",
    "/ByteRange": BYTE_RANGE_PLACEHOLDER,
    "/Contents": `b:${"0".repeat(RESERVE * 2)}`,
    "/M": u(pdfDate(date)),
    "/Name": u(signerName),
    "/Prop_Build": { "/App": { "/Name": "/PDF Workbench" } },
  };
  if (req.reason) sig["/Reason"] = u(req.reason);
  if (req.location) sig["/Location"] = u(req.location);
  objs.set(sigRef, sig);

  // Where the widget goes and how big its appearance is (displayed orientation).
  let pageIndex = 0;
  let rect: number[] = [0, 0, 0, 0];
  let size = { w: 0, h: 0 };
  let linear: Matrix = [1, 0, 0, 1, 0, 0];
  let widgetRef: string;
  let fieldRef: string;
  const existing = req.field ? formFields(objs).find((f) => f.name === req.field) : undefined;
  if (req.field) {
    if (!existing || existing.type !== "/Sig")
      throw new SignError(`There is no signature field "${req.field}".`);
    if (existing.dict["/V"] !== undefined) throw new SignError(`"${req.field}" is already signed.`);
    fieldRef = existing.ref;
    widgetRef = existing.widgets[0] ?? existing.ref;
    const w = objs.dict(widgetRef) ?? {};
    rect = numbers(objs.get(w["/Rect"])) ?? [0, 0, 0, 0];
    const p = w["/P"];
    pageIndex = Math.max(
      0,
      isRef(p) && pages.includes(p)
        ? pages.indexOf(p)
        : pages.findIndex((pg) => {
            const annots = objs.get(objs.dict(pg)?.["/Annots"]);
            return Array.isArray(annots) && annots.includes(widgetRef);
          }),
    );
    const f = frames[pageIndex];
    if (f) linear = [f.toUser[0], f.toUser[1], f.toUser[2], f.toUser[3], 0, 0];
    const rw = Math.abs((rect[2] ?? 0) - (rect[0] ?? 0));
    const rh = Math.abs((rect[3] ?? 0) - (rect[1] ?? 0));
    size = linear[0] === 0 ? { w: rh, h: rw } : { w: rw, h: rh };
  } else {
    widgetRef = objs.newRef();
    fieldRef = widgetRef;
    if (req.box) {
      pageIndex = req.box.page;
      const f = frames[pageIndex];
      if (!f) throw new SignError("That page does not exist.");
      const r = req.box.rect;
      const [ax, ay] = apply(f.toUser, r.x, r.y);
      const [bx, by] = apply(f.toUser, r.x + r.width, r.y + r.height);
      rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
      linear = [f.toUser[0], f.toUser[1], f.toUser[2], f.toUser[3], 0, 0];
      size = { w: r.width, h: r.height };
    }
  }
  const pageRef = pages[pageIndex];
  if (!pageRef) throw new SignError("The document has no pages.");

  // Appearance.
  const apRef = objs.newRef();
  const resources: JDict = {
    "/Font": {
      "/Helv": {
        "/Type": "/Font",
        "/Subtype": "/Type1",
        "/BaseFont": "/Helvetica",
        "/Encoding": "/WinAnsiEncoding",
      },
    },
  };
  let content = "";
  if (size.w > 0 && size.h > 0) {
    const a = req.appearance ?? {};
    const details = [
      `Digitally signed by ${signerName}`,
      a.showDate === false ? "" : `Date: ${displayDate(date)}`,
      a.showReason === false || !req.reason ? "" : `Reason: ${req.reason}`,
      req.location ? `Location: ${req.location}` : "",
    ];
    const look = signatureAppearance({
      width: size.w,
      height: size.h,
      name: signerName,
      details,
      image: a.image ?? null,
    });
    content = look.content;
    if (look.image) resources["/XObject"] = { "/Img0": imageObject(objs, look.image) };
  }
  objs.setStream(
    apRef,
    {
      "/Type": "/XObject",
      "/Subtype": "/Form",
      "/BBox": [0, 0, size.w, size.h],
      "/Matrix": linear,
      "/Resources": resources,
    },
    new TextEncoder().encode(content),
  );

  // Field and widget.
  if (existing) {
    objs.set(fieldRef, withKey(objs.dict(fieldRef) ?? {}, "/V", sigRef));
    const w = objs.dict(widgetRef) ?? {};
    const flags = typeof w["/F"] === "number" ? w["/F"] : 4;
    objs.set(widgetRef, { ...w, "/AP": { "/N": apRef }, "/F": flags | 4, "/P": pageRef });
  } else {
    const names = new Set(formFields(objs).map((f) => f.name));
    let i = 1;
    while (names.has(`Signature${i}`)) i++;
    objs.set(widgetRef, {
      "/Type": "/Annot",
      "/Subtype": "/Widget",
      "/FT": "/Sig",
      "/T": u(`Signature${i}`),
      "/V": sigRef,
      "/F": 132,
      "/P": pageRef,
      "/Rect": rect,
      "/AP": { "/N": apRef },
    });
    const page = objs.dict(pageRef) ?? {};
    const annots = objs.get(page["/Annots"]);
    const list = [...(Array.isArray(annots) ? annots : []), widgetRef];
    if (isRef(page["/Annots"]) && Array.isArray(annots)) objs.set(page["/Annots"], list);
    else objs.set(pageRef, withKey(page, "/Annots", list));
  }
  const acroAt = objs.catalog["/AcroForm"];
  const acro = objs.dict(acroAt) ?? {};
  const fields = objs.get(acro["/Fields"]);
  const fieldList = Array.isArray(fields) ? fields : [];
  const nextFields = existing ? fieldList : [...fieldList, fieldRef];
  let nextAcro: JDict = { ...acro, "/SigFlags": 3 };
  if (isRef(acro["/Fields"]) && Array.isArray(fields)) objs.set(acro["/Fields"], nextFields);
  else nextAcro = { ...nextAcro, "/Fields": nextFields };
  if (isRef(acroAt)) objs.set(acroAt, nextAcro);
  else objs.set(objs.catalogRef, withKey(objs.catalog, "/AcroForm", nextAcro));

  const update: UpdateObject[] = objs
    .changes()
    .filter((c) => c.ref !== "trailer")
    .map((c) => {
      const num = Number(c.ref.split(" ")[0]);
      return c.stream ? { num, stream: c.stream } : { num, value: c.value ?? null };
    });
  const out = appendUpdate(base, update, objs.trailer, objs.maxObjectId + 1);
  return fill(out, base.length, req.signer);
}

/** An RGB image XObject (Flate) with its alpha as a soft mask; returns its reference. */
function imageObject(objs: PdfObjects, img: Rgba): string {
  const n = img.width * img.height;
  const rgb = new Uint8Array(n * 3);
  const alpha = new Uint8Array(n);
  let opaque = true;
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = img.data[i * 4] ?? 0;
    rgb[i * 3 + 1] = img.data[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = img.data[i * 4 + 2] ?? 0;
    alpha[i] = img.data[i * 4 + 3] ?? 255;
    if (alpha[i] !== 255) opaque = false;
  }
  const common = {
    "/Type": "/XObject",
    "/Subtype": "/Image",
    "/Width": img.width,
    "/Height": img.height,
  };
  const ref = objs.newRef();
  const dict: JDict = {
    ...common,
    "/ColorSpace": "/DeviceRGB",
    "/BitsPerComponent": 8,
    "/Filter": "/FlateDecode",
  };
  if (!opaque) {
    const mask = objs.newRef();
    objs.setStream(
      mask,
      {
        ...common,
        "/ColorSpace": "/DeviceGray",
        "/BitsPerComponent": 8,
        "/Filter": "/FlateDecode",
      },
      zlibSync(alpha),
    );
    dict["/SMask"] = mask;
  }
  objs.setStream(ref, dict, zlibSync(rgb));
  return ref;
}

const latin1 = new TextDecoder("latin1");
const ascii = new TextEncoder();

/** Fills the placeholders of the signature added after `from` and signs. */
async function fill(out: Uint8Array, from: number, signer: CertSigner): Promise<Uint8Array> {
  const text = latin1.decode(out.subarray(from));
  const brText = `/ByteRange [${BYTE_RANGE_PLACEHOLDER.join(" ")}]`;
  const brAt = text.lastIndexOf(brText);
  const cAt = text.lastIndexOf(`/Contents <${"0".repeat(64)}`);
  if (brAt < 0 || cAt < 0) throw new SignError("The signature could not be placed.");
  const start = from + cAt + "/Contents ".length;
  const end = start + RESERVE * 2 + 2;
  const range = [0, start, end, out.length - end];
  const brValue = `/ByteRange [${range.join(" ")}]`;
  out.set(ascii.encode(brValue.slice(0, -1).padEnd(brText.length - 1, " ") + "]"), from + brAt);

  const signed = new Uint8Array(start + (out.length - end));
  signed.set(out.subarray(0, start));
  signed.set(out.subarray(end), start);
  const cms = await buildCms(signer, await sha256(signed));
  if (cms.length > RESERVE) throw new SignError("The certificate chain is too large to embed.");
  let hex = "";
  for (const b of cms) hex += b.toString(16).padStart(2, "0");
  out.set(ascii.encode(hex), start + 1);
  return out;
}
