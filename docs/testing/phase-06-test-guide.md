# Test guide: Phase 6 (Forms)

About 30 minutes. Synthetic files and blank IRS forms only.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed.

```powershell
git pull origin main
npm ci
npm run corpus -- --force
npx vitest run tests/unit/forms-spike.test.ts
npm run tauri build
New-Item -ItemType Directory -Force C:\PDFTest | Out-Null
$g = "tests\corpus\generated"
Copy-Item -Force "$g\acroform.pdf","$g\flat-form.pdf","$g\calc-form.pdf","$g\xfa-only.pdf","tests\corpus\irs\f1040.pdf" C:\PDFTest\
Copy-Item -Force "tests\corpus\out\forms-spike\f1040-*.pdf" C:\PDFTest\
@"
taxpayer.name,tax.year,signed.8879
Alpha One,2023,Yes
Beta Two,2024,
"@ | Set-Content -Encoding utf8 C:\PDFTest\clients.csv
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`.

## Steps

1. **XFA decision (Acrobat).** Open each `C:\PDFTest\f1040-keep-xfa.pdf`,
   `f1040-strip-xfa.pdf` and `f1040-strip-xfa-perms.pdf` in Acrobat.
   Note for each: do "SPIKE 1" to "SPIKE 4" and the ticked box show, and is there any
   warning. Save one in Acrobat, close, reopen: are the values still there? Send the
   three answers. This decides how we save IRS forms.

2. **Fill.** Open `acroform.pdf`, Tools pane > **Fill Forms**. Type a name, press Tab
   (goes to Tax year), pick a year, click a Filing status button and the checkbox, type
   two lines in Notes. Ctrl+Z undoes the last field; Esc in a field puts it back.
   Ctrl+S. Pass: values show; open the file in Acrobat, same values.

3. **Highlight, required, reset, clear.** Toolbar **Highlight** turns the blue tint
   off and on. Panel: **Check required fields** (none here: "All required fields are
   filled"); tick two fields in the list, **Clear 2 selected**: only those empty;
   **Reset form** > Reset: everything empties. Ctrl+Z undoes each.
   Pass: as described.

4. **Data.** Fill a few fields, panel **FDF** (writes `acroform data.fdf` next to the
   file), then **Reset form**, then **Import data…** and pick the FDF.
   Pass: the values come back. In Acrobat, Prepare Form > More > Import Data with the
   same FDF also fills them. Try **XFDF**, **JSON** and **CSV** the same way.

5. **Fill copies from a CSV.** Panel **Choose CSV…** > `clients.csv`, Name each file by
   `taxpayer.name`, **Fill 2 copies…**, pick `C:\PDFTest`.
   Pass: `acroform - Alpha One.pdf` and `acroform - Beta Two.pdf` appear, each filled
   from its row; the open form is unchanged.

6. **Flatten.** Fill a few fields, panel **Flatten to new file**.
   Pass: `acroform (flattened form).pdf` opens in a new tab and looks the same, but
   nothing can be typed in. In Acrobat it has no form fields.

7. **IRS form.** Open `f1040.pdf`, fill the name lines and tick a box, Save As
   `C:\PDFTest\f1040-filled.pdf`. Pass: our app reopens it with the values; Acrobat shows
   them (see step 1 for any warning).

8. **XFA-only.** Open `xfa-only.pdf`. Pass: a yellow notice says it only works in
   Acrobat; **Open in Acrobat** opens it in Acrobat.

9. **Prepare Form.** Open `acroform.pdf`, Tools pane > **Prepare Form**. Click **Text**
   then click on an empty part of the page; do the same for Check box, Radio button
   (twice: the second joins the first group), Dropdown, Date, Signature. Drag a field to
   move it, drag a corner to resize, select one and press Delete. Select the text field:
   rename it, tick Required, Max length 5, Format Number, **Apply**. Close Prepare Form,
   type `123456` in it. Pass: it stops at 5 characters; Save; in Acrobat the new fields
   are there, the number field formats, the radio buttons are one group.

10. **Detect fields.** Open `flat-form.pdf`, Prepare Form > **Detect fields**.
    Pass: "Added 6 fields": Client name, Tax year, Preparer, Married, Dependents, Notes,
    each on its blank or box. Ctrl+Z removes them all.

11. **Calculations.** Open `calc-form.pdf`, Fill Forms. Type 1000 in Wages, 234.5 in
    Interest, 3000 in Deduction (Tab after each). Pass: Wages shows 1,000.00, Total
    $1,234.50, Net ($1,765.50), Half updates too; the panel says Custom is calculated
    in Acrobat only. Save, open in Acrobat: same numbers; change Wages there and Total
    follows.

## Checklist

- [ ] 1 XFA decision (send the three answers)
- [ ] 2 Fill, Tab, undo, Esc, save
- [ ] 3 Highlight, required check, Clear, Reset
- [ ] 4 Export/import FDF, XFDF, JSON, CSV
- [ ] 5 Fill copies from a CSV
- [ ] 6 Flatten to a new file
- [ ] 7 IRS 1040 fill and save
- [ ] 8 XFA-only notice and Open in Acrobat
- [ ] 9 Prepare Form: add, move, resize, delete, properties
- [ ] 10 Detect fields
- [ ] 11 Calculations

Real network share (`\\server\share`) checks are deferred to Phase 10.

## If a step fails

Send the step number, what you clicked and what you saw (a screenshot helps). For
Acrobat differences, also send the saved PDF (synthetic data only).
