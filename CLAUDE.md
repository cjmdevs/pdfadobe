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

- Licenses: MIT, BSD, Apache-2.0, MPL-2.0, ISC only. NEVER AGPL/GPL/LGPL-static.
  No MuPDF, no Ghostscript. State the license of every new dependency in the PR summary.
- Never overwrite an original file. Save As by default; Save writes to a temp file then
  atomically replaces, keeping a `.bak` until the next successful open.
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
- If a requirement is ambiguous or a library can't do something, stop and ask.
- Read `docs/progress.md` at the start of every session.
- At the end of every phase, update `docs/progress.md`: what was built, every deviation
  from the phase spec and why, package versions, known gaps, and anything a later
  phase must know. Keep it under 2 pages; summarize older phases.
- Windows paths, long paths, UNC network shares (`\\server\share`), and files locked
  by other programs are normal here. Handle them.

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
