# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **B5 (Create PDF / Export PDF) built 2026-11-02, owner check on a work PC pending**
  (`docs/testing/b5-test-guide.md`; spec and decisions in `docs/phases/b5.md`).
  `office.rs` drives desktop Office by COM (late-bound IDispatch, named args): source
  copied to a job folder, opened read-only/hidden, macros forced off (AutomationSecurity
  3), wrong dummy password so protected files fail fast, one at a time, 3 min limit
  (5 for PDF to Word) that kills only an Office process this conversion started; Quit
  only if we started it (PowerPoint attaches to an open one). Create PDF: one PDF per
  file beside it, or `Combined.pdf` beside the first (order editable, bookmark per
  file, OCR only on pages without text). Export: Word via Word's own PDF conversion;
  Excel via `engine/convert/tables.ts` (lines = rows, shared gaps = columns, report
  amounts to numbers) + `xlsx.ts` (fflate, inline strings, one sheet per page).
  No new dependencies; `windows` crate gains Ole, Variant, ToolHelp, Threading.
  Not verified: any real Office conversion (build PC has no desktop Office; the Rust
  test skips); Word's "will now convert your PDF" message is suppressed only by
  DisplayAlerts (undocumented). `mcp-stdio` fails on this PC because the Tier B policy
  (HKLM `AllowContentToClaude` = 1) is still on from the Phase 9 test; not a B5 change.

- **Phase 9 (MCP server) done: owner check passed 2026-11-02**, tagged `phase-09-done`.
  Steps 7-8 were redone after the extension folder was first set to `C:\PWTest` instead
  of `C:\PWTest\Shared` (code behaved as designed). Manifest author is "Carson".
  (`docs/testing/phase-09-test-guide.md`; spec and decisions in `docs/phases/phase-09.md`).
  On the build PC: `npm run check` (627 Vitest + 1 intended skip, 62 Rust,
  license-check), Playwright 186-189 of 190 per full run: a different few fail each run and
  pass alone; `phase-08-done` code fails the same way (4 per run), so these are old load flakes. `npm run mcp:inspect`: all 15 Tier A
  calls pass on the bundle. Details in "Phase 9" below.
- **Phase 8 (signatures, certificates, security) done 2026-10-31**, tagged
  `phase-08-done` (owner re-check passed, `phase-08-fixes-test-guide.md`).
