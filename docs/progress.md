# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 4 stage 1 (tickmarks) built 2026-10-27, waiting for the owner check**
  (`docs/testing/phase-04-stage1-test-guide.md`). `npm run check` (300 Vitest + 6
  expected-fail, Rust, license-check), 118/118 Playwright. Stages 2-4 not started; stage 4
  (PDFlyer marks) waits for a synthetic PDFlyer sample in `tests/corpus/pdflyer/`.
- **B3 Edit PDF, stage 1 done: owner check passed 2026-10-27** (all 11 steps of
  `docs/testing/b3-stage1-test-guide.md`, including the Acrobat check and firm fonts
  offline via `\\localhost`). On the build PC:
  `npm run check` (296 Vitest + 6 expected-fail redaction pins, 44 Rust, license-check),
  117/117 Playwright. Stage 2 (mixed styles, spacing, kerning, push-down) not started.
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

## B3 Edit PDF, stage 1 (2026-10-26)

Spike: `docs/edit-spike-report.md` (incl. step 0 on `tests/corpus/edit/real-format/`:
6 synthetic tax-software-style pages, standard 14 fonts not embedded).

Engine, `src/engine/edit/` (Node-safe; runs in the page worker):

- `chars.ts` / `group.ts`: PDFium chars (size scaled by the char matrix: `Tf 1` + Tm)
  grouped into boxes and paragraphs; dot leaders, typed `----` rules and lone amounts
  stand alone. `pageInfo.ts`: boxes, styles and images as plain data for the UI.
- `split.ts`: `removeBoxText` rewrites the parts of text objects shared with other boxes
  (glyph positions verified, per-glyph fallback), as a commit/rollback transaction.
- `retypeset.ts` / `typeset.ts`: one style per paragraph (font, size, colour, real or
  simulated bold/italic, underline as a filled rect, alignment, line spacing); one-line
  boxes grow, a set width wraps; every letter read back (U+0000/U+FFFD refused) before
  anything is final; fonts without a space glyph get words written apart; overflow into
  other text/rules reported, never pushed down. `document.ts`: bytes-in/bytes-out edits
  by box/image id with a stale check.
- `fonts/`: own sfnt reader (names, OS/2 fsType, cmap 4/12, hmtx), HarfBuzz subsetting
  (`harfbuzz-subset.wasm` only, bytes injected), subsets renamed `ABCDEF+Name` via the
  name table before PDFium loads them; font index cache (path/size/mtime), metric twins
  for the standard 14, ranked proposals, real bold/italic faces.
- `images.ts`: add/move/resize/rotate/replace/delete; JPEG via LoadJpegFileInline
  (byte-identical), PNG via our decoder (PDFium stores Flate + SMask).

Host: Rust `fonts.rs` lists Windows, user and firm fonts; the firm share is mirrored to
`<config>\font-cache\firm\` and listed from there (offline-safe); `font_read` serves only
font files in those folders. Setting `firmFontsPath`.

UI, `src/ui/edit/` (registry tool `edit`, panel slot now rendered by the Tools pane):
outlines, click-to-edit textarea in the closest browser font (exact result on commit:
Esc, click elsewhere, Ctrl+S/W/P/Q), Add Text (click / drag width), Format panel (font
picker: this document / standard / firm / Windows, with warnings), image handles, Add
Image, Replace, Delete key, right-edge width handle, overflow note. Every change is one
`wb.edit` undo step; the edited item is selected again after the tab reloads (keyed by
store id: revisions reopen under new document ids).

Deviations: a fourth font group "Standard PDF fonts (not embedded)" (default for new
text; common in tax output). Line spacing is set in points (no presets). Corner resize
keeps proportions by default (Shift: free). Text over an image wins the click.

## Phase 4 stage 1: tickmarks (2026-10-27)

Spec and owner decisions: `docs/phases/phase-04.md`. Engine `src/engine/flyer/tickmarks.ts`
(Node-safe): 14 firm tickmarks + counting letters/numbers drawn with pdf-lib as one-page
PDFs that become /Stamp appearances; image tickmarks; legend box. `src/flyer/library.ts`:
built-in < firm file < personal (same id replaces), workpaper settings JSON
(`format: "pdf-workbench-workpaper"`), Recent. `src/flyer/items.ts`: tags, Stamp Summary
rows, CSV (formula-safe, UTF-8 BOM). UI `src/ui/flyer/`: registry tool `flyer` (Tickmark

- library dropdown, Recent with Clear Recent Stamps, Palette, Legend, Library dialog,
  Export CSV), page layer in mode `workpaperPlace` (place until Esc; 1-9 pick from the
  palette), Stamp Summary as the tool's panel. Shell: toolbar actions can now have dropdowns
  (`items`, `menuOnly`), also on the quick toolbar. Settings: `tickmarks`,
  `firmTickmarksPath`/`Cache` (read at start like the firm layout), `recentTickmarks`,
  `activeTickmark`, `tickmarkPaletteOpen`. File dialogs gained JSON/CSV filters.

Deviations: our tag is not a `/PWType` name key: EmbedPDF can only write its custom data,
stored as the string `/EPDFCustom` = `{"pwType":"Tickmark","pwTick":"footed",...}`; Subject
is `Tickmark: Footed`, Contents the meaning. Counting tickmarks continue from the highest
value already in the document (no separate counter). Legend is a box, not a page. The 14
symbols are our own guesses from the names (owner reviews at the check).

## Dependency versions and licenses

Earlier phases: `docs/spike-report.md` and git history of this file. Phase 3: EmbedPDF
annotation/history 2.15.1 (MIT), pdf-lib 1.17.1 runtime (MIT), fast-xml-parser 5.11.2
(MIT). **B3: harfbuzzjs 1.6.4 runtime (MIT; HarfBuzz "Old MIT", owner-approved
2026-10-26)**; dev-only @pdf-lib/fontkit 1.1.1 (MIT) for spike samples. No new crates.
Phase 4 stage 1: no new dependencies (four more Fluent icons from the existing package).

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
