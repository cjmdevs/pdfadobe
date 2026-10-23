# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **B3 Edit PDF, part 1 (spike) done 2026-10-23; waiting for owner approval and the
  Acrobat check** (`docs/edit-spike-report.md`, `docs/testing/b3-spike-acrobat-check.md`).
  No UI built. Spike code is dev-only in `scripts/spikes/b3-edit/`; samples in
  `tests/corpus/edit/`. New dev deps: harfbuzzjs 1.6.4 (MIT; HarfBuzz "Old MIT" text,
  owner to confirm before runtime use), @pdf-lib/fontkit 1.1.1 (MIT). Same day:
  `navigation.pdf` now attaches files in name order. Its name tree was unsorted, and the
  Windows qpdf 12.4.2 failed the bookmark-move test on it. Rerun
  `npm run corpus -- --force` after a manual test saves over the generated files (that
  is what broke 13 other tests on the build PC).

- **Phase 2 + backlog B4 (workspace) + B1 (multiple windows) done; owner passed the
  Windows check 2026-10-23; tagged `phase-02-done`.** Follow-ups that day (owner
  approved): `.bak` deleted once the saved file reads back (below); the renderer no
  longer keeps its own copy of document bytes. On Linux: `npm run check` (103 Vitest + 6
  expected-fail redaction pins, 35 Rust, license-check), Windows target `cargo check`,
  75/75 Playwright. Re-check: `docs/testing/save-backup-test-guide.md`.
- Owner decisions 2026-10-23: Ctrl+Q = Exit confirmed; firm layout share path not
  needed yet; "Coming in Phase N" stays "Coming in a later phase" until phase numbers
  are set; git rule restored in CLAUDE.md (push to `main`, tag each phase).
- Phase 1 (viewer) done, tagged `phase-01-done`. Owner decisions: VC++ runtime with qpdf
  approved (`license-policy.json`); Acrobat keys checked by the owner (Ctrl+D, F4,
  Ctrl+Shift+W, Shift+F3; Ctrl+Y is Redo, now bound).

## Phase log (summary)

- **Phase 0**: Tauri 2 + React 19 + TS strict + Vite; `npm run check`; SPDX license
  check; synthetic corpus + IRS forms; `src/engine` (Node-safe PDFium). Redaction gaps
  pinned in `tests/redaction` (see `docs/spike-report.md`).
- **Phase 1**: viewer on EmbedPDF plugins (tabs, thumbnails/outline/attachments, view
  modes, zoom, find, properties, Acrobat keys, theme, remembered state); Rust file IO with
  classified errors, "Open with", qpdf "Repair a copy", native PDFium printing (PrintDlgEx).

## Phase 2: page organization

Built:

- `src/engine/pages` (Node-safe, MCP can reuse): **qpdf `--pages` with the document as
  primary input does every add/remove/reorder** (fields copied, clashing names renamed
  `name`->`name+1` so values never cross-link, annotations kept, bookmarks follow pages).
  PDFium does rotate, crop, page size (content + annotations scaled), blank pages and
  bookmark writes. Own minimal PDF writer for image pages: JPEG and single-strip CCITT G4
  embedded unchanged, other TIFF/PNG as 1-bit/gray/RGB Flate (+SMask). Combine (bookmark
  per file), split (count/ranges/top-level bookmarks/size), bookmark-driven delete/extract/
  move-with-pages. After any structural change `/AcroForm /XFA` and catalog `/Perms`
  (Reader usage rights) are removed, since both go stale (qpdf JSON update).
- Rust: `qpdf_run` (one framed IPC call per job, private temp folder, plain names only,
  no paths/drive letters/@argfiles; same rules as `checkJob`), `save_pdf` (temp, copy old
  to `<name>.bak`, atomic rename, read back: same bytes -> `.bak` deleted, otherwise
  kept and the save reports `unverified`; a leftover `.bak` goes on the next open),
  `write_new_file` (never overwrites: "a (2).pdf"), `list_folder` (natural order).
- App: page-engine Web Worker (own PDFium; qpdf calls go back to the main thread);
  per-tab undo/redo of whole-file snapshots; each edit reopens the tab from the new bytes
  in place. Organize grid, dialogs (insert PDF/images, replace, blank, crop, page size,
  split, Combine Files, unsaved changes), bookmark editor, Save/Save As, signed-PDF
  warning, dirty marker. Keys: Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+Shift+S.
