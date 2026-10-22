# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 1 (viewer) done** (tagged `phase-01-done`, 2026-10-22). On the owner's Windows
  PC: `npm run check` (55 Vitest, 22 Rust incl. the Windows locked-file test,
  license-check), 43/43 Playwright (500-page first paint 313 ms) and `tauri build`
  (MSI + NSIS) all pass. Manual check results below.
- Owner decisions 2026-10-22: VC++ runtime DLLs with qpdf **approved** (recorded in
  `license-policy.json` → `bundledBinaries`). Acrobat keys checked by the owner: Ctrl+D
  properties, F4 nav pane, Ctrl+Shift+W close all, Shift+F3 previous result; **Ctrl+Y
  is Redo**, so it is unbound until editing adds undo/redo.

## Phase log

### Phase 0: scaffold, tooling, corpus, EmbedPDF spike (tagged `phase-00-done`)

Tauri 2 + React 19 + TS strict + Vite; gates in `npm run check`; custom SPDX
license-check; synthetic corpus + committed IRS forms; `src/engine` (Node-safe PDFium).
Spike findings are in `docs/spike-report.md`. The owner confirmed the app launches on
Windows; the rest of that report's manual check (Acrobat round trip, UNC Save As) was
not reported back.

### Phase 1: the viewer

Built:

- Rust (`src-tauri/src`): classified file errors (`locked`, `network`, `notFound`,
  `accessDenied`); argv + single-instance "Open with"; settings JSON (atomic write);
  qpdf "Repair a copy" to a new file; native printing (`print/`); WebView2 browser
  accelerator keys disabled so Acrobat keys reach the app. `.pdf` file association in
  `tauri.conf.json`. pdfium.dll + qpdf are fetched by `scripts/fetch-win-binaries.mjs`
  (pinned SHA-256, git-ignored `src-tauri/vendor/`) and bundled as resources.
- UI (`src/app`, `src/ui`, `src/platform`): EmbedPDF React plugins. Tabs, drag-drop,
  recent files, start page; continuous / single / two-up (+cover); fit page/width,
  actual size, zoom %; rotate view; go to page / prev / next / first / last;
  thumbnails, outline tree, attachments; find with result list + highlights; select,
  copy, select all; properties dialog; light/dark/system theme; remembers zoom, view
  mode, open tabs, active tab, sidebar; window size via tauri-plugin-window-state.
- Printing (owner chose option C): Ctrl+P → EmbedPDF `preparePrintDocument`
  (annotations flattened, unencrypted copy) → Rust → Windows print dialog (PrintDlgEx)
  → native PDFium `FPDF_RenderPage` onto the printer DC (vector, like Chrome). Default
  Acrobat behaviour: shrink oversized pages, auto-rotate, centre. Falls back to WebView
  print when pdfium.dll is missing. Refused when the PDF forbids printing.
- Tests: 43 Playwright tests (browser platform + mock Windows file system with locked
  and offline paths; every test asserts no external requests), Vitest for settings,
  shortcuts, zoom, properties, corpus; 21 Rust tests incl. print layout and qpdf repair.
  `npm run check:windows-target` type-checks the Windows-only Rust.
- Performance (headless Chromium, Linux): 500-page file from a UNC path to first
  painted page 0.6–1.0 s; no blank pages after jumps or wheel scrolling.

Deviations from spec, and why:

- Shortcuts: Adobe's published table (fetched with a real browser) has navigation,
  find, tabs and nav-pane keys but no menu accelerators. Ctrl+0/1/2 come from Adobe
  Community answers; Ctrl+D, F4, Ctrl+Shift+W, Shift+F3 were checked in Acrobat by the
  owner. Ctrl+Y (Acrobat: Redo) is unbound.
- Ctrl+Shift+N focuses the toolbar page box instead of opening a Go To Page dialog.
- Single Page mode is our own renderer (EmbedPDF's scroll plugin has no single-page
  mode). It renders one full bitmap, no tiling, so very high zoom costs memory.
