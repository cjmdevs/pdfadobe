# Test guide: Phase 4 stage 1 (tickmarks)

Quick overview check, about 20 minutes. Synthetic test files only, never client files.
You need Adobe Acrobat (or Reader) to compare results.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed:

```powershell
git pull origin main
npm ci
npm run fetch-win-binaries
npm run corpus -- --force
npx vitest run tests/unit/flyer.test.ts
npm run tauri build
New-Item -ItemType Directory -Force C:\PDFTest | Out-Null
$g = "tests\corpus\generated"
Copy-Item -Force "$g\text-1p.pdf","$g\stamp-reviewed.png","tests\corpus\out\tickmarks-all.pdf" C:\PDFTest\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`
(if Windows warns: **More info** > **Run anyway**). If any command prints `error`, stop
and send the last 30 lines.

## Steps

1. **The firm set in Acrobat.** Open `C:\PDFTest\tickmarks-all.pdf` in Acrobat.
   Pass: 14 red tickmarks, circled A and B, a small image, and a "Tickmark legend" box
   all show. Click a tickmark: Acrobat's comment says what it means (e.g. "Footed").
   **Look at the symbols and tell me any you want drawn differently** (we drew them
   ourselves from the names).

2. **Place tickmarks.** In PDF Workbench open `C:\PDFTest\text-1p.pdf`, Tools pane >
   **Workpaper Tools**. Click the small arrow next to **Tickmark**, pick **Footed**, then
   click the page 3 times. Press `1`, click twice more. Press Esc.
   Pass: 3 carets (^) then 2 checks; after Esc clicks no longer place anything.

3. **Counting tickmarks.** Arrow next to **Tickmark** > **Letter (A, B, C...)**, click the
   page 3 times, Esc. Pass: circled A, B, C.

4. **Palette + Recent.** Click **Palette**. Click a tickmark in it, click the page, Esc.
   Click **Recent**: what you used is listed; **Clear Recent Stamps** empties it.
   Pass: all as described; the palette closes with its ×.

5. **Your own tickmark.** Click **Library**. Add: Name `Traced`, Kind Symbol, Check,
   letters `T`, blue, Add. Add another: Name `Logo`, Kind Image, pick
   `C:\PDFTest\stamp-reviewed.png`, Add. Close, place both from the Tickmark arrow.
   Pass: both appear in the list marked "mine" and place on the page.

6. **Legend.** Click **Legend**, click an empty spot. Pass: a box listing each tickmark
   used once, with its meaning.

7. **Stamp Summary.** In the Tools pane, Stamp Summary lists every item with page,
   author and time. Try both filters. Click an entry. Click **Export to CSV…**, save,
   open it in Excel. Pass: filter works, click selects that tickmark, CSV has one row
   per item.

8. **Save, reopen, Acrobat.** Ctrl+S, close the tab, open `text-1p.pdf` again.
   Pass: Stamp Summary shows the same count; you can move and delete a tickmark. Open
   the file in Acrobat: everything looks the same.

9. **Settings file.** Library > **Export my tickmarks…** to `C:\PDFTest\wp.json`. Remove
   `Traced` (×), then **Import…** `wp.json`. Then type `C:\PDFTest\wp.json` in Firm file
   and **Load**. Pass: Traced comes back; the firm count shows. For the share: put
   `wp.json` on `\\localhost\<share>` and Load from there (real network: deferred to
   Phase 10).

## Checklist

- [ ] 1 Acrobat firm set - [ ] 2 place/Esc/keys - [ ] 3 counting - [ ] 4 palette/recent
- [ ] 5 own tickmarks - [ ] 6 legend - [ ] 7 summary/CSV - [ ] 8 reopen + Acrobat
- [ ] 9 settings file

## If a step fails

Send the step number, what you clicked, what you saw (a screenshot helps), and for
step 8 the saved `text-1p.pdf` (synthetic, safe to send).