- Tests: `tests/unit/pages-merge.test.ts` is the phase gate (merge/reorder/split of 3
  workpapers, checked with qpdf JSON + pdf.js). Browser tests run qpdf in the test
  process (`/__qpdf` route).

Deviations: merging uses qpdf (PDFium's `importPages` drops `/AcroForm`); field renames
use qpdf's `name+1` scheme; image pages use our own writer (PDFium's PNG import stores
8-bit RGB, 24x larger for scans); bookmark drag moves pages by default (panel option for
nesting only); Extract opens an unsaved tab; Split writes next to the document (or a
chosen folder); password-protected PDFs refuse page operations.

Owner's Windows checks (rounds 1-3), fixes: in-app drags use pointer events (Tauri's
`dragDropEnabled` blocks HTML5 drag-and-drop in WebView2; e2e blocks it too); Save
reports "open in another program" instead of "access denied" and leaves no `.bak` on
failure; reader rotate buttons rotate the page (saved, undoable; Rotate View stays on
Ctrl+Shift+Plus/Minus); busy starts on the click and Save/Close wait for running edits;
page size clips to the old crop; Combine starts with the open file; an edit keeps its
pages selected; crop sets MediaBox and all boxes. Crop hides, it does not remove (shows
in LibreOffice/Word imports, like Acrobat's crop): owner kept Acrobat behaviour. W-9
duplicate-form test dropped by the owner.

## Backlog B4: Acrobat-style workspace (2026-10-23)

Layout per `docs/reference/` (owner screenshots; the client document was blanked out
before committing): one top row (Open, Save, Print, Find, Undo/Redo, page navigation,
zoom, pinned quick tools; view settings, Customize and Tools-pane toggle on the right),
the open tool's toolbar above the page, a left icon rail (Pages, Bookmarks, Attachments)
with a titled, closable panel, and a right Tools pane with search.

- `src/tools/registry.ts`: every tool declares id, name, icon, colour, `comingIn` (null =
  built, a phase number, or "later"), what opening does (toolbar or run, e.g. Combine),
  an optional document view ("pages" = Organize grid), and its toolbar actions. The
  shell only reads it. Unbuilt tools are hidden; "Show tools that are coming later"
  shows them greyed ("Coming in a later phase": the owner has not given phase numbers).
- Quick toolbar: any built action, as "tool.action" refs; Customize dialog adds,
  removes, drags to reorder. Saved per user (`settings.quickToolbar`); `null` follows
  the firm default, read at start from `settings.firmLayoutPath` (JSON `{version:1,
quickToolbar}` on the share) with the last copy cached for offline use.
- Icons: Fluent UI System Icons via `@fluentui/svg-icons` 1.1.344 (MIT, Microsoft), raw
  SVG bundled at build time; nothing from Adobe. Tool names are generic ("Workpaper
  Tools", not "PDFlyer", which is CCH's name).
- Deviation: the spec says "quick toolbar under" the top bar; the reference screenshot has
  one row, which is what was built. Organize's selection and the open tool now live in
  the tab's state (`DocMeta.activeTool`, `pageSelection`). Delete from the quick toolbar
  asks first; inside Organize it does not (pages picked explicitly, Ctrl+Z undoes).
- Tests: `src/tools/registry.test.ts`, `tests/e2e/workspace.spec.ts` (7).

## Backlog B1: multiple windows (2026-10-23)

Design (owner approved "switch to the existing window" for a file opened twice):

- **Documents live in a store, windows only show them.** `src-tauri/src/docstore.rs`
  (one per app, shared by all windows) holds each document's revisions (undo/redo), the
  saved revision, path/name, signature consent and the window showing it. Each tab's
  `DocMeta.storeId` survives edits and moves. JS keeps only the current bytes and a
  mirror (`DocInfo`) for display. Browser/tests: `MemoryDocStore` (`src/app/docstore.ts`).
- **Windows** (`src-tauri/src/app_windows.rs`): a tab dragged out of its window goes to
  the window under the pointer (`AppHandle::cursor_position` + window rects), or to a new
  window opened there; tab right-click > Move to New Window. The store re-assigns the
  documents before the source tab closes, so nothing is reloaded from disk and history,
  unsaved marker and signature consent come along. An extra window closes when its last
  tab leaves. Tabs reorder by drag within the bar. Normal OS windows, so Snap works.
- Same file opened again (Open, Recent, Explorer) switches to the window that has it.
  "Open with" from Explorer goes to the last-used window.
- Close button: asks about that window's unsaved files. **Ctrl+Q** (Acrobat's Exit,
  confirmed by the owner): one prompt listing unsaved files in every window; Save
  all saves this window's tabs normally and other windows' files from the store (same
  temp file + `.bak` rules); files never saved must be saved from their window first.
- Settings: each save writes only the changed keys over what is on disk. Extra windows
  never save view settings (zoom, panes, view mode) or the reopen-tabs list; only the
  main window's tabs reopen at next start, and only its size/place is remembered.
- Deviation: other windows do not pick up a quick-toolbar change until reopened.
- Tests: Rust store + drop-target unit tests; `tests/e2e/windows.spec.ts` uses a browser
  stand-in for the other window (`__PDFWB_FAKE_WINDOWS__`), so real cross-window drags
  are only in the manual check.

**Memory** (Chromium on Linux, PSS; 3 synthetic 120-page scans of 60 MB each per window):

|                                           | renderer       | all processes |
| ----------------------------------------- | -------------- | ------------- |
| 1 window, empty                           | 134 MB         | 390 MB        |
| 1 window, 3 scans open                    | 814 MB         | 1.08 GB       |
| same, one rotate each                     | 1.70 GB        | 1.97 GB       |
| 2 windows, 3 scans each (1 window edited) | 1.40 + 0.81 GB | 2.48 GB       |
| 2 windows, both edited                    | 1.69 + 1.40 GB | 3.36 GB       |

PDFium is **per window** (each window's renderer has its own PDFium for display plus one
in the page-operation worker). A second window costs about 130 MB empty; documents cost
the same in whichever window they are, and a file cannot be open in two windows, so
nothing is duplicated. Sharing one PDFium across windows (SharedWorker) would save at
most ~100 MB per extra window, but puts every window's rendering on one thread and one
WASM heap (one crash or heap limit hits all windows). Decision: keep per-window. In the
Windows app, undo history and the current bytes sit in the Rust process only: windows
fetch a document's bytes from the store when an operation needs them (one IPC copy,
freed afterwards), saving 1x file size per open document in the renderer (not
measurable in the browser build, where the store shares the same objects).

