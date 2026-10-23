# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 3 (markup) built 2026-10-23; waiting for the owner's Windows + Acrobat check**
  (`docs/testing/phase-03-test-guide.md`), then tag `phase-03-done`. On the build PC:
  `npm run check` (199 Vitest + 6 expected-fail redaction pins, 41 Rust, license-check),
  Windows target `cargo check`, 89/89 Playwright.
- **B3 Edit PDF, part 1 (spike) still waiting for owner approval and the Acrobat check**
  (`docs/edit-spike-report.md`, `docs/testing/b3-spike-acrobat-check.md`). Spike code is
  dev-only in `scripts/spikes/b3-edit/`. Dev deps harfbuzzjs 1.6.4 (MIT; "Old MIT" text,
  owner to confirm before runtime use), @pdf-lib/fontkit 1.1.1 (MIT).
- Phase 2 + B4 + B1 done, tagged `phase-02-done` (owner check passed 2026-10-23).
  Rerun `npm run corpus -- --force` after a manual test saves over generated files.

## Phase log (summary)

- **Phase 0**: Tauri 2 + React 19 + TS strict + Vite; `npm run check`; SPDX license
  check; synthetic corpus + IRS forms; `src/engine` (Node-safe PDFium). Redaction gaps
  pinned in `tests/redaction` (`docs/spike-report.md`).
- **Phase 1**: viewer on EmbedPDF plugins; Rust file IO with classified errors, "Open
  with", qpdf "Repair a copy", native PDFium printing. Owner: VC++ runtime approved.
- **Phase 2**: `src/engine/pages` (qpdf `--pages` for every add/remove/reorder; clashing
  field names `name`->`name+1`; PDFium for rotate/crop/size/blank/bookmarks; own writer
  for image pages); page-engine Web Worker; whole-file undo snapshots; Save = temp +
  `.bak` + read back (`.bak` deleted when equal); `write_new_file` never overwrites.
  Crop hides like Acrobat's (owner decision).
- **B4 workspace**: `src/tools/registry.ts` drives Tools pane, tool toolbars, quick
  toolbar (+ firm default file); Fluent icons (MIT).
- **B1 windows**: documents live in the Rust store (`docstore.rs`), windows only show
  them; tabs move between windows with history; Ctrl+Q prompt covers every window.
  PDFium is per window (decision; memory table in git history of this file, 2026-10-23).

## Phase 3: markup (2026-10-23)

Owner decisions (planning): EmbedPDF 2.15.1 (3.0 is prerelease); EmbedPDF's stamp plugin
not used (CDN manifest); built-in stamps carry author + time; partial-stroke eraser;
summary = page picture + numbered comments; no `/Popup`; Cloud = cloudy polygon (plus a
Cloudy style on rectangles/ellipses). Spec + gate: `docs/phases/phase-03.md`.

Built:

- **Plugins**: `@embedpdf/plugin-annotation` + `plugin-history`, `autoCommit` on. Firm
  default styles and the user's "Make default" styles in `src/markup/config.ts`
  (`settings.markupDefaults`). `AnnotationLayer` on every page; render layers stay
  without annotations.
- **Undo across all markup** (`workbench.tsx`): markup edits the tab's live PDFium
  document with EmbedPDF's history (topic `annotations`); Ctrl+Z/Y take markup steps
  first, then the store's revisions. Before a page operation, Save/Save As, moving the
  tab or any `docBytes` read, `commitMarkup` pushes one **"Markup"** revision and clears
  that history. The store's `markupPending` flag makes such documents unsaved for the
  Ctrl+Q prompt; another window cannot save them (asks to save from their window).
- **Tools** (Comment toolbar): sticky note, highlight, underline, strikethrough,
  squiggly, text box, callout, rectangle, ellipse, line, arrow, polyline, polygon, cloud
  (polygon tool clone added at runtime, `MarkupBridge`), draw, eraser (own:
  `src/markup/eraser.ts` + `EraserLayer`, exclusive interaction mode, one undo step per
  drag), stamp, flatten, export/import XFDF, summary, comments list.
- **Properties bar** (`PropertiesBar.tsx`): edits the selection or the active tool's
  defaults; color swatches + custom; width, style (solid/dashed/cloudy), line endings,
  font (standard PDF fonts), size, fill, opacity; lock/unlock (`/F Locked`), delete,
  Make default. Esc leaves a text box (keeps text) > tool off > deselect; Delete removes
  unlocked selected comments.
