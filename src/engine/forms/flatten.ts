// Flatten form (Phase 6), always into a new file: each visible field is drawn into its
// page as it looks now, then the fields are gone for good. Comments and other markup stay.
//
//   0. qpdf points each button's normal appearance (/AP /N, a dictionary of states) at
//      the stream of its current state (/AS): PDFium's flatten draws only a stream.
//   1. PDFium draws every widget that shows on paper (Print flag set, not hidden) into
//      the page content. A widget without an appearance gets one generated first.
//   2. qpdf removes every widget from /Annots, the whole /AcroForm (field tree, XFA
//      twin) and the /Perms usage-rights signature, which the change breaks.
//   3. A full rewrite drops what nothing refers to any more, so values of hidden fields
//      and earlier revisions do not stay in the file.
// Node-safe.

import type { PdfiumModule } from "../pdfium";
import type { PagesCtx } from "../pages";
import { editRaw, type RawDoc } from "../pages/raw";
import { runToFile } from "../pages/qpdf";
import { PdfObjects, isRef, rewrite, withKey, type JDict, type JVal } from "../redact/objects";

export interface FlattenFormReport {
  bytes: Uint8Array;
  /** Widgets drawn into the pages. */
  drawn: number;
  /** Widgets removed without drawing (hidden, or not printed). */
  hidden: number;
  /** Widgets with nothing to draw (e.g. an unticked box with no "Off" appearance). */
  empty: number;
}

// fpdf_annot.h
const WIDGET = 20;
const FLAG_HIDDEN = 1 << 1;
const FLAG_PRINT = 1 << 2;
const FLAG_NOVIEW = 1 << 5;

export async function flattenForm(ctx: PagesCtx, bytes: Uint8Array): Promise<FlattenFormReport> {
  let drawn = 0;
  let hidden = 0;
  let empty = 0;
  const states = await PdfObjects.read(ctx.qpdf, bytes);
  const ready = pickButtonStates(states)
    ? await runToFile(ctx.qpdf, {
        inputs: { "in0.pdf": bytes, "edit.json": new TextEncoder().encode(states.updateJson()) },
        args: ["in0.pdf", "--update-from-json=edit.json", "out.pdf"],
        outputs: ["out.pdf"],
      })
    : bytes;
  const painted = editRaw(ctx.module, ready, (doc) => {
    const r = drawWidgets(ctx.module, doc);
    ({ drawn, hidden, empty } = r);
  });
  const objs = await PdfObjects.read(ctx.qpdf, painted);
  removeForm(objs);
  return { bytes: await rewrite(ctx.qpdf, painted, objs), drawn, hidden, empty };
}

/** Step 0. True when something changed. */
function pickButtonStates(objs: PdfObjects): boolean {
  for (const ref of objs.refs()) {
    const w = objs.dict(ref);
    if (!w || w["/Subtype"] !== "/Widget") continue;
    const apAt = w["/AP"];
    const ap = objs.dict(apAt);
    const n = ap && objs.get(ap["/N"]);
    // A single appearance is a form XObject stream (its dictionary has /BBox); a state
    // dictionary (direct or indirect) maps state names to such streams.
    if (!ap || !n || typeof n !== "object" || Array.isArray(n) || "/BBox" in n) continue;
    const states = n as JDict;
    const as = typeof w["/AS"] === "string" ? w["/AS"] : "/Off";
    const stream = states[as] ?? states["/Off"];
    if (!isRef(stream)) continue;
    const next = withKey(ap, "/N", stream);
    if (isRef(apAt)) objs.set(apAt, next);
    else objs.set(ref, withKey(w, "/AP", next));
  }
  return objs.hasChanges;
}

function drawWidgets(
  m: PdfiumModule,
  doc: RawDoc,
): { drawn: number; hidden: number; empty: number } {
  let drawn = 0;
  let hidden = 0;
  let empty = 0;
  const info = m.PDFiumExt_OpenFormFillInfo();
  const form = m.PDFiumExt_InitFormFillEnvironment(doc.ptr, info);
  try {
    for (let p = 0; p < doc.pageCount; p++) {
      doc.withPage(p, (page) => {
        m.FORM_OnAfterLoadPage(page, form);
        let changed = false;
        try {
          // Backwards: flattening takes the annotation off the page, shifting later ones.
          for (let i = m.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) {
            const a = m.FPDFPage_GetAnnot(page, i);
            if (!a) continue;
            try {
              if (m.FPDFAnnot_GetSubtype(a) !== WIDGET) continue;
              const f = m.FPDFAnnot_GetFlags(a);
              if (f & (FLAG_HIDDEN | FLAG_NOVIEW) || !(f & FLAG_PRINT)) {
                hidden++;
                continue;
              }
              if (!m.FPDFAnnot_HasKey(a, "AP")) m.EPDFAnnot_GenerateFormFieldAP(a);
              if (m.EPDFAnnot_Flatten(page, a)) {
                drawn++;
                changed = true;
              } else empty++;
            } finally {
              m.FPDFPage_CloseAnnot(a);
            }
          }
        } finally {
          m.FORM_OnBeforeClosePage(page, form);
        }
        if (changed && !m.FPDFPage_GenerateContent(page))
          throw new Error(`page ${p + 1}: content could not be regenerated`);
      });
    }
  } finally {
    m.PDFiumExt_ExitFormFillEnvironment(form);
    m.PDFiumExt_CloseFormFillInfo(info);
  }
  return { drawn, hidden, empty };
}

/**
 * Widgets out of every page's /Annots and out of the structure tree (tagged PDFs link
 * each widget from an /OBJR, which would keep it and its field value in the file);
 * /AcroForm and /Perms out of the catalog.
 */
function removeForm(objs: PdfObjects): void {
  // Every widget object, not only those still in /Annots: PDFium's flatten takes the
  // ones it drew off the page already.
  const widgets = new Set(objs.refs().filter((r) => objs.dict(r)?.["/Subtype"] === "/Widget"));
  for (const pageRef of objs.pages()) {
    const page = objs.dict(pageRef);
    const at = page?.["/Annots"];
    const annots = objs.get(at);
    if (!page || !Array.isArray(annots)) continue;
    const isWidget = (a: JVal) => objs.dict(a)?.["/Subtype"] === "/Widget";
    const keep = annots.filter((a) => !isWidget(a));
    if (keep.length === annots.length) continue;
    if (isRef(at)) objs.set(at, keep);
    else objs.set(pageRef, withKey(page, "/Annots", keep.length ? keep : undefined));
  }
  if (widgets.size) unlinkFromStructure(objs, widgets);
  const cat = objs.catalog;
  if ("/AcroForm" in cat || "/Perms" in cat) {
    objs.set(objs.catalogRef, withKey(withKey(cat, "/AcroForm", undefined), "/Perms", undefined));
  }
}

function unlinkFromStructure(objs: PdfObjects, widgets: Set<string>): void {
  const pointsAtWidget = (k: JVal) => {
    const d = objs.dict(k);
    return d?.["/Type"] === "/OBJR" && isRef(d["/Obj"]) && widgets.has(d["/Obj"]);
  };
  for (const ref of objs.refs()) {
    const d = objs.dict(ref);
    if (!d || !("/K" in d)) continue;
    const k = d["/K"];
    if (Array.isArray(k)) {
      const keep = k.filter((x) => !pointsAtWidget(x));
      if (keep.length !== k.length) objs.set(ref, withKey(d, "/K", keep.length ? keep : undefined));
    } else if (pointsAtWidget(k)) {
      objs.set(ref, withKey(d, "/K", undefined));
    }
  }
}
