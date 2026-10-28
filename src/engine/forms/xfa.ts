// What kind of form a PDF holds, and the XFA step on save (Phase 6).
//
// Our PDFium build has no XFA engine. A hybrid form (AcroForm widgets plus an XFA twin,
// most IRS forms) is filled through its AcroForm layer. An XFA-only form ("dynamic XFA",
// /NeedsRendering true) has no widgets to fill: the UI says so and offers Acrobat.
// Node-safe.

import type { PdfiumModule } from "../pdfium";
import { cleanAfterRestructure, type PagesCtx } from "../pages";
import { RawDoc } from "../pages/raw";

export type FormKind = "none" | "acroform" | "hybrid" | "xfa-only";

// FPDF_GetFormType (fpdf_formfill.h). It reads the catalog, so it works without XFA support.
const FORMTYPE_ACRO_FORM = 1;
const FORMTYPE_XFA_FULL = 2;
const FORMTYPE_XFA_FOREGROUND = 3;

export function formKind(m: PdfiumModule, bytes: Uint8Array): FormKind {
  const doc = RawDoc.open(m, bytes);
  try {
    switch (m.FPDF_GetFormType(doc.ptr)) {
      case FORMTYPE_ACRO_FORM:
        return "acroform";
      case FORMTYPE_XFA_FULL:
        return "xfa-only";
      case FORMTYPE_XFA_FOREGROUND:
        return "hybrid";
      default:
        return "none";
    }
  } finally {
    doc.close();
  }
}

/**
 * "strip": remove /AcroForm /XFA and the catalog /Perms usage-rights signature, so
 * Acrobat shows the AcroForm values we wrote (it prefers the XFA twin otherwise) and does
 * not warn about a broken signature (PDFium's save is a full rewrite, which breaks it).
 * "keep": leave both alone. Which is the default waits on the owner's Acrobat check
 * (docs/forms-spike-report.md).
 */
export type XfaPolicy = "strip" | "keep";

export async function finishFormSave(
  ctx: PagesCtx,
  bytes: Uint8Array,
  policy: XfaPolicy,
): Promise<Uint8Array> {
  return policy === "strip" ? cleanAfterRestructure(ctx, bytes) : bytes;
}
