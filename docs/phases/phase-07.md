Read CLAUDE.md. This is Phase 7. Plan first.
Tools pane: a Scan & OCR tool whose toolbar matches the screenshot in docs/reference
(Insert, Enhance, Recognize Text, Bates Numbering, rotate, delete). Header & Footer
and Watermark also appear in the Edit PDF tool's toolbar.

OCR (Tesseract, called directly as a bundled sidecar; no OCRmyPDF, no Ghostscript):

- Recognize Text on current page, page range, or whole file; skip pages that
  already have text; deskew and rotate-detect first
- Output keeps the original page image and adds an invisible, correctly positioned
  text layer (searchable, selectable)
- Batch OCR a folder, writing new files beside the originals; progress + cancel
- Runs in a background worker so the UI never freezes

Optimize:

- Reduce file size presets (Email, Standard, Archive): downsample and recompress
  images, subset fonts, remove unused objects, linearize (qpdf)
- Show before/after size; never overwrite the original

Document tools:

- Headers/footers: text, page numbers ("Page 3 of 12"), date, filename; position,
  font, margins, page ranges; saved presets; remove previously added ones
- Bates numbering: prefix, start number, digits, suffix, across multiple files
- Watermarks: text or image, opacity, rotation, behind/in front, page ranges
- Backgrounds

Conversions (no Office conversion in v1):

- Images to PDF (scanner batches), PDF pages to PNG/JPG at chosen DPI,
  PDF to plain text

Tests: OCR a synthetic scanned page and assert known words are searchable at the
right coordinates; optimize corpus files and assert size drops and pages render the
same (pixel diff within tolerance).

Test guide: exact steps, but kept at a basic overview level.

## Decisions (owner approved the plan 2026-10-31)

1. Tesseract 5.5.4 + Leptonica 1.87.0 built from source with MSVC
   (`scripts/build-tesseract.mjs`), no image libraries (pages are handed over as PGM),
   static CRT. The UB Mannheim build is not shipped (LGPL/GPL DLLs).
2. Recognize Text never changes how a page looks: OCR runs on a straightened copy and
   the text is placed back with the inverse rotation. A visible, lossless straighten
   is Enhance > Straighten Pages.
3. Images to PDF reads TIFF (UTIF.js, MIT) as well as PNG and JPEG.
4. Language data: standard `tessdata` eng + osd (Apache-2.0).
5. The page icon after the divider in the Scan & OCR toolbar is Extract Pages.

## Gate

`npm run check`, `npm run test:e2e`, the OCR and Optimize tests above, and the owner
check of `docs/testing/phase-07-test-guide.md`. Then tag `phase-07-done`.
