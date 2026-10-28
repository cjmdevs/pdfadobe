# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 5 (redaction) done: owner check passed 2026-10-28**, tagged `phase-05-done`
  (`docs/testing/phase-05-test-guide.md`). On the
  build PC: `npm run check` (376 Vitest + 1 intended skip, 44 Rust, license-check),
  124 Playwright (one Phase 4 connector test flaked once under load, 3/3 alone).
  GitHub Actions `redaction` workflow green.
- **Phase 4 stages 1-3 + fixes: owner check passed 2026-10-27** (combined run A-J and
  `docs/testing/phase-04-fixes-test-guide.md`). Stage 4 (PDFlyer marks in old
  workpapers) waits for a synthetic PDFlyer sample in `tests/corpus/pdflyer/`; after it,
  tag `phase-04-done`.
- **B3 Edit PDF, stage 1 done: owner check passed 2026-10-27** (all 11 steps of
  `docs/testing/b3-stage1-test-guide.md`, including the Acrobat check and firm fonts
  offline via `\\localhost`). On the build PC:
  117/117 Playwright at the time. Stage 2 (mixed styles, spacing, kerning, push-down) not started.
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
- **Phase 4** (spec `docs/phases/phase-04.md`): tickmarks drawn with pdf-lib as /Stamp
  (`src/engine/flyer/tickmarks.ts`), library built-in < firm < personal
  (`src/flyer/library.ts`), tags in EmbedPDF custom data (`pwType`, not `/PWType`);
  sections and letter/number picks (`src/flyer/sections.ts`), matching letters linked by
  /Link with /IRT (`src/flyer/tickLinks.ts`). Connectors are /Line with `pwFrom`/`pwTo`,
  re-routed by FlyerOverlay; cross-page ends are "p. N" markers + /Link. Sign-off stamps
  (`userStamps.ts`) and workpaper notes (free-text clone). Calculator (`src/flyer/calc.ts`,
  10-key + standard), amounts from PDFium chars (`engine/flyer/numbers.ts`), foot /
  cross-foot, tape as /Stamp (`pwTape`; Update tape makes a new annotation).
  Deviations: same-page connectors attach only in our app; items repeat until Esc; notes
  are visible text boxes; standard calculator has no precedence.

## Phase 5: redaction (2026-10-27)

Engine `src/engine/redact/` (Node-safe; worker ops `redactSearch`, `redactPageMarks`,
`redactApply`, `sanitize`). Pre-check: area redaction over a scan overwrites the image
pixels in the stream (`tests/redaction/scanned-area.test.ts`). Pipeline
(`redactDocument`): `apply.ts` (PDFium `EPDFText_RedactInQuads` removes text, also in
form XObjects, covered vectors and pixels; we remove covered images/shadings, give
partly covered images a private stream first (GetBitmap/SetBitmap: a shared stream
drawn elsewhere lost pixels too), clip partly covered paths (owner choice A: fills
Sutherland-Hodgman on 4 strips, strokes split exactly, dash phase kept), draw the
overlay into content) -> `objects.ts` (qpdf JSON: annotations touching a box, /Redact
marks, whole fields with every widget, /Fields, /Kids, /CO; inline annotations too) ->
`sanitize.ts` scrub (XMP, thumbnails, XFA, /Info and tagged text holding a redacted
string) -> optional Sanitize -> qpdf full rewrite (`--object-streams=generate
--remove-unreferenced-resources=yes`) -> `leak.ts` (PDFium page text, raw + qpdf-decoded
bytes in 6 encodings, render of each box); any hit throws `RedactionLeakError` (hits
name pages, never text). Patterns in `patterns.ts`. UI `src/ui/redact/`: tool `redact`
(Draw Box, Mark Text, Mark Page, Apply, Sanitize), panel (Search & Redact, review,
overlay, Apply, Sanitize). Marks are /Redact annotations; accepted state and found
text live in memory only. Output: `<name>_Redacted.pdf` / `_Sanitized.pdf` via
`writeNewFile`, opened in a new tab. Leak suite `tests/redaction/leak-suite.test.ts`
over `LEAK_FILES` + the SSN fixture (pdf.js, qpdf, Tesseract OCR psm 6 + 11); CI
`.github/workflows/redaction.yml`; `.githooks/pre-push` (enable with
`git config core.hooksPath .githooks`). All six Phase 0 `it.fails` pins now pass.

Deviations: account numbers and dates of birth match only after a label; added an
"Any date" pattern (off); ITINs are also caught by the SSN pattern; Apply drops XMP whole;
Sanitize's hidden text includes OCR layers; leak secrets are search hits plus 6+ digit
runs under boxes (plain words are not checked); Apply/Sanitize show their own progress
(no shared busy wrapper). No confirm dialog before Apply (nothing is overwritten).

Owner check 2026-10-28: all steps passed. Step 9 first failed because the app never
drew form fields (render plugin `withForms` defaulted to false): now on in `App.tsx`.
Owner: the Redact panel looks ugly and is a little confusing; redesign later.

Known gaps: paths inside form XObjects partly under a box are removed whole (PDFium
cannot insert into a form; reported); clipped paths lose blend mode and spot colours
(RGB); the in-app leak scan has no OCR (the suite does); scans need OCR or Draw Box
(search cannot see pixels); bookmark titles holding a redacted string make Apply refuse
(no bookmark scrub); embedded index location (/PieceInfo) assumed from Acrobat
practice, not verified in a spec; encrypted files cannot be redacted (no bytes).

## Dependency versions and licenses

Earlier phases: `docs/spike-report.md` and git history of this file. Phase 3: EmbedPDF
annotation/history 2.15.1 (MIT), pdf-lib 1.17.1 runtime (MIT), fast-xml-parser 5.11.2
(MIT). **B3: harfbuzzjs 1.6.4 runtime (MIT; HarfBuzz "Old MIT", owner-approved
2026-10-26)**; dev-only @pdf-lib/fontkit 1.1.1 (MIT) for spike samples. No new crates.
Phase 4 stage 1: no new dependencies (four more Fluent icons from the existing package).
Phase 5: no new npm or crate dependencies. Test/CI only: Tesseract OCR 5.4.0 (Apache-2.0;
build PC via winget `UB-Mannheim.TesseractOCR`, CI via choco), qpdf 12.4.2 (Apache-2.0,
already vendored).

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