- **Stamps**: `src/engine/stamps.ts` draws Approved/Reviewed/Draft/Confidential as a
  one-page PDF (pdf-lib) that PDFium turns into the `/AP`; `/Name` Approved, Custom,
  Draft, Confidential. Custom PNG/JPEG stamps: Rust `stamps.rs` library in the config
  folder (images only, 5 MB, 50 max). Placement: `StampLayer` (outline follows pointer).
- **Comments panel** (`CommentsPanel.tsx`, logic in `src/markup/comments.ts`): threads
  by `/IRT`, Acrobat-style Review/Marked states (hidden `/Text` replies), filters by
  type/author/color/status, jump + select, edit text, reply.
- **Author**: Rust `user_display_name` (`GetUserNameExW(NameDisplay)`, else
  `%USERNAME%`); Settings dialog (gear) overrides it (`settings.authorName`).
- **Flatten** (`src/engine/flatten.ts`): selected/page/document, on a copy, written as
  "<name> (flattened).pdf" next to the file and opened; widgets/links/popups/redact marks
  untouched; replies/states of flattened comments removed.
- **XFDF** (`src/engine/xfdf.ts`, own code; EmbedPDF has none): export of every comment
  in PDF coordinates (ISO 19444-1 elements); import through `createAnnotation` (undoable;
  ids already present skipped; pages the file lacks skipped and reported).
- **Summary** (`src/engine/summary.ts`): new PDF, per page a vector picture of the
  flattened page with numbered markers, then numbered comments with replies and status.
- Tests: `tests/unit/markup-roundtrip.test.ts` (the gate: every type saved/reopened,
  checked with qpdf JSON + pdf.js; writes `tests/corpus/out/markup-all.pdf` for the
  Acrobat check), `markup-io` (flatten incl. a render check, XFDF round trip, summary),
  `markup-properties`, `markup-eraser`, `markup-comments`; `tests/e2e/markup.spec.ts` (14).

Deviations: free text offers only standard PDF fonts (PDFium writes the appearance
with them; no font embedding); XFDF import is one undo step per comment (the plugin's
batch import skips history); after a page operation or save the markup made before it
undoes as one "Markup" step; "Comments list" also sits in the Comment toolbar.

## Dependency versions and licenses

Phase 0: `docs/spike-report.md`. Phase 1: @embedpdf/core + plugins 2.15.1 (MIT), tauri
plugins 2.x, windows 0.62, webview2-com 0.39 (MIT OR Apache-2.0), libloading 0.8 (ISC),
pdfium-binaries chromium/8111 (BSD-3), qpdf 12.4.2 (Apache-2.0) + VC++ runtime
(approved). Phase 2: utif2 4.1.0 (MIT; pako 1.0.11 MIT AND Zlib), fflate 0.8.2 (MIT).
B4: @fluentui/svg-icons 1.1.344 (MIT). **Phase 3:** @embedpdf/plugin-annotation 2.15.1,
@embedpdf/plugin-history 2.15.1 (MIT); pdf-lib 1.17.1 moved to runtime (MIT; deps
@pdf-lib/standard-fonts, @pdf-lib/upng MIT, tslib 1.14.1 0BSD); fast-xml-parser 5.11.2
(MIT; deps strnum, is-unsafe, xml-naming, fast-xml-builder, @nodable/entities,
path-expression-matcher, all MIT). Rust: `windows` feature
`Win32_Security_Authentication_Identity` (no new crate).

## Known gaps / notes for later phases

- **Acrobat check pending** for appearance fidelity of squiggly, cloud, callout and
  text-box borders (PDFium generates them), and for notes without `/Popup`.
- XFDF does not carry stamp appearances: built-in stamps are redrawn on import (by
  subject, with the XFDF author/date); custom image stamps import as plain stamps.
- Coordinates (XFDF, summary markers) assume the crop box starts at 0,0; the summary
  pictures rotated pages unrotated.
- PDFium adds `/NM` to annotations that lack one when it reads them; saved files keep it.
- Markup is off for password-protected documents (no store bytes to save).
- Phase 2 notes still apply: a tab reopens after each page edit (zoom re-fit ~150 ms
  later; `idle()` in e2e); bookmark rewrites drop colour/bold/open state; StructTreeRoot
  not updated; signatures warning only; crop hides, does not remove (redaction phase).
- Memory: ~4x file size per open scan, undo up to 400 MB per document.
- Playwright: the first run after adding a dependency may fail while Vite re-optimizes;
  rerun. In the cloud container use `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Keep document-bound UI inside a `Guard`; extra windows never save view settings.
