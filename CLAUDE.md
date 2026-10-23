# PDF Workbench

Windows desktop PDF editor for a CPA firm. Replaces Adobe Acrobat + CCH PDFlyer for
everyday work: viewing, page organization, markup, true redaction, workpaper tickmarks,
forms, OCR, and a local MCP server for Claude.

## Stack (do not change without asking)

- Tauri 2: Rust backend in `src-tauri/`, WebView2 frontend
- React + TypeScript (strict) + Vite in `src/`
- EmbedPDF (PDFium WASM) for render, annotations, forms, redaction
- qpdf CLI (bundled sidecar) for repair, encryption, linearization
- Tesseract for OCR
- MCP server: official TypeScript SDK, stdio, in `mcp-server/`

## Non-negotiables

- Licenses: MIT, BSD, Apache-2.0, MPL-2.0, ISC, Unicode-3.0, Zlib, OFL-1.1 (fonts),
  CC-BY-4.0 (build-time only). NEVER AGPL/GPL/LGPL-static.
  No MuPDF, no Ghostscript. State the license of every new dependency in the PR summary.
- Never overwrite an original file. Save As by default; Save writes to a temp file then
  atomically replaces, keeping a `.bak` until the saved file reads back exactly as
  written (then the `.bak` is deleted; if not, it stays and the user is told). A leftover
  `.bak` is deleted on the next successful open. (Owner decision 2026-10-23.)
- All markup is stored as standard PDF annotations that render in Adobe Acrobat.
  No proprietary sidecar files for anything a reviewer must see.
- Redaction must physically remove content (text, images, vectors, metadata, form values,
  annotations) under the box. A redaction feature is not done until `tests/redaction` passes.
- No telemetry, no network calls from the app except the explicit update check.
- No real client data in the repo, tests, logs, or fixtures. Synthetic PDFs only.
- Logs must never contain document text.

## Working rules

- Plan before coding. Show the plan, wait for approval.
- Check current library docs before using an API; do not rely on memory.
- Small steps, each with tests, each committed.
- Git: commit and push directly to `main` (solo project, no feature branches).
  Never push a commit with failing tests. Tag `phase-NN-done` at the end of each phase.
- If a requirement is ambiguous or a library can't do something, stop and ask.
- Read `docs/progress.md` at the start of every session.
- At the end of every phase, update `docs/progress.md`: what was built, every deviation
  from the phase spec and why, package versions, known gaps, and anything a later
  phase must know. Keep it under 2 pages; summarize older phases.
- At the end of every phase or backlog item, write `docs/testing/<item>-test-guide.md`
  and paste it in chat. Assume the tester knows nothing. Include: exact setup
  commands for PowerShell, anything to install, where test files are; then numbered
  steps for EVERY feature built: what to open, what to click, what should appear,
  how to check the result in Adobe Acrobat, and how to tell pass from fail. End with
  a checklist to tick and exactly what to send back if a step fails.
- Windows paths, long paths, UNC network shares (`\\server\share`), and files locked
  by other programs are normal here. Handle them.
- The build PC has no firm network. Test UNC handling against a local share
  (`\\localhost\<share>`) on the build PC; mark real-network checks "deferred to
  Phase 10" in test guides. Phase 10 tests on a work PC with the installed app
  only: no dev tools get installed there.

## Commands

- `npm run dev` / `npm run tauri dev`
- `npm test` (Vitest), `npm run test:e2e` (Playwright)
- `cargo test` (in `src-tauri`)
- `npm run license-check` (fails on copyleft)

## Layout

- `src/` UI (React)
- `src/engine/` PDF operations; NO React/DOM imports, must run in Node (MCP reuses it)
- `src/flyer/` tickmarks, connectors, stamps, calculator tape
- `src-tauri/` Rust: file IO, qpdf/tesseract sidecars, file associations
- `mcp-server/` local MCP server
- `tests/corpus/` synthetic PDFs
- `docs/phases/` phase specs
