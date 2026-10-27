# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 4 owner run 2026-10-27:** A, D-J passed. B and C fixed the same day (letter/
  number tickmarks, sections, Clear Recent, Library tabs), waiting for the owner check
  (`docs/testing/phase-04-fixes-test-guide.md`). `npm run check` (315 Vitest + 6
  expected-fail), 122/122 Playwright. Stage 4 (PDFlyer marks) waits for a synthetic
  PDFlyer sample in `tests/corpus/pdflyer/`; after it, tag `phase-04-done`.
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

## B3 Edit PDF, stage 1 (2026-10-26, summary)

Spike: `docs/edit-spike-report.md`. Engine `src/engine/edit/` (Node-safe, page worker):
PDFium chars grouped into boxes/paragraphs, `removeBoxText` split transaction, one style
per paragraph retypeset with read-back of every letter, own sfnt reader + HarfBuzz
subsetting (`ABCDEF+Name`), font index cache, images add/move/resize/replace/delete.
Host `fonts.rs` lists Windows/user/firm fonts (firm share mirrored to
`<config>\font-cache\firm\`). UI `src/ui/edit/`: outlines, click-to-edit, Add Text/Image,
Format panel, handles; each change is one `wb.edit` undo step. Deviations: fourth font
group "Standard PDF fonts (not embedded)", line spacing in points, corner resize keeps
proportions (Shift: free), text over an image wins the click.

## Phase 4 stage 1: tickmarks (2026-10-27, summary)

Spec and owner decisions: `docs/phases/phase-04.md`. `src/engine/flyer/tickmarks.ts`: 14
firm tickmarks + counting letters/numbers + image tickmarks drawn with pdf-lib as /Stamp
appearances; legend box. `src/flyer/library.ts`: built-in < firm file < personal, the
workpaper settings JSON (`format: "pdf-workbench-workpaper"`). `src/flyer/items.ts`: tags,
Stamp Summary rows, CSV. UI `src/ui/flyer/`: tool `flyer`, toolbar dropdowns (shell now
supports `items`/`menuOnly`), palette (1-9), place until Esc. Deviation: the tag lives in
EmbedPDF's custom data (`/EPDFCustom` JSON, `pwType`), not a `/PWType` name key.

## Phase 4 stage 2: connectors, sign-off stamps, notes (2026-10-27)

Connectors (`src/flyer/connectors.ts`): /Line with styles (arrow, line, double, dashed,
dot-to-arrow), red 1.5 pt, restyled with the Phase 3 properties bar. A click on an
annotation attaches that end (`pwFrom`/`pwTo` = its /NM); FlyerOverlay re-routes attached
lines whenever annotations change (`reroutes()`), ends stop 8 pt short of the target
(EmbedPDF's 20 px line hit area would otherwise swallow clicks on the tickmark). Two pages:
a "p. N" marker /Stamp at each end plus a /Link (GoTo, XYZ) over it, `pwPair`/`pwEnd`;
links follow their marker and go when it is deleted; in our app a selected end offers
"Go to the other end". Sign-off stamps (`src/engine/flyer/userStamps.ts`): Prepared by,
Reviewed by, Final, Initials + own templates (title, color, time, W/P ref, extra fields);
reference and fields asked before placing, name/initials/time fixed at each click.
Notes: EmbedPDF free-text tool clone `workpaperNote` (pale yellow, tagged Note), listed
in a Notes tab next to Stamp Summary. Settings file now carries `stamps` (stage 1 files
still read); settings `stampTemplates`, `firmStampsCache`, `userInitials`,
`connectorStyle`.

Deviations: same-page connectors are attached only in our app (Acrobat sees a plain
line); every workpaper item repeats until Esc (sign-off stamps too); notes are visible
text boxes (not sticky notes) so a reviewer sees them on the page.

## Phase 4 stage 3: calculator tape, foot/cross-foot (2026-10-27)

`src/flyer/calc.ts` (pure): 10-key adding machine (+ - x / = S T, repeat add, add mode)
and standard (left to right), decimals 0/2/floating, `foot()`/`footTape()`. Amounts on a
page: `src/engine/flyer/numbers.ts` (PDFium chars split into words, `parseAmount` reads
"$1,234.56", "(1,234.56)", "1,234.56-"), worker op `pageNumbers`, cached per document id
(`src/ui/flyer/pageNumbers.ts`; clicks wait for it). Floating calculator
(`CalculatorPanel`, keyboard while open), "Click amounts on page" (Shift subtracts),
Foot / cross-foot (drag a box; wider than tall = cross-foot; then click the total; "No
total"), Mark total (Footed / Cross-footed when it agrees, UD when not). Tape: /Stamp
drawn by `src/engine/flyer/tape.ts` (Courier, ruled totals), `pwType: "Tape"`, lines in
`pwTape`; "Open this tape in the calculator" + Update tape. New corpus file
`generated/footing.pdf` (synthetic schedule, Q1 vs general ledger 0.50 off). Settings
`calc`, `calcOpen`; the settings file carries `calculator`.

Deviations: Update tape makes a new annotation in the same corner (an appearance cannot be
replaced in place; re-using the id after a delete drops it) and moves attached
connectors to it. Standard mode has no operator precedence (like a desk calculator).

## Phase 4 fixes after the owner run (2026-10-27)

Letter (A-Z) and Number (1-99) tickmarks keep the picked value at every click (picks are
refs like `letter:A`; counting up stays as its own pick). Matching ones (`pwLink`) get a
/Link to the next one in page order (`src/flyer/tickLinks.ts`, kept in step by
FlyerOverlay); links carry /IRT to their tickmark so EmbedPDF lets clicks through and
deletes them with it (also used for cross-page connector links). Toolbar sections
(`TickSection` on each tickmark, `src/flyer/sections.ts`): one button per section with a
red symbol, last pick per section (`sectionLast`), letter/number grids. Clear Recent also
stops placing and says so (owner's report not reproduced; this was the likely cause).
Library in three tabs with "New…" forms, field help and a live preview.

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
