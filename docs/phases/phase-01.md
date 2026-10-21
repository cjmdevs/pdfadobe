# Phase 1: the viewer

Read CLAUDE.md and docs/spike-report.md. This is Phase 1: the viewer. Plan first.
Build the main app shell and reading experience:

- Tabbed documents (open many PDFs at once), drag-and-drop to open, recent files list
- Left panel: page thumbnails, bookmarks/outline tree, attachments list
- Continuous scroll, single page, two-up; fit page, fit width, actual size, zoom %
- Rotate view, go to page, previous/next, first/last
- Text search with result list and highlighting; text selection and copy
- Document properties dialog (title, author, page size, PDF version, security)
- Print via the Windows print dialog (research the right approach for Tauri on
  Windows and propose options before building; printing quality matters)
- Keyboard shortcuts matching Adobe Acrobat on Windows (verify against Adobe's
  published shortcut list)
- Light/dark theme; remember window size, last zoom, and open tabs
- Windows file association so the app can be set as the default PDF handler,
  and "open with" from Explorer passes the file path into a new tab
- Open from UNC network paths; clear message when a file is locked or corrupt
  (offer qpdf repair on corrupt files, writing to a new file)

Performance targets: 500-page corpus file opens to first page in under 2 seconds and
scrolls without blank pages lingering. Add a Playwright test for each feature.

Owner decisions during planning: printing option C (native PDFium to the printer DC via
the Windows print dialog), with WebView print as fallback; Phase 0 accepted (owner
launched the app on Windows); push to `main`; shortcuts sourced from Adobe's pages via a
real browser; two-up cover page off by default with a toggle.

## Gate

- `npm run check` passes (typecheck, lint, format, Rust fmt, Vitest, cargo test,
  license-check), and `npm run check:windows-target` type-checks the Windows code.
- `npm run test:e2e` passes.
- Manual Windows check in docs/progress.md done by the owner (printing, file
  association, locked file, UNC share, window size, timing on a real PC).
