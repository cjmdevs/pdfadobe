# Phase 9: MCP server

Spec as given by the owner on 2026-11-02 (plan approved the same day with the
recommended answers listed under "Decisions").

## Spec

The MCP server in `mcp-server/`. Check the current MCP TypeScript SDK and MCPB docs
before coding.

Architecture: the server imports the same `src/engine/` code the app uses (no duplicate
PDF logic). stdio transport only. Packaged as `.mcpb`.

Node has no CSP: load PDFium WASM from local bytes, set fontFallback to null, and add a
test that fails on any outbound network request. Keep the getPageGlyphs() guard on all
text extraction (spike bug #2: stale WASM memory).

Safety rules enforced in code, not by prompt:

- Only folders listed in the extension's config are reachable.
- Originals are read-only. Any change copies the file to
  `<shared>\_workspace\<YYYY-MM-DD>_<task>\` first; finished files go to
  `<shared>\Outputs\`. Never write, rename, move, or delete outside those two.
- No tool ever sends, emails, uploads, or shares a file anywhere.
- Every call is appended to a local audit log (tool, file path, time, user); never log
  document text.

Tier A tools (metadata only, never document text): list_pdfs, get_info (pages, size,
has_text, has_forms, is_encrypted), merge, split, rotate, reorder, extract_pages,
insert_pages, add_bookmarks, ocr, optimize, add_bates, add_header_footer, add_watermark,
redact_patterns (SSN/EIN/account presets; returns match COUNTS per page only),
open_in_app (opens a file at a page in PDF Workbench for a human).

Tier B tools (return document content to Claude), DISABLED by default behind a flag
"allow_content_to_claude" that only the firm can turn on: read_text(pages),
read_form_values, list_annotations, render_page_image. When enabled: each call names the
file and page range in its result header and is marked in the audit log.

Tool descriptions tell Claude to refer to clients by initials or file number, never by
SSN/EIN, and to stop and ask before any Tier B call.

Tests: an MCP Inspector session runs every Tier A tool on the corpus; a test proves Tier
B tools are unreachable when the flag is off; a test proves no tool can write outside
`_workspace\` and `Outputs\`.

## Decisions (owner, 2026-11-02)

1. The Tier B flag is a machine policy only an administrator can set:
   `HKLM\Software\Policies\PDF Workbench\MCP`, DWORD `AllowContentToClaude` = 1. It is
   not an extension setting (any user could change those).
2. `redact_patterns` redacts (full Phase 5 pipeline with leak scan) and writes
   `_Redacted.pdf` to Outputs; `dry_run` only counts.
3. qpdf and Tesseract are bundled inside the `.mcpb`.
4. The audit log lives in `<shared>\_workspace\_audit\mcp-audit-YYYY-MM.jsonl`.

## Gate

`npm run check`, `npm run test:e2e`, `npm run mcp:build`, `npm run mcp:inspect` all pass;
owner test guide `docs/testing/phase-09-test-guide.md` passes; tag `phase-09-done`.
