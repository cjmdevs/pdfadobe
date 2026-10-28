# Test guide: Phase 5 (Redaction and Sanitize)

About 25 minutes. Synthetic files only (the SSN everywhere is the fake `000-12-3456`).

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed. Tesseract is only for
the automated suite (step 0); it is already on the build PC.

```powershell
git pull origin main
npm ci
npm run corpus -- --force
npm run tauri build
New-Item -ItemType Directory -Force C:\PDFTest | Out-Null
$g = "tests\corpus\generated"
Copy-Item -Force "$g\ssn-redaction.pdf","$g\leak-scan.pdf","$g\leak-sanitize.pdf","$g\acroform.pdf" C:\PDFTest\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`.

## Steps

0. **Automated leak suite.** `npx vitest run tests/redaction`.
   Pass: all pass (1 skipped is expected). It redacts six files and looks for the SSN
   with pdf.js, qpdf and OCR.

1. **Search & Redact.** Open `C:\PDFTest\ssn-redaction.pdf`, Tools pane > **Redact**.
   In the panel click **Find** (SSN is ticked by default).
   Pass: "3 found" with page and text for each. Also try typing `KEEP` in Find text, and
   `Line \w+` as your own pattern: hits appear; a broken pattern like `(` shows a red
   message. Click **Mark all**. Pass: dashed red boxes on the page, 3 rows under Review.

2. **Draw Box, Mark Text, Mark Page.** Toolbar **Draw Box**, drag over the form field
   ("Field:") and over the picture with the blue square; Esc. Select a word with the
   mouse and click **Mark Text**. Go to page 2, click **Mark Page**.
   Pass: each shows as a new box and a new Review row. Click a row: the page jumps to it.

3. **Review.** **Reject** the Mark Text and Mark Page rows (they disappear), **Accept**
   one row (box turns solid), then **Accept all**. Pass: "Review (5 of 5 accepted)".

4. **Overlay and Apply.** Overlay: type `Redacted`, tick **Repeat**. Click **Apply 5
   accepted mark(s)**. Pass: a message says it wrote a new file and the original is
   unchanged; `ssn-redaction_Redacted.pdf` opens in a new tab with black boxes and
   white "Redacted" text; the KEEP lines are still there; the red line under the first
   SSN is still drawn up to the box edge.

5. **Check it in Acrobat.** Open `C:\PDFTest\ssn-redaction_Redacted.pdf` in Acrobat.
   Ctrl+F `3456` (in the search panel tick bookmarks and comments). File > Properties.
   Pass: no matches; Subject and Keywords are empty; no sticky note or form field over
   the boxes; select-all + copy and paste into Notepad: no SSN.

6. **Refusal.** Back on the original tab: Find, Mark all, **Reject** the page 2 row,
   Accept all, Apply. Pass: a red "Not saved" message names page 2 (not the number
   itself) and no new file appears in `C:\PDFTest`.

7. **Scan.** Open `leak-scan.pdf`. Page 1 has an OCR layer: Find marks the SSN there.
   Page 2 is image only: Draw Box over the SSN. Accept all, Apply.
   Pass: in `leak-scan_Redacted.pdf` both SSNs are black boxes; zoom in, nothing shows
   through; Acrobat finds no `3456`.

8. **Sanitize.** Open `leak-sanitize.pdf`, Redact > **Sanitize Document** (bottom of the
   panel), leave all ticked, **Sanitize into a new file**.
   Pass: the message lists what went; in Acrobat, `leak-sanitize_Sanitized.pdf` has no
   attachment (paperclip panel empty), no Subject, and the visible text is unchanged.

9. **Forms.** Open `acroform.pdf`. Near the top is a row labelled **Filing status** with
   three small round buttons. Click **Draw Box** and drag a small box around only the
   middle round button, then **Accept all** and **Apply**.
   Pass: in `acroform_Redacted.pdf` all three round buttons are gone, not just the one
   you boxed (they are one field sharing one answer). Taxpayer name, Tax year, the
   checkbox and Notes are still there and still work, in our app and in Acrobat.

## Checklist

- [ ] 0 Automated leak suite
- [ ] 1 Search & Redact (patterns, text, own pattern)
- [ ] 2 Draw Box, Mark Text, Mark Page
- [ ] 3 Review accept / reject / jump
- [ ] 4 Overlay + Apply writes `_Redacted.pdf`
- [ ] 5 Acrobat: no SSN anywhere
- [ ] 6 Refusal writes nothing
- [ ] 7 Scanned pages
- [ ] 8 Sanitize Document
- [ ] 9 Form field under a box

Real network share (`\\server\share`) checks are deferred to Phase 10.

## If a step fails

Send the step number, what you clicked and what you saw (a screenshot helps). For step
5 or 7, also send the `_Redacted.pdf` file (it holds only the fake SSN).
