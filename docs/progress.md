# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 6 (forms) done: owner check passed 2026-10-28**, tagged `phase-06-done`
  (`docs/testing/phase-06-test-guide.md`; steps 2 and 9 rechecked after the fixes). XFA
  decided 2026-10-28: Save, Save As and Fill from CSV strip a hybrid form's XFA twin and
  /Perms (`bytesForSave`). On the build PC: `npm run check` (475 Vitest + 1 intended
  skip, 47 Rust, license-check), 147 Playwright.
- **Phase 5 (redaction) done: owner check passed 2026-10-28**, tagged `phase-05-done`.
- **Phase 4 stages 1-3 + fixes: owner check passed 2026-10-27** (combined run A-J and
  `docs/testing/phase-04-fixes-test-guide.md`). Stage 4 (PDFlyer marks in old
  workpapers) built in B6 (sample generated as `tests/corpus/generated/pdflyer-sample.pdf`
  rather than kept in `tests/corpus/pdflyer/`); tag `phase-04-done` after its owner check.
- **B3 Edit PDF, stage 1 done: owner check passed 2026-10-27** (all 11 steps of
  `docs/testing/b3-stage1-test-guide.md`, including the Acrobat check and firm fonts
  offline via `\\localhost`). On the build PC:
  117/117 Playwright at the time.
- **B6 parity pass (plan approved 2026-10-30): built, owner check pending**
  (`docs/testing/b6-parity-test-guide.md`). Owner sample decoded: PDFlyer tickmarks are
  /Stamp with Subject `Category:Item` ("Letter Connectors:A", "Connectors:2",
  "Engagement:Agrees to"), /Name `#V3JpdHRlbiBCeSBOYW4u` (base64 "Written By Nan."), a
  closed /Popup, 100x100 form AP. Tape is /FreeText `Calculator Tape:PDFlyer`, custom
  /TapeData rows `[section, note, amount, op, decimals]`, Courier New 9 pt, grey,
  /F 516. Sticky notes are /FreeText `Sticky Note:` with /NoteData, placed below the page.
  Built: (1) Stamp Summary lists PDFlyer marks, Acrobat stamps and text boxes
  (`foreignItem`), off-page items flagged; synthetic `pdflyer-sample.pdf` (generator,
  not committed). This is Phase 4 stage 4: tag `phase-04-done` after the owner check.
  (2) Our tickmarks use PDFlyer's subjects; Save adds PDFlyer's /Name and a popup with
  qpdf (`engine/flyer/pdflyer.ts`, also drops orphan popups). (3) Tape is PDFlyer's grey
  free text (Acrobat lists it as text), /TapeData on save, updated in place; a PDFlyer
  tape opens in our calculator (parsed from its text). (4) Calculator laid out key for
  key as PDFlyer's 10 Key Calculator: tape grid by section, seven-segment display,
  memory, decimals 0-4/F, New Tape (= next section), +/-, %, Add Line (non-add), Date
  Time, -= and += (finish x or /), Delete Line (totals worked out again), GT, ◇
  (subtotal), * (total), 000. (5) Stamp tool like Acrobat's: Stamp menu (last stamp,
  favorites, Dynamic / Sign Here / Standard Business / custom categories as submenus,
  Show Stamp Names, Paste Clipboard Image), Stamps Palette, Custom Stamps (create from a
  file or the clipboard with a category; rename, recategorise, delete). Dynamic stamps
  print user and time. Our own artwork. (6) Customize Quick Tools like Acrobat's (icon
  strip, divider, move, delete, tool tree, Save greyed until a change). (7) Comments
  panel: "N comments", search, sort, filter popover, options menu, Acrobat-style rows.
  **Deviations:** the PDFlyer user guide was not in `docs/reference`, so ◇ = subtotal
  and * = total is a guess from printing calculators (owner approved); New Tape starts
  a section on the same tape; subtotal prints "S" on the PDF (◇ is not in the standard
  fonts); tickmark art stays our size (not 100x100); the sample PDF stays out of git (it
  has a real-looking name). Not verified: that PDFlyer accepts our tickmarks and tapes
  (needs a coworker on PDFlyer); clipboard reading in the installed WebView2.
  No new dependencies.