## Manual Windows check

`docs/testing/b1-b4-test-guide.md` (current, short) and
`docs/testing/phase-02-test-guide.md` (full Phase 2 list, setup details).

## Dependency versions and licenses

Phase 0: `docs/spike-report.md`. Phase 1: @embedpdf/core and 15 plugins 2.15.1 (MIT),
tauri-plugin-single-instance/window-state 2.x, windows 0.62, webview2-com 0.39 (MIT OR
Apache-2.0), libloading 0.8 (ISC); bundled pdfium-binaries chromium/8111 (BSD-3 + permissive
deps), qpdf 12.4.2 (Apache-2.0) with VC++ runtime (approved). **Phase 2:** utif2 4.1.0
(MIT; pulls pako 1.0.11, MIT), fflate 0.8.2 (MIT). **B4:** @fluentui/svg-icons 1.1.344
(MIT). **B1:** none. No new Rust crates.

## Known gaps / notes for later phases

- After an edit the tab reopens as a new document; EmbedPDF's zoom plugin re-fits ~150 ms
  later and scrolls back once. A jump made in that instant is undone (rare by hand;
  `idle()` in e2e waits for it). Thumbnails re-render after each edit.
- Rewriting the bookmark tree (only when it must change) drops bookmark colour/bold and
  open/closed state (EmbedPDF's model is title + target), and drops links to other files.
  "Add from current view" stores the visible top (XYZ) assuming the crop box starts at 0;
  rotated pages get Fit Page.
- Tagged-PDF structure (StructTreeRoot) is not updated after page changes.
- Crop hides content, it does not remove it (redaction phase). Signatures: warning only.
- Memory: see B1 table; roughly 4x file size per open scan, more after edits; undo
  history up to 400 MB per document. JPEG EXIF orientation is ignored.
- Tauri IPC paths (qpdf_run, save, dialogs) are covered by Rust tests and the manual check;
  Playwright runs the browser platform. In the cloud container Playwright 1.64 needs
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Phase 1 notes still apply: keep document-bound UI inside a `Guard`; the zoom plugin
  ignores requests until the viewport has a size; PDFs opened from attachments are
  memory-only tabs; Windows 10/11 users pick the default PDF app themselves.
