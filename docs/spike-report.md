# Phase 0 spike report: EmbedPDF on Tauri 2

Date: 2026-10-21. Environment: Linux cloud container (no Windows, no display).
Everything below was run there unless marked **not verified**.

## Verdict

EmbedPDF (PDFium WASM) is a sound base for **rendering, annotations and page-content
redaction**. On its own it is **not** a compliant redaction engine: applying a redaction
removes text and vector paths under the box, but leaves images, annotations, form
values, `/Info` and XMP. The redaction phase must add its own sanitize pass. Every
gap is pinned by a test (`tests/redaction`, `it.fails`).

## Results by spike step

| Step                                       | Result                                                                                                                                              | Evidence                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 4a Open + render from a native-dialog path | Works in a browser (file input) and builds under Tauri. **Native Windows dialog not verified**                                                      | `tests/e2e/spike.spec.ts`, `npx tauri build --debug` |
| 4b Image stamp + free text, Save As        | Works. Both are standard `/Stamp` and `/FreeText` annotations with `/AP` appearance streams; qpdf `--check` clean; pdf.js and PDFium read them back | `tests/unit/spike-annotations.test.ts`               |
| 4c Mark redaction over SSN, apply, Save As | Works for page content. Marks are standard `/Redact` annotations; apply burns in a black box                                                        | `tests/redaction/spike-redaction.test.ts`            |
| 4d Node test: SSN absent everywhere        | **Fails as expected.** Page text is clean (PDFium + pdf.js), but the raw file still holds the SSN                                                   | same file, 6 `it.fails`                              |

### What redaction does to the SSN fixture

`tests/corpus/generated/ssn-redaction.pdf` puts the fake SSN `000-12-3456` in eight places
(see `tests/corpus/README.md`). After `redact()` (search hits + two area boxes):

| Content under / related to the box                            | Removed?                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Page text, single run                                         | Yes                                                                             |
| Page text split across two runs (`000-12-` + `3456`)          | Yes (search re-joins runs)                                                      |
| Page text on page 2                                           | Yes                                                                             |
| Text outside the boxes (`KEEP-THIS-LINE`)                     | Kept, correct                                                                   |
| Vector path fully inside an area box                          | Yes                                                                             |
| Vector path partly inside a box                               | Kept whole, not clipped                                                         |
| Image fully inside an area box                                | **No.** Still painted                                                           |
| Sticky note (`/Text` annot) over the box, `/Contents` has SSN | **No**                                                                          |
| Form field under the box: `/V` value and widget appearance    | **No.** The field draws _on top of_ the burned-in box, so the SSN stays visible |
| `/Info` Subject + Keywords                                    | **No** (not "under" anything; needs a document-level scrub)                     |
| XMP `dc:description`                                          | **No**                                                                          |

The raw-byte check finds the SSN in four encodings (ASCII, hex, UTF-16BE hex), all in
objects outside page content.

## EmbedPDF limits and bugs found

1. **Redaction covers page content only.** `applyRedaction` / `applyAllRedactions`
   (`EPDFAnnot_ApplyRedaction`) handle text and whole vector paths. Not images,
   annotations, widgets or metadata. See the table above.
2. **`extractText()` returns garbage on pages with zero glyphs.** On the image-only page
   it returns bytes from uninitialized WASM memory (e.g. `"⭠\u001b⭠\u001b\u0010"`).
   Those bytes could come from a previously opened document. That matters for the MCP
   server and for logs. Workaround: `src/engine/text.ts` checks `getPageGlyphs()` first.
   A test fails once upstream fixes it. Should be reported upstream.
3. **The applied box uses `color`, not `overlayColor`.** I set `color: "#000000"`.
4. **Removing a widget annotation does not remove its form field.** `removePageAnnotation`
   on the widget takes it off the page, but the field stays in AcroForm `/Fields`. `/V`
   and the appearance stream remain in the saved file and are still reachable, so qpdf's
   garbage collection doesn't drop them.
5. **There is no XMP API.** `setMetadata` handles `/Info` only. Clearing Subject and
   Keywords with it does remove them from the raw file (verified).
6. **Network defaults.** `DEFAULT_PDFIUM_WASM_URL` points at jsDelivr, and the font
   fallback downloads CJK/Arabic/Hebrew fonts from jsDelivr. The app passes local WASM
   bytes and `fontFallback: null` (`src/engine/pdfium.ts`). The CDN strings stay in the
   bundle but are never requested. The Tauri CSP (`connect-src 'self' ipc:`) blocks them
   anyway, and the e2e tests assert zero external requests.
7. **Gap-width leak.** Removed text becomes a `TJ` spacing gap (e.g. `-5948`). The
   redacted string's length can be inferred. Acrobat behaves the same by default.
   Low risk; note for the redaction phase.
8. **Writes a private key.** Annotations get `/PDFIUM_HasGeneratedAP true`. Harmless to
   Acrobat (unknown keys are ignored), but it's a non-standard key.
9. **Not exercised:** EmbedPDF's React plugin layer (`@embedpdf/core`,
   `plugin-annotation`, `plugin-redaction` UI). The spike calls the engine directly and
   draws to a canvas, per "no real UI yet". The plugin layer is Phase 1's decision.

### What is reachable to close the gaps (checked, not built)

