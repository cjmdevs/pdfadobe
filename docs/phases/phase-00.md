# Phase 0: scaffold, tooling, corpus, EmbedPDF spike

Read CLAUDE.md. This is Phase 0. Plan first, then build.

1. Scaffold a Tauri 2 + React + TypeScript (strict) + Vite app per CLAUDE.md layout.
   Use the current official create-tauri-app template; check its docs first.
2. Add Vitest, Playwright, ESLint, Prettier, and an `npm run license-check` script that
   fails on any AGPL/GPL/LGPL dependency (JS and Rust crates).
3. Create tests/corpus/ with a script that generates synthetic PDFs: a 1-page text
   doc, a 200-page doc, a fillable AcroForm, a scanned-image-only PDF, an encrypted PDF,
   and a doc with fake SSN-pattern text (e.g. 000-12-3456) for redaction tests.
   Also download a few blank IRS forms (public domain) into the corpus.
4. Spike, in a throwaway route /spike, using EmbedPDF:
   a. Open and render a corpus PDF from a Windows path chosen in a native dialog.
   b. Add one image stamp annotation and one free-text annotation, Save As.
   c. Mark a redaction over the fake SSN, apply it, Save As.
   d. Write a Node test that extracts all text from the redacted file and asserts
   the SSN string is absent, including in any annotation contents and metadata.
5. Write docs/spike-report.md: what worked, what didn't, any EmbedPDF limits found,
   and the exact package versions used.

Do not build any real UI yet. Stop after the report and wait for review.

Owner decisions during planning: push to `main`; license gate = deny copyleft plus an
approved list of non-copyleft extras; EmbedPDF limits are marked as known failures
(`it.fails`); synthetic corpus regenerated (not committed), IRS forms committed;
qpdf on PATH is required for corpus generation.

## Gate

- `npm run check` passes (typecheck, lint, format, Vitest, cargo test, license-check).
- `npm run test:e2e` passes.
- `docs/spike-report.md` written; owner has reviewed it.
- Manual Windows check from the report done by the owner.
