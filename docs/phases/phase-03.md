# Phase 3: markup

Read CLAUDE.md. This is Phase 3: markup. Plan first. Check the current EmbedPDF
annotation plugin docs before writing code.

- Text markup: highlight, underline, strikethrough, squiggly, with color presets
- Sticky notes, free-text boxes (font, size, color, border, fill), callouts
- Shapes: rectangle, ellipse, line, arrow, polyline, polygon, cloud
- Freehand ink with pen width and color; eraser
- Image and text stamps (Approved, Reviewed, Draft, Confidential, custom images)
- Comments panel: list all annotations with author, date, page; filter by type,
  author, color; reply threads; mark status; jump to annotation
- Properties bar for the selected annotation; lock/unlock; make default style
- Author name defaults to the Windows user's display name, editable in Settings
- Flatten annotations (selected, page, or document) to a new file
- Export/import annotations as XFDF; summarize comments to a printable PDF
- Undo/redo across all markup

Tests: round-trip every annotation type through save/reopen; open the saved corpus
file with an independent parser and assert subtype, rect, color, and contents.

Owner decisions during planning (2026-10-23):

- EmbedPDF 2.15.1 plugin-annotation + plugin-history (3.0 is still a prerelease).
- EmbedPDF's plugin-stamp is not used (its default config fetches stamp manifests from a
  CDN). Built-in stamps are one-page PDFs we generate; custom stamps are PNG/JPEG.
- Built-in stamps carry the author's name and the date (like Acrobat's dynamic stamps).
- Eraser erases part of an ink stroke (splits the stroke), like Acrobat.
- Comment summary: each page as a small image with its numbered comments below.
- No /Popup annotations for now; check in Acrobat that notes still open.
- Cloud tool is a cloudy polygon; squares and ellipses also get a cloud option.
- Undo: markup steps use EmbedPDF's history on top of the whole-file history; pending
  markup is committed as one "Markup" revision before anything that needs the bytes.

## Gate

- `npm run check` passes and `npm run check:windows-target` type-checks.
- `npm run test:e2e` passes.
- `tests/unit/markup-roundtrip.test.ts` passes (qpdf + pdf.js read every type back).
- Manual Windows check by the owner, including every type opened in Adobe Acrobat.
