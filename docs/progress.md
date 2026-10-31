# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 7 (scan, OCR, optimize, document tools, conversions) done: owner check passed
  2026-10-31**, tagged `phase-07-done` (`docs/testing/phase-07-test-guide.md`, then
  `phase-07-fixes-test-guide.md` all 6 steps). Spec and decisions in
  `docs/phases/phase-07.md`. On the build PC: `npm run check` (580 Vitest + 1 intended
  skip, 55 Rust, license-check), 184 Playwright. Details in "Phase 7" below.
- **Phase 7 owner check 2026-10-31:** 5, 6, 7 and 9 passed; 8 passed (background hard to
  see). Every Tesseract step failed in the installed app: Tauri canonicalises the app
  path, so the resource folder is `\\?\C:\...`, and Tesseract cannot open tessdata
  under a verbatim path. Fixed (`plain_path` in `ocr_job.rs`); failures now carry
  Tesseract's setup error line; Turn Upright no longer hides a broken Tesseract as
  "upright"; background default is pale yellow. Re-check
  passed 2026-10-31. Lesson: anything that hands a resource
  path to an outside program must be tested with a `\\?\` path.
- **Phase 6 (forms) done 2026-10-28**, tagged `phase-06-done`. Save, Save As and Fill
  from CSV strip a hybrid form's XFA twin and /Perms (`bytesForSave`).
- **Phase 5 (redaction) done 2026-10-28**, tagged `phase-05-done`.
- **Phase 4 stages 1-3 + fixes done 2026-10-27.** Stage 4 (PDFlyer marks in old
  workpapers) was built in B6; tag `phase-04-done` after B6's re-check.
- **B3 Edit PDF stage 1 done 2026-10-27** (`docs/testing/b3-stage1-test-guide.md`).
- **B6 parity pass: owner check 2026-10-31 passed steps 2-9; re-check of the letter
  tickmark fixes pending** (`docs/testing/b6-fixes-test-guide.md`). PDFlyer format
  (decoded from the owner's sample): tickmarks are /Stamp, Subject `Category:Item`
  ("Letter Connectors:A"), /Name `#V3JpdHRlbiBCeSBOYW4u`, closed /Popup, 100x100 AP;
  tape is /FreeText `Calculator Tape:PDFlyer` with /TapeData rows `[section, note,
  amount, op, decimals]`, Courier New 9 pt grey, /F 516; sticky notes /FreeText `Sticky
  Note:` + /NoteData. Built: Stamp Summary of foreign marks, our tickmarks/tapes in
  PDFlyer's format (`engine/flyer/pdflyer.ts`), PDFlyer-style 10-key calculator,
  Acrobat-style Stamp menu/palette/custom stamps, Customize Quick Tools, Comments panel,
  matching-letter rings with "Go to the next C". Deviations: ◇ = subtotal, * = total
  (guess, owner approved); subtotal prints "S"; tickmark art keeps our size; the sample
  PDF stays out of git. Not verified: PDFlyer reading our marks; clipboard in WebView2.
- **B3 Edit PDF stage 2 (2026-10-28/30), owner checks in progress:** paragraph grouping
  (indents, lists, alignment; Join / Split; `/PWBox` marked content keeps box ids), text
  box controls (move, handles, X/Y/W/H, auto-fit, push text below), Acrobat-like Format
  panel (own `Tc`/`TJ` writer, HarfBuzz kerning), Objects panel (flip, crop removes
  pixels, rotate, replace, arrange, align, Edit Using), Edit toolbar (Link, Crop Pages,
  Phase 7 slots). Two fix rounds after the owner check
  (`docs/testing/b3-stage2-fixes-test-guide.md`, `...-fixes2-test-guide.md`): editor
  draws real fonts and list markers, link boxes locked and clickable, Join keeps
  layout. Still open: Shift+→ in the installed app (not reproducible in dev or e2e).
  Deviations: auto-fit, fixed height and padding are app-only; paste is plain text;
  horizontal scaling is not previewed while typing.
- Phase 3 (markup) done: owner check passed 2026-10-27, tagged `phase-03-done`.
- Phase 2 + B4 + B1 done, tagged `phase-02-done`.
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

## Phase 7: scan, OCR, optimize, document tools, conversions (2026-10-31)

