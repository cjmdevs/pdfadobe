# Progress

Read this at the start of every session. Update it at the end of every phase.
Keep it under 2 pages; summarize older phases.

## Current status

- **Phase 10a (packaging) done 2026-11-04, owner check passed.**
  (`docs/testing/phase-10a-test-guide.md`, spec and decisions `docs/phases/phase-10a.md`,
  admin guide `docs/admin.md`). Details in "Phase 10a" below.

- **B2 (Home screen) done 2026-11-03, owner check passed.** Home at launch / after the last
  tab / house tab; Recent Files (`src/app/recent.ts`: 15 + 20 pinned; reachability by
  `path_status`: ok / missing / offline greyed); page-1 JPEG thumbnails only in
  `%LOCALAPPDATA%\com.cjmdevs.pdfworkbench\thumbnails\` (`thumbs.rs`, swept at start);
  session restore opt-in. Gaps: a file changed elsewhere keeps its old thumbnail; Recent
  Files last writer wins across windows; Clear all removes pinned too.

- **B7 (UI design pass) done 2026-11-03, owner check passed** (`docs/testing/b7-test-guide.md`).
  Direction "Ledger"; design system `src/ui/theme/tokens.css` + `base.css` (tokens only in
  `styles.css`, WCAG AA checked by `tests/unit/contrast.test.ts`); kit `src/ui/kit/`
  (Dialog = Cancel + one primary, `keyboard.ts`, `text.ts`); Fluent 20 icons. Enter/Space
  press focused buttons, menu items, options and tabs (`Commands.tsx` `activates`).
  Redact Find also searches form-field values (`engine/redact/fieldSearch.ts`) and a
  refusal says where the text still is (`places.ts`). Deviations: sentence-case dialogs,
  toolbars keep every control as a Tab stop. Gaps: at small zoom a connector's end can
  cover its tickmark; `npm run ui:shots` misses some menus and error states.

- **B5 (Create PDF / Export PDF) done 2026-11-02, owner check on a work PC passed**
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
  Owner work-PC check: all 10 steps pass. Step 8 (PDF to Word) first hung on Word's
  hidden "will now convert your PDF" message, which DisplayAlerts does not stop. Fix:
  HKCU `Office\16.0\Word\Options\DisableConvertPdfWarning` is set to 1 for the export
  and restored after (removed if it wasn't there); the value name comes from community
  posts, not Microsoft docs; an app crash mid-export leaves it at 1. Retest passed,
  and Word's own setting came back afterwards. `mcp-stdio` fails on this PC because the Tier B policy
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

## Phase 10a: packaging (2026-11-04)

- **Installer**: NSIS only, `installMode: currentUser` (no admin for install or update),
  WebView2 `embedBootstrapper`. `src-tauri/windows/hooks.nsh` registers the app for
  Default apps (HKCU Capabilities, RegisteredApplications, OpenWithProgids; kept during
  /UPDATE). ProgID is now `PDFWorkbench.Document`. Sidecars stay `bundle.resources`.
- **Signing**: `bundle.windows.signCommand` = `scripts/sign.mjs` (signtool by
  `PDFWB_SIGN_THUMBPRINT`, or any tool via `PDFWB_SIGN_COMMAND`); `PDFWB_RELEASE=1`
  (`npm run release`) makes a missing certificate fail the build. Tauri restores the
  unsigned exe after packing, so sign.mjs keeps the signed copy in
  `target/release/signed/` for `verify-signed.mjs`. Release gates: the three version
  fields agree, `check-payload.mjs` (reads Tauri's generated installer.nsi),
  `verify-signed.mjs`. With the test certificate Tauri prints "SignTool Error ... root"
  while pre-checking files; expected.
- **Notices**: `scripts/notices.mjs` (npm = what the Vite bundle used, from the
  `bundlePackages` plugin in vite.config.ts; cargo metadata normal deps; sidecars);
  identical texts once; a dependency without text fails unless `license-policy.json`
  `licenseTexts` points at a reviewed copy in `licenses/upstream/` (7 today). 302
  components.
- **Crash reports** (`src/app/crash.ts`, `crash.rs`): local only, newest 20; messages
  withheld except JS code errors (quotes, paths, numbers cut); Rust panic messages
  scrubbed. CrashBoundary screen; Ctrl+Alt+Shift+F11 throws a test error.
- **Open in Acrobat**: `ui/kit/AcrobatButton.tsx` on every error toast (the toast carries
  the active file's path), can't-open, damaged file, page-op and signature errors, crash
  screen; `tests/unit/acrobat-escape.test.ts` fails on new error UI without it (input
  checks listed as exceptions).
- **First run** (`FirstRunDialog.tsx`): name, firm library folder (fixed names
  `tickmarks.json`, `layout.json`, `fonts\` set the existing firm paths), default app via
  `ms-settings:defaultapps?registeredAppUser=PDF%20Workbench` + UserChoice(Latest) check.
- **Updates** (`update.rs`, own checker, not tauri-plugin-updater which needs https):
  folder from HKLM/HKCU `Software\Policies\PDF Workbench\Update` `Source` (or build-time
  `PDFWB_UPDATE_SOURCE`); `Disabled`=1 turns it off. latest.json and the installer are
  each signed with `tauri signer` (minisign); public key `src-tauri/update-key.pub` is
  built in. The installer is copied to Local AppData; SHA-256, minisign and
  WinVerifyTrust run on the copy; then `/P /R /UPDATE`. Rollback only via a signed
  `"rollback": true`. Daily check at start (counted only when the folder answered) and
  Settings > Check for updates. `scripts/update-package.mjs` packages, publishes (json
  last) and rolls back.
- **Tests**: Vitest `packaging`, `crash`, `acrobat-escape`; Rust `crash`, `appsvc`,
  `update` (fixture manifest signed with a throwaway key); e2e `packaging.spec.ts` (11).

**Deviations:** there is no Help menu, so Check for updates, default app, crash folder
and notices are in Settings > About. Windows Sandbox is not on Windows 11 Home: the owner
test installs on the build PC. The installer's Authenticode check trusts any certificate
Windows trusts (no publisher pinning; the minisign key is the firm-only check). The update
key has no password (can be replaced before the first real release, see admin.md). Owner test fixes: Default apps opens through ShellExecute (explorer.exe opened Documents); notices uses `cargo metadata --offline`, not `--locked` (a version bump changes Cargo.lock). Owner decision: publisher `cjmdevs`, identifier `com.cjmdevs.pdfworkbench` (app data folders follow it).
**Not verified yet:** real certificate and timestamping, a real share, DISM default
associations by GPO, a PC without WebView2 (all Phase 10b).

## Phase 9: MCP server (2026-11-02, summary)

`mcp-server/` on `@modelcontextprotocol/server` 2.4.0, stdio, imports `src/engine`.
Safety in code: `roots.ts` (realpath, configured folders only), `writer.ts` (copies to
`_workspace\<date>_<task>\`, publishes to `Outputs\`, masks SSN/EIN in names),
`audit.ts` (JSONL, no text). 16 Tier A tools; 4 Tier B only with HKLM
`Software\Policies\PDF Workbench\MCP` `AllowContentToClaude`=1. `npm run mcp:build`
makes `mcp-server/dist/pdf-workbench.mcpb`. Not verified: Claude Desktop install, a real
share.

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

**Phase 10a: crates minisign-verify 0.3.0 (MIT, no dependencies), base64 0.22.1 and
sha2 0.10.9 (MIT OR Apache-2.0, both already in the tree); the `windows` crate gains
`Win32_Security_WinTrust`. No new npm packages.** Build tools only: Windows SDK signtool,
NSIS (Tauri's cached copy).

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
- **Phase 10b** (work PC, installed app only): real code signing certificate
  (`PDFWB_SIGN_THUMBPRINT` + `PDFWB_SIGN_TIMESTAMP_URL`), the firm's update share and
  library folder, default app by GPO, a PC without WebView2, everything marked "real
  share" above. Raise the version in package.json, tauri.conf.json and Cargo.toml
  together (release checks). Keep `%USERPROFILE%\.pdfworkbench\update-signing.key` backed
  up.
- **Phase 9:** redact_patterns finds only text-layer and form-field matches (scans need
  ocr first; numbers inside images are missed) and refuses when the leak scan fails, so
  the person redacts in the app. The audit log can grow without limit (one file a
  month). Tier B is per PC (HKLM): Phase 10 must decide how the firm rolls the policy
  out. The .mcpb must be rebuilt after engine changes (`npm run mcp:build`). Anything
  in `src/engine` used by the server must stay Node-safe and network-free (the network
  test runs every tool).
- e2e flakes seen in Phase 7 and 8, all passing alone (Edit PDF list spacing too): Edit PDF "Shift+arrow pressed while
  the last move is saving" (also fails without Phase 7) and the Stamp menu save check.
