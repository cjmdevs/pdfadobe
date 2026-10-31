# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 8 (signatures, certificates, security) built 2026-10-31, owner check pending**
  (`docs/testing/phase-08-test-guide.md`). Spec and decisions in `docs/phases/phase-08.md`.
  On the build PC: `npm run check` (595 Vitest + 1 intended skip, 61 Rust,
  license-check), 190 Playwright. Details in "Phase 8" below.
- **Phase 7 (scan, OCR, optimize, document tools, conversions) done 2026-10-31**, tagged
  `phase-07-done`. Lesson: anything that hands a resource path to an outside program
  must be tested with a `\\?\` path (Tauri canonicalises the app path).
- **Phase 6 (forms) done 2026-10-28**, tagged `phase-06-done`. Save, Save As and Fill
  from CSV strip a hybrid form's XFA twin and /Perms (`bytesForSave`).
- **Phase 5 (redaction) done 2026-10-28**, tagged `phase-05-done`.
- **Phase 4 done 2026-10-31**, tagged `phase-04-done` (stage 4 built in B6).
- **B6 parity pass done 2026-10-31** (`docs/testing/b6-fixes-test-guide.md`): PDFlyer
  format decoded from the owner's sample (tickmarks /Stamp `Category:Item`, tape /FreeText
  `Calculator Tape:PDFlyer` with /TapeData, sticky notes /FreeText + /NoteData); our marks
  are written in PDFlyer's format (`engine/flyer/pdflyer.ts`). Not verified: PDFlyer
  reading our marks; clipboard in WebView2.
- **B3 Edit PDF stage 1 done 2026-10-27; stage 2 owner checks in progress.** Still open:
  Shift+right arrow in the installed app (not reproducible in dev or e2e).
- Phases 0-3, B1, B4 done (tags `phase-02-done`, `phase-03-done`).
  Rerun `npm run corpus -- --force` after a manual test saves over generated files.

## Phase log (summary)

- **Phase 0**: Tauri 2 + React 19 + TS strict + Vite; `npm run check`; SPDX license
  check; synthetic corpus; `src/engine` (Node-safe PDFium). Redaction gaps pinned.
- **Phase 1**: viewer on EmbedPDF plugins; Rust file IO with classified errors, "Open
  with", qpdf "Repair a copy", native printing.
- **Phase 2**: `src/engine/pages` (qpdf for page add/remove/reorder, PDFium for rotate/
  crop/size/blank/bookmarks, own writer for image pages); page-engine Web Worker;
  whole-file undo snapshots; Save = temp + `.bak` + read back.
- **B4 / B1**: tool registry drives the Tools pane, tool toolbars and the quick toolbar;
  documents live in the Rust store, tabs move between windows.
- **Phase 3 (markup)**: EmbedPDF annotation + history plugins (2.15.1); all comment
  tools, own eraser, stamps (built-in drawn with pdf-lib, custom images in the config
  folder), properties bar, comments panel (threads, review states), flatten to a new
  file, XFDF export/import, comment summary PDF. Markup undo steps first, then one
  "Markup" store revision before any page operation/save. Deviations: free text uses
  standard PDF fonts only; XFDF import is one undo step per comment.

## Earlier detail (summary; full text in git history of this file)

- **B3 Edit PDF stage 1**: `src/engine/edit/` (PDFium chars -> boxes/paragraphs, one
  style per paragraph retypeset and read back, own sfnt reader + HarfBuzz subsetting,
  images add/move/resize/replace/delete); host `fonts.rs` (Windows/user/firm fonts,
  firm share mirrored to `<config>\font-cache\firm\`); UI `src/ui/edit/`, each change one
  `wb.edit` undo step. Spike: `docs/edit-spike-report.md`.
- **Phase 4** (spec `docs/phases/phase-04.md`): tickmarks as /Stamp (pdf-lib), library
  built-in < firm < personal, tags in EmbedPDF custom data (`pwType`); letter/number
  picks linked by /Link + /IRT; connectors are /Line (`pwFrom`/`pwTo`), cross-page ends
  "p. N" markers; sign-off stamps, workpaper notes; calculator (10-key + standard,
  foot / cross-foot, tape as /Stamp `pwTape`). Deviations: same-page connectors attach
  only in our app; items repeat until Esc; standard calculator has no precedence.
- **Phase 5 (redaction)**: `src/engine/redact/` pipeline: PDFium redact text/vectors/
  pixels (`apply.ts`), qpdf object edits (annotations, whole fields, `objects.ts`), scrub
  (XMP, XFA, /Info, tagged text, `sanitize.ts`), optional Sanitize, qpdf full rewrite,
  leak scan (`leak.ts`, throws `RedactionLeakError`). UI `src/ui/redact/`; output
  `_Redacted.pdf` / `_Sanitized.pdf`. Leak suite + CI workflow + `.githooks/pre-push`.
  Owner: the Redact panel looks ugly and is a little confusing; redesign later. Gaps:
  form XObject paths partly under a box removed whole; clipped paths lose blend/spot
  colours; in-app leak scan has no OCR; bookmark titles with a redacted string refuse.

- **Phase 6 (forms)**: spike `docs/forms-spike-report.md` (PDFium creates text/check/
  radio/dropdown fields, not signatures; no JavaScript in the WASM). `src/engine/forms/`
  (fields, fill by name, XFA strip, Reset/Clear, FDF/XFDF/JSON/CSV, one copy per CSV
  row, flatten, design, detect, AFSimple_Calculate + AFNumber_Format). UI `src/ui/forms/`
  on `@embedpdf/plugin-form` with our own `TextFill`. Deviations: read-only fields
  skipped by fill/import/Reset; empty CSV cell leaves the field; signature fields are
  placeholders; custom calc scripts never run. Gaps: saved IRS forms lose XFA and /UR3
  (by design); recalculation is one undo step per field; date formats not validated;
  keystroke filters not enforced; Detect knows blanks, lines and boxes only.

## Phase 8: signatures, certificates, security (2026-10-31)

Plan approved 2026-10-31 with the recommended answers (`docs/phases/phase-08.md`).

- **Certificate signing** (`src/engine/sign/`, Node-safe): no @signpdf. Own incremental
  update writer (`incremental.ts`: objects from qpdf JSON v2 written back as PDF syntax;
  xref table or uncompressed xref stream, matching the original). An unsigned file is
  first rewritten by qpdf (repairs damage); a signed one is only appended to, so earlier
  signatures stay valid. CMS by pkijs (`cms.ts`): detached, SHA-256, signed attributes
  contentType, messageDigest, signing-certificate-v2; no signing-time (PAdES puts it in
  /M). /SubFilter /ETSI.CAdES.detached; 24 KB reserved for /Contents. Visible signature:
  a form XObject in the page's displayed orientation (`/Matrix` from the page frame;
  `frameOf` is the qpdf-object twin of `pageFrames`), Helvetica details plus the name or
  a saved signature image. Empty signature fields can be signed. Output `<name>_Signed.pdf`.
- **Keys** (`src-tauri/src/certsign.rs`): the private key never leaves Windows. CNG signs
  (BCryptHash + NCryptSignHash; RSA PKCS#1 v1.5 or ECDSA r||s). Store: Personal,
  certificates with a key, valid today, key usage allowing signing. .pfx:
  PFXImportCertStore with PKCS12_NO_PERSIST_KEY (memory only); that key is found only
  with CRYPT_ACQUIRE_CACHE_FLAG. The frontend passes the .pfx and password per call.
- **Signatures panel** (Certificates tool): scans /ByteRange, checks digest and
  signature with pkijs, says "changed after this signature" when bytes follow the signed
  revision, and opens the signed version. No trust check (v1).
- **Saved signatures** (`signatures.rs`): PNG, DPAPI (current user, own entropy) in
  `<config>\signatures\<id>.sig`. Typed (Dancing Script, Great Vibes, Allura, Caveat),
  drawn (pen pressure), or an image (paper made see-through, cropped).
- **Fill & Sign tool**: Text (borderless free text, tool `fillText`), Check, X, Dot,
  Date, Sign (saved signature or initials, optional date under it). Marks are stamps with
  a one-page PDF appearance (`engine/sign/marks.ts`), movable and resizable.
- **Protect tool** (`src/engine/security.ts`): AES-256 (R6) only; open and/or
  permissions password; print, changes, copy. Remove Security with either password.
  Output `<name>_Protected.pdf` / `_Unprotected.pdf`. Passwords reach qpdf in a job file
  (`--job-json-file`), never its command line; both runners allow only the job-file keys
  inputFile, outputFile, password, decrypt, encrypt, showEncryption, with plain job names.
- Signature fields: empty ones say "Click to sign" (opens Sign with a Certificate);
  fields with an appearance (signed) now show it, with a see-through click box on top.

**Deviations:** no @signpdf (decision 1). No timestamp server, so PAdES B-B only, no
LTV. Signing a password-protected file is refused (remove security first). Protect
writes a new file instead of changing the open one. Remove Security also accepts the
open password (qpdf needs only that; Acrobat asks for the permissions password). The
Signatures panel cannot check a password-protected file. The browser build signs with a
throwaway WebCrypto certificate ("Browser Test Signer") for e2e; .pfx only in the
Windows app. Every tool is built now, so "Show tools that are coming later" adds nothing.
**Not verified yet:** Acrobat calling our signatures valid (owner check); signing with a
Windows store certificate in the installed app (Rust tests cover .pfx signing via CNG,
checked by OpenSSL, and listing the store); smart-card PIN prompts.

## Earlier detail: Phase 7 (summary)

Tesseract 5.5.4 + Leptonica 1.87.0 + zlib built from source (`scripts/build-tesseract.mjs`,
needs the VS C++ workload) and bundled; OCR runs on a straightened copy and its text is
grafted back (`pages/graft.ts`, `/PWDecor` tags; not qpdf --overlay). Enhance, batch OCR,
Optimize (Email/Standard/Archive), Header & Footer, Bates, Watermark, Background (14
standard fonts only), Export PNG/JPEG/text, Create PDF from images. Remove only finds
what PDF Workbench added.

## Dependency versions and licenses

Earlier phases: `docs/spike-report.md` and git history of this file. Phase 3: EmbedPDF
annotation/history 2.15.1 (MIT), pdf-lib 1.17.1 runtime (MIT), fast-xml-parser 5.11.2
(MIT). **B3: harfbuzzjs 1.6.4 runtime (MIT; HarfBuzz "Old MIT", owner-approved
2026-10-26)**; dev-only @pdf-lib/fontkit 1.1.1 (MIT) for spike samples. No new crates.
Phase 4 stage 1: no new dependencies (four more Fluent icons from the existing package).
Phase 5: no new npm or crate dependencies. Test/CI only: Tesseract OCR 5.4.0 (Apache-2.0;
build PC via winget `UB-Mannheim.TesseractOCR`, CI via choco), qpdf 12.4.2 (Apache-2.0,
already vendored). **Phase 6: @embedpdf/plugin-form 2.15.1 runtime (MIT; its package.json
has no license field, so `license-policy.json` records the LICENSE file).** No new crates:
the `windows` crate gains its `Win32_System_Registry` feature (Open in Acrobat).
**Phase 7: jpeg-js 0.4.4 runtime (BSD-3-Clause).** Bundled sidecar, built from source:
Tesseract 5.5.4 (Apache-2.0), Leptonica 1.87.0 (BSD-2-Clause), zlib 1.3.1 (Zlib),
tessdata 4.1.0 eng/osd (Apache-2.0). Noto Sans (OFL-1.1, from `@embedpdf/fonts-latin`)
is used by a test only. No new crates.
**Phase 8: pkijs 3.4.3 runtime (BSD-3-Clause) with asn1js 3.1.0 and bytestreamjs 2.0.1
(BSD-3-Clause), pvtsutils 1.3.6, pvutils 1.2.0, @noble/hashes 1.8.0 (MIT), tslib 2.9.1
(0BSD); @fontsource/dancing-script, great-vibes, allura, caveat 5.3.0 (OFL-1.1, fonts
bundled unmodified).** No new crates: the `windows` crate gains `Win32_Security_Cryptography`
and `Win32_System_Time`. Test only: OpenSSL from Git for Windows (Apache-2.0) checks
signatures when present.

## Known gaps / notes for later phases

- **Edit PDF:** a hard line break after a box's widest line reads back as a wrap (PDFs
  keep no paragraph marks); centred/right multi-line text does not group as one box;
  bullet hanging indents and Tz (horizontal scaling) are not kept; fonts with CFF
  outlines can't be embedded; a refusal after a font was loaded can leave an unused
  font object; overlap tests use baseline geometry; no resize/rotate cursors on handles.
  Firm share mirroring tested on local folders only: real share deferred to Phase 10.
- Markup: XFDF does not carry stamp appearances (built-in stamps are redrawn on import).
- Coordinates (XFDF, summary markers, Edit PDF) assume the crop box starts at 0,0.
- After a page edit the tab reopens (zoom re-fit ~150 ms later; `idle()` in e2e).
- Memory: ~4x file size per open scan, undo up to 400 MB per document.
- Playwright: the first run after adding a dependency may fail while Vite re-optimizes.
- Keep document-bound UI inside a `Guard`; extra windows never save view settings.
- A tab's document id changes with every edit: key per-document UI state by `storeId`.
- Form widgets are locked (fill mode) except while Prepare Form is open (`FormMode.tsx`).
- **Phase 7:** OCR is English only; pages with 20+ characters count as "has text" (a
  Bates stamp alone does not). Straighten Pages does not turn comments with the page.
  Optimize leaves black-and-white, CMYK, indexed and JPEG 2000 images alone and does not
  subset simple TrueType, Type 1 or CFF fonts. Optimize, Export and Create PDF cannot be
  cancelled (OCR can). Watermark offsets (dx, dy) exist in the engine, not in the dialog.
  Build PC needs the VS C++ workload for `npm run build-tesseract`.
- **Phase 8:** saving markup on a signed file rewrites it (PDFium), which breaks the
  signature (the "digitally signed" warning covers page changes only): sign last, or
  sign again. The signature's text is Helvetica (WinAnsi; other characters print as "?").
  24 KB is reserved for the CMS: very long certificate chains are refused. The signature
  box assumes the crop box starts at 0,0, like the rest of the app.
- e2e flakes seen in Phase 7 and 8, all passing alone (Edit PDF list spacing too): Edit PDF "Shift+arrow pressed while
  the last move is saving" (also fails without Phase 7) and the Stamp menu save check.