Plan approved 2026-10-31 with the recommended answers (`docs/phases/phase-07.md`).

- **OCR sidecar**: `scripts/build-tesseract.mjs` builds Tesseract 5.5.4 + Leptonica
  1.87.0 + zlib 1.3.1 with the VS C++ toolchain (static CRT, one `tesseract.exe`, needs
  only KERNEL32) into `src-tauri/vendor/tesseract/` (git-ignored, bundled as a Tauri
  resource) with tessdata 4.1.0 `eng` + `osd` and `pdf.ttf`, pinned by SHA-256. No image
  libraries: pages go in as PGM. CI builds it (cached). Rust `ocr_job.rs`: `ocr_run` /
  `ocr_cancel`, qpdf-style job folders, allowlisted arguments, no config files.
- **Recognize Text** (`src/engine/ocr/`): skip pages with 20+ characters of text; render
  at 300 dpi as displayed; OSD for quarter turns, own projection-profile skew estimate;
  OCR a straightened copy into Tesseract's text-only PDF; place it back with the inverse
  turn. Runs in the page worker (progress + cancel messages; Tesseract jobs go through
  the main thread like qpdf). One undo step; "nothing to read" adds no step.
- **Graft, not qpdf --overlay** (`src/engine/pages/graft.ts`): qpdf 12's overlay turns
  the page's own content into a form XObject. Layers are copied in as a form XObject
  with `--update-from-json` plus one extra content stream; the page's streams stay as
  they are. Everything added carries `/PWDecor <kind>` (ocr, header, bates, watermark,
  background) so Remove finds it.
- **Scan & OCR tool**: toolbar like image_5 (Insert, Enhance, Recognize Text, Bates
  Numbering | Extract, rotate, delete). Enhance: Straighten Pages (a rotation wrapped
  around the content, lossless), Turn Pages Upright (OSD, /Rotate), Reduce File Size.
  Recognize Text in a Folder writes `<name>_OCR.pdf` beside each PDF.
- **Optimize** (`src/engine/optimize/`): Email 100 dpi q50, Standard 150 q70, Archive
  300 q85. qpdf decodes images (Flate/LZW/JPEG), we resample and encode JPEG, written back
  in place. Identity-H TrueType fonts subset (HarfBuzz glyph set, retained glyph ids).
  Then unused resources, object streams, flate level 9, linearize unless that makes the
  file bigger than the original. Saved as `<name>_Optimized.pdf`.
- **Document tools** (`src/engine/decorate/`): Header & Footer (six boxes; {page}
  {pages} {date} {file}; standard fonts; margins; page range; start number; saved
  settings in `Settings.headerFooterPresets`), Bates (prefix/start/digits/suffix; several
  files run on and save `_Bates.pdf` copies), Watermark (text or image, opacity,
  rotation, behind/in front, position), Background (colour or image). In the Edit PDF
  toolbar (Header & Footer, Watermark, More > Background / Bates) and Scan & OCR (Bates).
- **Conversions**: Export PDF (PNG/JPEG at 72-600 dpi, `<name>_Page_N`; text as UTF-8
  `.txt` with form feeds between pages); Create PDF from images (files or a folder,
  natural name order, JPEG/PNG/TIFF, optional OCR).

**Deviations:** Tesseract build adds zlib (its PDF writer needs it; Zlib licence).
Headers, Bates and watermarks use the 14 standard PDF fonts only (WinAnsi; other
characters print as "?"), not installed fonts. Remove only finds what PDF Workbench
added, not Acrobat's own headers/watermarks; Acrobat will not list ours in its Header &
Footer > Update. jpeg-js writes three-channel JPEGs, so grey images become RGB JPEGs (a
few percent bigger). Linearizing is skipped when it would grow the file (200-page text
file: +58 KB of hint tables). Images to PDF reused Phase 2's writer (UTIF was already a
dependency, so no new one). Header/footer placement is fixed to the displayed page.
**Not verified yet:** OCR, Optimize and conversions in the installed app (the Rust
runner is unit-tested; e2e runs the same engine in the browser build); how Acrobat
shows our layers and subset fonts (owner check).

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
- e2e flakes seen this phase, both passing alone: Edit PDF "Shift+arrow pressed while
  the last move is saving" (also fails without Phase 7) and the Stamp menu save check.
