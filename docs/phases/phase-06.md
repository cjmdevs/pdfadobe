Read CLAUDE.md. This is Phase 6: forms. Plan first. Before coding, test and report:
(a) can EmbedPDF/PDFium create new AcroForm fields, (b) do calculated fields that
rely on PDF JavaScript update when inputs change. Propose a license-safe fallback
for each gap and wait for approval.

- Fill: all field types, tab order, field highlighting toggle, required-field check
- Reset form, clear selected fields
- Export/import form data (FDF, XFDF, JSON, CSV) and fill many copies from a CSV
- Flatten form to a new file
- Prepare Form: detect likely fields on a flat PDF; add/move/resize/rename text,
  checkbox, radio, dropdown, date and signature fields; set default, required,
  read-only, max length, number/date format
- Hybrid AcroForm + XFA forms (most IRS forms, per Phase 0): fill the AcroForm
  layer; propose whether to strip or keep the XFA on save, and verify the result
  in Acrobat before deciding
- Clear message when a form is XFA-only (unsupported) with an "Open in Acrobat" button

Tests: fill and save each corpus form, reopen in our app and with an independent
parser, assert values; round-trip in Acrobat.

Owner note: keep the test guide at a basic overview level.

## Gate

- Spike findings in `docs/forms-spike-report.md`, fallbacks owner-approved.
- Each corpus form filled, saved, reopened in our app and with pdf.js + qpdf, values match.
- Acrobat round-trip checked by the owner; XFA keep/strip decision recorded.
- `npm run check` and Playwright green; `docs/progress.md` updated; test guide written.