The PDFium build exposes `FPDFPage_CountObjects` / `GetObject` / `GetBounds` /
`RemoveObject` (whole images under a box), `removePageAnnotation` (annotations;
verified), `setFormFieldValue` and `setMetadata` (verified for `/Info`). XMP and removing
fields from the AcroForm tree need raw object editing (qpdf JSON/QDF or a small writer).
Partial images need pixel edits (`FPDFImageObj_GetBitmap` / `SetBitmap`). A redaction
phase should finish with a qpdf rewrite (`--object-streams=generate`, garbage-collect
unreferenced objects), then run the three-way leak scan before writing.

## Other findings

- **create-tauri-app** 4.8.0 ran (the npm registry listed 4.7.5 minutes earlier), with
  `-t react-ts -m npm -y`. The template ships TS `strict`; I added
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **License check is a custom script**, not license-checker-rseidelsohn. The current 5.x
  needs Node 24 (we run 22), and its `--failOn` is exact-string matching, so
  `GPL-2.0-or-later` slips through unless listed. `scripts/license-check.mjs` parses SPDX
  expressions for npm and for `cargo metadata` (all targets, Windows crates included).
- **Approved non-copyleft extras** (`license-policy.json`), outside CLAUDE.md's list:
  - Unicode-3.0: ICU4X via Tauri
  - Zlib: foldhash, zlib-rs
  - CC-BY-4.0: caniuse-lite, build-time only
  - OFL-1.1: `@embedpdf/fonts-*`. Only their file-list JS is imported; ~150 MB of fonts
    sit in `node_modules` unbundled.

  **Owner review requested** for all four, especially OFL-1.1.

- **IRS forms are hybrid AcroForm + XFA** (pdf-lib warns and strips XFA). The forms phase
  must decide how to treat XFA.
- **Gotchas fixed in this phase:**
  - Node pools Buffers under 4 KB, so `buf.buffer` holds other data. Use
    `toArrayBuffer()`.
  - pdf-lib writes string streams one byte per character, which broke the XMP BOM.
    Pass UTF-8 bytes.
  - pdfjs-dist 6 removed `Metadata.getAll()`. Use `getRaw()`.
  - Playwright 1.64 wants a newer Chromium than this container has. Set
    `PW_CHROMIUM_PATH` to use another one.
- **Process slip:** commit `cdea18b` was pushed with `license-check` failing. A pipe hid
  the exit code. It was fixed in the next commit (`48b2000`), and `npm run check` now runs
  every gate and stops at the first failure.

## Not verified: needs a 10-minute check on Windows

```
npm ci
npx playwright install chromium   # once
winget install qpdf.qpdf          # or put qpdf.exe on PATH; needed for corpus + tests
npm run check
npm run tauri dev                 # then click "Phase 0 spike (throwaway)"
```

In the spike page:

1. **Open…** a corpus file from a long path, and one from a `\\server\share` path.
2. **Add stamp + free text** → **Save As…** → open the result in **Adobe Acrobat**.
   Check that the stamp and note render and can be selected.
3. Open `ssn-redaction.pdf` → **Mark + apply redaction** → **Save As…** to a new name.
   Then try **Save As…** onto the original. It must be refused.
4. With the target file open in Acrobat, **Save As…** over it. Expect "the file is open
   in another program".

Report anything that differs, especially whether WebView2 accepts the CSP.

## Exact versions

| Package                                                      | Version                            | License           |
| ------------------------------------------------------------ | ---------------------------------- | ----------------- |
| @tauri-apps/cli, @tauri-apps/api                             | 2.12.4                             | Apache-2.0 OR MIT |
| tauri (crate) / tauri-build / wry / webview2-com             | 2.12.5 / 2.7.4 / 0.57.0 / 0.39.1   | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog, tauri-plugin-dialog               | 2.8.3                              | MIT OR Apache-2.0 |
| @embedpdf/engines, pdfium, models                            | 2.15.1                             | MIT               |
| @embedpdf/fonts-* (transitive)                               | 1.0.0                              | OFL-1.1           |
| react, react-dom                                             | 19.3.1                             | MIT               |
| vite / @vitejs/plugin-react                                  | 8.3.5 / 6.1.2                      | MIT               |
| typescript                                                   | 6.0.3                              | Apache-2.0        |
| vitest                                                       | 5.0.5                              | MIT               |
| @playwright/test                                             | 1.64.1                             | Apache-2.0        |
| eslint / @eslint/js / typescript-eslint                      | 10.13.0 / 10.0.1 / 8.72.0          | MIT               |
| eslint-plugin-react-hooks / eslint-config-prettier / globals | 7.1.1 / 10.1.8 / 17.13.0           | MIT               |
| prettier                                                     | 3.9.10                             | MIT               |
| pdf-lib (dev, corpus only; unmaintained since 2022)          | 1.17.1                             | MIT               |
| pdfjs-dist (dev, test extractor)                             | 6.4.299                            | Apache-2.0        |
| @types/node                                                  | 22.20.5                            | MIT               |
| qpdf CLI (system, corpus + tests)                            | 11.9.0                             | Apache-2.0        |
| Node / npm / rustc / cargo                                   | 22.22.0 / 10.9.4 / 1.97.0 / 1.97.0 | n/a               |