- **B6 owner check 2026-10-31:** steps 2-9 passed. Step 1: the 8 seen was the synthetic
  file (the real sample lists 35 in tests). Added: a selected letter/number tickmark
  (PDFlyer's or ours, same Subject) rings the matching ones on the page and offers "Go
  to the next C (1 of 3; page N)". Re-check: `docs/testing/b6-fixes-test-guide.md`.
  e2e: save-and-read tests now poll the saved file (Ctrl+S sometimes had not written it
  yet; flaky before B6 too).
  Re-check: our own placed letters could not be clicked (their /Link to the next match
  sat over them and took the click). Those links are no longer click targets in our app
  (`TickLinkRenderer.tsx`, hidden while links are locked); they stay in the file.
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

## Phase 6: forms (2026-10-27/28)

Spike `docs/forms-spike-report.md`: PDFium creates text/checkbox/radio/dropdown fields
(not signatures); the WASM has no JavaScript, so calculations never run by themselves.
Engine `src/engine/forms/` (Node-safe, worker ops in `src/app/pagesWorker.ts`):
`fields.ts` (read; button values use the /Opt label), `fill.ts` (fill by name through
PDFium's form-fill path; misfits skipped and reported, never altered), `xfa.ts`
(`formKind`, strip/keep), `reset.ts` (Reset/Clear: text + choices via PDFium, buttons via
qpdf; a cleared dropdown gets its AP text block emptied), `data.ts` (FDF via pdf-lib's
parser, XFDF, JSON, CSV), `batch.ts` (one copy per CSV row), `flatten.ts` (buttons'
/AP /N pointed at the current state, widgets drawn backwards, /OBJR links cut, full
rewrite), `design.ts` (add fields, properties, orphan-field cleanup), `detect.ts`,
`calc.ts` + `calcSetup.ts` (AFSimple_Calculate, simplified field notation, /CO order,
AFNumber_Format; /V plain, appearance formatted). UI `src/ui/forms/`: fill mode via
`@embedpdf/plugin-form` with our own `TextFill` (writes once on leave: the plugin's
per-keystroke writes raced and lost characters); tools Fill Forms and Prepare Form;
XFA-only notice with Open in Acrobat (`src-tauri/src/acrobat.rs`). Corpus:
`xfa-only.pdf`, `flat-form.pdf`, `calc-form.pdf`.

Deviations: fill UI uses the form plugin (owner: "do what you think is best"); read-only
fields are skipped by fill, import, Reset and Clear; an empty CSV cell leaves its field
alone; import cannot empty a radio group (Reset can); signature fields are placeholders
(no signing); custom calculation scripts never run (listed as "calculated in Acrobat
only"); max length is written on the field and mirrored on its widget (EmbedPDF reads
the widget); file names from a CSV column refuse SSN/EIN columns.

Owner check 2026-10-28: steps 2-11 passed. Step 1 (XFA): Acrobat showed the AcroForm
values in all three samples ("SP" for SPIKE 3 is the narrow middle-initial box). Owner
left the choice to us: strip (the XFA twin keeps a stale copy of the data; our save has
broken /UR3 anyway; page operations already strip both). Fixed after the check: a deleted field left its picture behind
(fields were also baked into the page tiles: render `withForms` is now false, the form
plugin draws every field); signature fields were invisible and could not be selected
(own renderer, `SignatureBox.tsx`); a number field with a max length showed its
formatted text cut ("12,34": the plain number is kept when the formatted text would not
fit); the corpus Notes field asked for 69 pt text (now 10 pt; automatic size wraps at
12 pt); a field deleted while a push was running stayed in the field tree.

Known gaps: a saved IRS form loses its XFA twin and Reader-extension rights (by design,
above); a live recalculation is one
undo step per changed calculated field; date formats are written for Acrobat but not
applied or validated here (numbers are); keystroke filters are not enforced; the undo
label says "Markup" for form edits too; a flattened dropdown keeps its arrow; multiline
values store CR LF; Detect fields knows blanks, lines and boxes only (no comb boxes or
table cells).

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
