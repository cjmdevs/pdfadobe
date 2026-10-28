# Phase 6 forms spike (2026-10-27)

Test: `tests/unit/forms-spike.test.ts`. Output: `tests/corpus/out/forms-spike/`.
EmbedPDF / PDFium 2.15.1.

## (a) Create new AcroForm fields

`engine.createPageAnnotation` with a WIDGET (PDFium `EPDFPage_CreateFormField`) on the
flat `text-1p.pdf`:

| Type      | Result                                                               |
| --------- | -------------------------------------------------------------------- |
| Text      | Yes. Field + widget kid, /AP, /DA, value. qpdf, pdf.js, PDFium agree |
| Checkbox  | Yes. /AP /Yes + /Off                                                 |
| Radio     | Yes, one widget. Export value is the widget's UUID (NM), not a name  |
| Dropdown  | Yes. /Opt, /V, /I                                                    |
| Signature | **No.** Rejected: "can not create annotation with specified type"    |
| Date      | Not a PDF field type: a text field plus AFDate_* format scripts      |

Gaps on the created fields:

1. No /F Print flag: the fields do not print in Acrobat.
2. /MaxLen lands on the widget, not the field (pdf.js reads it, Acrobat may not).
3. Radio export values are UUIDs; a second button in the same group needs
   `EPDFAnnot_ShareFormField` (exists, not tried yet).
4. No API for /Ff required/read-only on create beyond the flag word, /DV default, /TU
   tooltip, /Q alignment, or /AA format scripts.
5. Each field adds a duplicate Helvetica entry to the page /Resources (harmless).

## (b) JavaScript calculated fields

`calc.pdf`: A, B, Total, Total has `AFSimple_Calculate("SUM", ...)` in /AA /C and is in
/AcroForm /CO. Typed A=2, B=3 through PDFium's form-fill path (focus, replace text,
kill focus). **Total stays empty.** The WASM build has no JavaScript engine (no V8 /
fxjs: none of the AF* built-in names are in `pdfium.wasm`). Format (/F), keystroke (/K)
and validate (/V) scripts do not run either.

## Corpus facts found on the way

- The 3 IRS forms have **no calculations** (no /AA, no /CO, no XFA `<calculate>`). Their
  only JavaScript is Adobe's document-level XFA version check.
- All 3 carry a **/Perms /UR3** usage-rights signature (Reader Extensions).
- PDFium's save is a **full rewrite**, not incremental, so any save breaks /UR3.
- None is XFA-only (/NeedsRendering absent). No XFA-only file in the corpus yet.

## Hybrid XFA samples for the Acrobat check

Same 4 text fields + 1 checkbox filled on 1040 page 1 ("SPIKE 1".."SPIKE 4"):

- `f1040-keep-xfa.pdf`: PDFium save, XFA and /UR3 left in place.
- `f1040-strip-xfa.pdf`: /XFA removed from /AcroForm.
- `f1040-strip-xfa-perms.pdf`: /XFA and /Perms removed.

Owner opens each in Acrobat: are the values shown, does Acrobat warn about extended
features or a changed document, and does Save in Acrobat keep the values.