- **Phase 7 (scan, OCR, optimize, document tools, conversions) done 2026-10-31**, tagged
  `phase-07-done`. Lesson: anything that hands a resource path to an outside program
  must be tested with a `\\?\` path (Tauri canonicalises the app path).
- **Phase 6 (forms) done 2026-10-28**, tagged `phase-06-done`. Save, Save As and Fill
  from CSV strip a hybrid form's XFA twin and /Perms (`bytesForSave`).
- **Phase 5 (redaction) done 2026-10-28**, tagged `phase-05-done`.
- **Phase 4 done 2026-10-31**, tagged `phase-04-done` (stage 4 built in B6).
- **B6 parity pass done 2026-10-31** (`docs/testing/b6-fixes-test-guide.md`): PDFlyer
  format decoded from the owner's sample (tickmarks /Stamp `Category:Item`, tape /FreeText
  `Calculator Tape:PDFlyer` with /TapeData, sticky notes /FreeText + /NoteData); our marks
  are written in PDFlyer's format (`engine/flyer/pdflyer.ts`). Not verified: PDFlyer
  reading our marks; clipboard in WebView2.
- **B3 Edit PDF stage 1 done 2026-10-27; stage 2 owner checks in progress.** Still open:
  Shift+right arrow in the installed app (not reproducible in dev or e2e).
- Phases 0-3, B1, B4 done (tags `phase-02-done`, `phase-03-done`).
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

## Earlier detail (summary; full text in git history of this file)

- **B3 Edit PDF stage 1**: `src/engine/edit/` (PDFium chars -> boxes/paragraphs, one
  style per paragraph retypeset and read back, own sfnt reader + HarfBuzz subsetting,
  images add/move/resize/replace/delete); host `fonts.rs` (Windows/user/firm fonts,
  firm share mirrored to `<config>\font-cache\firm\`); UI `src/ui/edit/`, each change one
  `wb.edit` undo step. Spike: `docs/edit-spike-report.md`.
- **Phase 4** (spec `docs/phases/phase-04.md`): tickmarks as /Stamp (pdf-lib), library
  built-in < firm < personal, tags in EmbedPDF custom data (`pwType`); letter/number
  picks linked by /Link + /IRT; connectors are /Line (`pwFrom`/`pwTo`), cross-page ends
  "p. N" markers; sign-off stamps, workpaper notes; calculator (10-key + standard,
  foot / cross-foot, tape as /Stamp `pwTape`). Deviations: same-page connectors attach
  only in our app; items repeat until Esc; standard calculator has no precedence.
- **Phase 5 (redaction)**: `src/engine/redact/` pipeline: PDFium redact text/vectors/
  pixels (`apply.ts`), qpdf object edits (annotations, whole fields, `objects.ts`), scrub
  (XMP, XFA, /Info, tagged text, `sanitize.ts`), optional Sanitize, qpdf full rewrite,
  leak scan (`leak.ts`, throws `RedactionLeakError`). UI `src/ui/redact/`; output
  `_Redacted.pdf` / `_Sanitized.pdf`. Leak suite + CI workflow + `.githooks/pre-push`.
  Owner: the Redact panel looks ugly and is a little confusing; redesign later. Gaps:
  form XObject paths partly under a box removed whole; clipped paths lose blend/spot
  colours; in-app leak scan has no OCR; bookmark titles with a redacted string refuse.

- **Phase 6 (forms)**: spike `docs/forms-spike-report.md` (PDFium creates text/check/
  radio/dropdown fields, not signatures; no JavaScript in the WASM). `src/engine/forms/`
  (fields, fill by name, XFA strip, Reset/Clear, FDF/XFDF/JSON/CSV, one copy per CSV
  row, flatten, design, detect, AFSimple_Calculate + AFNumber_Format). UI `src/ui/forms/`
  on `@embedpdf/plugin-form` with our own `TextFill`. Deviations: read-only fields
  skipped by fill/import/Reset; empty CSV cell leaves the field; signature fields are
  placeholders; custom calc scripts never run. Gaps: saved IRS forms lose XFA and /UR3
  (by design); recalculation is one undo step per field; date formats not validated;
  keystroke filters not enforced; Detect knows blanks, lines and boxes only.

## Phase 9: MCP server (2026-11-02)

Plan approved 2026-11-02 with the recommended answers (`docs/phases/phase-09.md`).

- **Server** (`mcp-server/src/`): `@modelcontextprotocol/server` 2.4.0 (SDK v2:
  `registerTool` with zod v4 `z.object`, `serveStdio`), stdio only. Imports `src/engine`
  directly. `runtime/` loads PDFium and HarfBuzz from local WASM bytes (`createPdfium` keeps
  fontFallback: null) and runs qpdf/Tesseract; the Node runners moved here from
  `tests/helpers` (tests re-export them) and take a job-folder base.
- **Safety** (`safety/`): `roots.ts` resolves every path with `fs.realpath.native`
  (junctions, subst, 8.3 names) and requires it inside a configured folder
  (case-insensitive); relative, `\?\`/`\.\` and `file:stream` paths refused.
  `writer.ts` is the only writer: copies into `<folder>\_workspace\<date>_<task>\`,
  publishes to `<folder>\Outputs\` with exclusive create (`name (2).pdf`), creates each
  folder level and refuses if it resolves elsewhere (junction), masks SSN/EIN/7+ digit
  runs in every name it creates. qpdf/OCR job folders live inside the task folder, so
  nothing goes to %TEMP%. `audit.ts`: JSONL per call in `<folder>\_workspace\_audit\`
  (tool, tier, paths, pages, outputs, time, Windows user, ok/error name; never text or
  error messages); a call whose audit line cannot be written is refused.
- **Tools**: 16 Tier A (list_pdfs, get_info, open_in_app, merge, split, rotate, reorder,
  extract_pages, insert_pages, add_bookmarks, ocr, optimize, add_bates, add_header_footer,
  add_watermark, redact_patterns); 4 Tier B registered only when
  `HKLM\Software\Policies\PDF Workbench\MCP` `AllowContentToClaude` = DWORD 1 (read via
  `reg.exe`). Calls run one at a time (PDFium is single-threaded). Password-protected
  files are refused for changes; signed inputs get a warning. Errors shown to Claude are
  fixed texts or engine messages that hold no document data.
- **redact_patterns**: page-text hits (padded 1 pt) plus form-field values matching the
  patterns (whole widget marked), then `redactDocument` (leak scan must pass). Counts per
  page only.
- **open_in_app**: starts PDF Workbench with `<file> --page=N`; `launch.rs` appends
  `|page=N` to the path, `openPaths` splits it (`src/app/launchPage.ts`) and uses the
  restore-page hook.
- **Packaging**: `npm run mcp:build` (esbuild bundle + wasm + sidecars +
  THIRD-PARTY-LICENSES.txt, manifest 0.3, `mcpb validate` + `pack`):
  `mcp-server/dist/pdf-workbench.mcpb`, 23 MB packed / 54 MB unpacked. Settings: shared
  folders (directory, multiple) and optional app path.
- **Tests**: `mcp-tools` (every tool via in-memory client), `mcp-safety` (path attacks,
  junctions, output/task names, before/after snapshot of the whole sandbox, Tier B absent
  when off and headed/audited B when on), `mcp-network` (all Node network APIs trapped in
  process), `mcp-stdio` (built bundle in plain Node with `--import block-net.mjs`),
  `npm run mcp:inspect` (MCP Inspector CLI, every Tier A tool but open_in_app, on the bundle).

**Deviations:** manifest 0.3 (mcpb 2.1.2 also knows 0.4; the spec page calls 0.3 current).
`list_pdfs` skips `_workspace` unless asked and never follows links. `split` by bookmarks
names files after bookmark titles (masked). Tier B `read_text` is capped at 20 pages per
call. `get_info` also reports `needs_password` and `has_signatures`. Inspector skips
open_in_app (it would launch the app); Vitest covers it with a stub launcher.
**Not verified yet:** installing the .mcpb in Claude Desktop and Claude Desktop's own
Node (owner test); a real UNC share (Phase 10); open_in_app on an already-open tab or a
tab in another window (activates it, does not jump to the page).

## Earlier detail: Phase 8 (summary)

Own PAdES signing (`src/engine/sign/`: incremental update writer, CMS by pkijs,
/ETSI.CAdES.detached, 24 KB /Contents); keys stay in Windows (CNG, `certsign.rs`; .pfx in
memory only, found only with CRYPT_ACQUIRE_CACHE_FLAG); Signatures
panel checks digest and signature (no trust check); DPAPI saved signatures; Fill & Sign
marks as stamps; Protect = AES-256 via qpdf job file. Deviations: no @signpdf, no
timestamp/LTV, signing a protected file refused, Protect writes a new file.

## Earlier detail: Phase 7 (summary)

Tesseract 5.5.4 + Leptonica 1.87.0 + zlib built from source (`scripts/build-tesseract.mjs`,
needs the VS C++ workload) and bundled; OCR runs on a straightened copy and its text is
grafted back (`pages/graft.ts`, `/PWDecor` tags; not qpdf --overlay). Enhance, batch OCR,
Optimize (Email/Standard/Archive), Header & Footer, Bates, Watermark, Background (14
standard fonts only), Export PNG/JPEG/text, Create PDF from images. Remove only finds
what PDF Workbench added.

## Dependency versions and licenses

Earlier phases: `docs/spike-report.md` and git history of this file. Phase 3: EmbedPDF
annotation/history 2.15.1 (MIT), pdf-lib 1.17.1 runtime (MIT), fast-xml-parser 5.11.2
(MIT). **B3: harfbuzzjs 1.6.4 runtime (MIT; HarfBuzz "Old MIT", owner-approved
2026-10-26)**; dev-only @pdf-lib/fontkit 1.1.1 (MIT) for spike samples. No new crates.
Phase 4 stage 1: no new dependencies (four more Fluent icons from the existing package).
Phase 5: no new npm or crate dependencies. Test/CI only: Tesseract OCR 5.4.0 (Apache-2.0;
build PC via winget `UB-Mannheim.TesseractOCR`, CI via choco), qpdf 12.4.2 (Apache-2.0,
already vendored). **Phase 6: @embedpdf/plugin-form 2.15.1 runtime (MIT; its package.json
has no license field, so `license-policy.json` records the LICENSE file).** No new crates:
the `windows` crate gains its `Win32_System_Registry` feature (Open in Acrobat).
**Phase 7: jpeg-js 0.4.4 runtime (BSD-3-Clause).** Bundled sidecar, built from source:
Tesseract 5.5.4 (Apache-2.0), Leptonica 1.87.0 (BSD-2-Clause), zlib 1.3.1 (Zlib),
tessdata 4.1.0 eng/osd (Apache-2.0). Noto Sans (OFL-1.1, from `@embedpdf/fonts-latin`)
is used by a test only. No new crates.
**Phase 8: pkijs 3.4.3 runtime (BSD-3-Clause) with asn1js 3.1.0 and bytestreamjs 2.0.1
(BSD-3-Clause), pvtsutils 1.3.6, pvutils 1.2.0, @noble/hashes 1.8.0 (MIT), tslib 2.9.1
(0BSD); @fontsource/dancing-script, great-vibes, allura, caveat 5.3.0 (OFL-1.1, fonts
bundled unmodified).** No new crates: the `windows` crate gains `Win32_Security_Cryptography`
and `Win32_System_Time`. Test only: OpenSSL from Git for Windows (Apache-2.0) checks
signatures when present.
**Phase 9: @modelcontextprotocol/server 2.4.0 (Apache-2.0; pulls @modelcontextprotocol/core
2.4.0 Apache-2.0, ext-apps 2.0.4 MIT, ext-tasks 0.2.2 Apache-2.0), zod 4.6.7 (MIT), bundled
into the .mcpb.** Dev only: @modelcontextprotocol/client 2.4.0 (Apache-2.0),
@anthropic-ai/mcpb 2.1.2 (MIT), esbuild 0.28.2 (MIT), @modelcontextprotocol/inspector
2.13.0 (Apache-2.0 + MIT for older code; package.json says "SEE LICENSE IN LICENSE", so
`license-policy.json` records the LICENSE file). No new crates.

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
- A tab's document id changes with every edit: key per-document UI state by `storeId`.
- Form widgets are locked (fill mode) except while Prepare Form is open (`FormMode.tsx`).
- **Phase 7:** OCR is English only; pages with 20+ characters count as "has text" (a
  Bates stamp alone does not). Straighten Pages does not turn comments with the page.
  Optimize leaves black-and-white, CMYK, indexed and JPEG 2000 images alone and does not
  subset simple TrueType, Type 1 or CFF fonts. Optimize, Export and Create PDF cannot be
  cancelled (OCR can). Watermark offsets (dx, dy) exist in the engine, not in the dialog.
  Build PC needs the VS C++ workload for `npm run build-tesseract`.
- **Phase 8:** saving markup on a signed file rewrites it (PDFium), which breaks the
  signature (the "digitally signed" warning covers page changes only): sign last, or
  sign again. The signature's text is Helvetica (WinAnsi; other characters print as "?").
  24 KB is reserved for the CMS: very long certificate chains are refused. The signature
  box assumes the crop box starts at 0,0, like the rest of the app.
- **B5:** Excel export has no lattice (ruled-grid) mode, no merged cells, no dates
  (left as text), and leading-zero codes / 8+ digit runs stay text. Excel's Power Query
  PDF import (option B) was not built. Office conversions cannot be cancelled. Users
  must have desktop Office; web-only Office shows "needs Microsoft Word".
- **Phase 9:** redact_patterns finds only text-layer and form-field matches (scans need
  ocr first; numbers inside images are missed) and refuses when the leak scan fails, so
  the person redacts in the app. The audit log can grow without limit (one file a
  month). Tier B is per PC (HKLM): Phase 10 must decide how the firm rolls the policy
  out. The .mcpb must be rebuilt after engine changes (`npm run mcp:build`). Anything
  in `src/engine` used by the server must stay Node-safe and network-free (the network
  test runs every tool).
- e2e flakes seen in Phase 7 and 8, all passing alone (Edit PDF list spacing too): Edit PDF "Shift+arrow pressed while
  the last move is saving" (also fails without Phase 7) and the Stamp menu save check.
