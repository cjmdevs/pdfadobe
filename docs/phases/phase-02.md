# Phase 2: page organization

Read CLAUDE.md. This is Phase 2: page organization. Plan first.

- Organize view: grid of page thumbnails with multi-select, drag to reorder, rotate,
  delete, extract to new file, duplicate, insert blank page
- Insert pages from another PDF or from images (JPG/PNG/TIFF, including multi-page TIFF
  from office scanners) at a chosen position
- Replace pages with pages from another file
- Combine Files dialog: add files and folders, reorder, choose page ranges per file,
  option to create a bookmark per source file named after the file
- Split: by page count, by page ranges, by top-level bookmarks, by file size
- Crop pages (with apply-to-range), set page size
- Bookmark editor: add from current view or selected text, rename, nest by drag, delete,
  set destination, expand/collapse; auto-bookmark one per page or per file
- Merging must preserve annotations, bookmarks, and form fields. Detect form field name
  collisions and rename safely so values don't cross-link.
- Bookmark-driven page ops (high priority for staff): delete a bookmark together with its
  pages, extract a bookmark's pages, and drag a bookmark in the panel to move its pages
  (and its child bookmarks) to the new position
- Undo/redo for every page operation within the session

Tests: merge 3 corpus files with forms and annotations, reorder, split, and assert page
counts, bookmark targets, and field values are correct afterward.

Owner decisions during planning (2026-10-22): push straight to `main`; for the merge
engine, undo memory, field-rename format and page-size behaviour the owner said "whatever
you think". Chosen: qpdf for every structural change; in-memory undo capped at 400 MB per
tab; qpdf's own rename scheme (`name` -> `name+1`); "set page size" scales content to fit.

## Gate

- `npm run check` passes (typecheck, lint, format, Rust fmt, Vitest, cargo test,
  license-check), and `npm run check:windows-target` type-checks the Windows code.
- `npm run test:e2e` passes.
- Manual Windows check in docs/progress.md done by the owner (Save + .bak on a share,
  locked file, Combine from a scanner folder, merged IRS forms in Acrobat/Reader).