- Two-up is two-up _continuous_ only (no non-scrolling two-page view).
- qpdf is a bundled resource run with `std::process::Command` (no shell plugin), version
  12.4.2 on Windows; Linux tests use system qpdf 11.9.0.
- Settings use a tiny Rust command, not tauri-plugin-store (one less dependency).
- E2E runs in Chromium against the browser platform; Tauri IPC, native dialogs and the
  print dialog are not exercised by Playwright (Rust unit tests + manual check).

## Manual Windows check (owner, 2026-10-22)

Run from copies of `tests/corpus/generated` (synthetic files only).

1. Installer (NSIS, unsigned: SmartScreen "Run anyway"): **pass**.
2. Default app + double-click; "Open with" while running adds a tab: **pass**.
3. 500-page file from a `\\server\share`: **not tested (deferred)**. Re-check when a share
   is handy; local e2e timing was 313 ms.
4. Ctrl+P: Windows print dialog, Microsoft Print to PDF output sharp, landscape page
   rotated, `no-print.pdf` refused: **pass**.
5. File open in Acrobat/Edge: opens normally (they allow shared read), no crash:
   **pass** (the "locked" message only appears for exclusive locks; covered by
   `fileio::tests::classifies_locked_file_on_windows`). Owner: low priority.
6. Browser keys suppressed; window size, tabs, zoom restored: **pass**.

Notes: the installer is not code-signed (SmartScreen warning). The license-check
script prints Node's DEP0190 warning on Windows (`shell: true` with args); cosmetic.

## Dependency versions and licenses

Phase 0 table: `docs/spike-report.md`. Added in Phase 1: @embedpdf/core and 15
@embedpdf/plugin-\* 2.15.1 (MIT); tauri-plugin-single-instance 2.x,
tauri-plugin-window-state 2.x, windows 0.62 / webview2-com 0.39 (MIT OR Apache-2.0);
libloading 0.8 (ISC). Bundled binaries: pdfium-binaries chromium/8111 (PDFium
BSD-3-Clause; bundled FreeType FTL, libjpeg-turbo IJG/BSD, libpng, zlib, lcms MIT,
OpenJPEG BSD-2, ICU Unicode-3.0, abseil/highway Apache-2.0, Boost: no copyleft);
qpdf 12.4.2 msvc64 (Apache-2.0) **with Microsoft VC++ runtime DLLs (Microsoft
redistributable license, proprietary): owner review requested.** The license-check
script does not scan these binaries.

## Known gaps / notes for later phases

- Print scaling (fit / shrink / actual) and auto-rotate live in settings but have no
  UI yet; there is no in-app print preview.
- Intermittent e2e failures were all real bugs, now fixed: Ctrl+A/Ctrl+C race;
  duplicate PrintFrame/CopyToClipboard (EmbedPDF auto-mounts them; WebView print
  fallback printed twice); single page → continuous losing the page (zoom plugin
  re-fit scrolls back after 150 ms); opening A then B could end on A. Playwright keeps a
  trace for every failure (`npx playwright show-trace`).
- Windows checkout: `.gitattributes` forces LF (Prettier failed on CRLF). The e2e
  suite now generates the corpus itself; the generator finds qpdf on PATH, in `$QPDF`,
  or in `src-tauri/vendor/qpdf` after a Windows build; Vitest helpers and the Rust
  repair tests use the same lookup.
- Whole files are held in memory (JS + WASM copies). Not tested beyond ~1 MB/500 pages;
  test large scans before the OCR phase.
- PDFs opened from an attachment are memory-only tabs (not in Recent or restored tabs).
- Redaction gaps from Phase 0 still open (see spike report); `tests/redaction` unchanged.
- EmbedPDF drops a document's plugin state slightly before core state on close;
  `src/ui/Guard.tsx` absorbs the render race. Keep document-bound UI inside a `Guard`.
- The zoom plugin ignores requests until the viewport has a size; see the
  remembered-zoom effect in `src/ui/DocumentView.tsx`.
- Windows 10/11 do not let apps make themselves the default PDF handler; users pick it.
- Files are read once at open; a file locked with no shared read cannot be opened
  (by design: message + Try again).
