# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 2 (page organization): owner's first Windows check found 5 bugs, fixed
  2026-10-22 (below); re-check pending.** On Linux: `npm run check` (95 Vitest + 6
  expected-fail redaction pins, 28 Rust, license-check), Windows target type-check, 62/62
  Playwright (Phase 2 specs 5x under 4 workers: 95/95). Tag `phase-02-done` after re-check.
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
  to `<name>.bak`, atomic rename; `.bak` deleted on the next successful open),
  `write_new_file` (never overwrites: "a (2).pdf"), `list_folder` (natural order).
- App: page-engine Web Worker (own PDFium; qpdf calls go back to the main thread);
  per-tab undo/redo of whole-file snapshots; each edit reopens the tab from the new bytes
  in place. Organize grid, dialogs (insert PDF/images, replace, blank, crop, page size,
  split, Combine Files, unsaved changes), bookmark editor, Save/Save As, signed-PDF
  warning, dirty marker. Keys: Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+Shift+S.
- Tests: `tests/unit/pages-merge.test.ts` is the phase gate (3 workpapers with the same
  field names, annotations, nested bookmarks: merge, reorder, split; checked with qpdf
  JSON + pdf.js, not PDFium). Every op has a unit test; rendered-pixel checks catch
  inverted G4 scans. Playwright: organize, bookmark editor, combine/split specs inspect
  the saved bytes. Browser tests run qpdf in the test process (`/__qpdf` route).

Deviations from spec, and why:

- PDFium's `importPages` drops `/AcroForm` (verified), so merging uses qpdf.
- Field renames use qpdf's scheme (`client+1.name`), not a custom suffix.
- Image pages are written by our own writer: PDFium's PNG import stores 8-bit RGB
  (24x larger for black-and-white scans).
- Bookmark drag moves pages by default; a panel checkbox switches to nesting only.
- Extract opens an unsaved tab (Save to keep it); "extract as separate files" = Split.
- Split writes into the document's folder (or a chosen one).
- Password-protected PDFs: page operations are refused and bookmarks are read-only.

### Owner's Windows check, round 1 (2026-10-22) and fixes

- **Dragging pages/bookmarks was blocked** (no-entry cursor). Tauri's file-drop handler
  (`dragDropEnabled`, needed for Explorer drops with paths) blocks HTML5 drag-and-drop in
  WebView2 (Tauri config docs). In-app drags now use pointer events
  (`src/ui/usePointerDrag.ts`); e2e blocks HTML5 `dragstart` like the app does.
- **Save with the file open in Acrobat said "access denied"** (original was intact). Save
  now checks first (DELETE access, sharing all) and reports "open in another program";
  a failed save no longer leaves a `.bak`. Windows-only Rust tests cover both holds.
- **Rotate "affected the whole PDF" and was lost after a delete; no signed-PDF warning.**
  The reader toolbar buttons were Acrobat's Rotate View (display only, never saved). They
  now rotate the current page (saved, undoable, signature warning); Rotate View stays on
  Ctrl+Shift+Plus/Minus and survives edits. Crop/page-size dialogs default to the selected
  page(s), not all pages. Organize buttons have text captions.
- **Race found while testing:** the busy state started after the signature check, so a
  quick Ctrl+S/Ctrl+W could act before the edit. Busy now starts on the click; Save,
  Save As and Close wait for running edits and follow the tab to its new revision.
- Confirmations use the app's own dialog instead of `window.confirm`.
- Open: report 4 (Combine "none of the old pages stay") needs clarification; 5 and 10
  not run yet.

## Manual Windows check (owner, Phase 2)

Synthetic files only (copies of `tests/corpus/generated`, `tests/corpus/fixtures`).

1. On a `\\server\share` copy: Organize, drag pages, Ctrl+S. File replaced, `<name>.bak`
   beside it; reopen: `.bak` gone. Repeat with the file open in Acrobat: clear message,
   original intact.
2. Combine Files > Add folder with PDFs plus a multi-page TIFF from the office scanner.
   Open the result in Acrobat: pages, bookmark per file, sticky notes visible.
3. Combine two filled copies of `irs/fw9.pdf`: in Acrobat and Reader both keep their own
   values, fields fillable, no "extended features" warning.
4. Split by bookmarks into a folder that already has a same-named file: nothing overwritten.
5. Crop, page size, rotate: results look right in Acrobat. Drag a bookmark with children
   on a real-sized binder: pages and child bookmarks move.
6. Timing: Organize + reorder on a 200-page scan from the share.

## Dependency versions and licenses

Phase 0: `docs/spike-report.md`. Phase 1: @embedpdf/core and 15 plugins 2.15.1 (MIT),
tauri-plugin-single-instance/window-state 2.x, windows 0.62, webview2-com 0.39 (MIT OR
Apache-2.0), libloading 0.8 (ISC); bundled pdfium-binaries chromium/8111 (BSD-3 + permissive
deps), qpdf 12.4.2 (Apache-2.0) with VC++ runtime (approved). **Phase 2:** utif2 4.1.0
(MIT; pulls pako 1.0.11, MIT), fflate 0.8.2 (MIT). No new Rust crates.

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
- Memory: every open file is held twice (viewer + undo base); undo history up to 400 MB
  per tab. Test large scans before the OCR phase. JPEG EXIF orientation is ignored.
- Tauri IPC paths (qpdf_run, save, dialogs) are covered by Rust tests and the manual check;
  Playwright runs the browser platform. In the cloud container Playwright 1.64 needs
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Phase 1 notes still apply: keep document-bound UI inside a `Guard`; the zoom plugin
  ignores requests until the viewport has a size; PDFs opened from attachments are
  memory-only tabs; Windows 10/11 users pick the default PDF app themselves.
