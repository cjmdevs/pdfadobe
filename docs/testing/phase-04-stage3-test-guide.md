# Test guide: Phase 4 stage 3 (calculator tape, foot/cross-foot)

Quick overview check, about 20 minutes. Synthetic test files only, never client files.
You need Adobe Acrobat (or Reader) to compare results.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed:

```powershell
git pull origin main
npm ci
npm run fetch-win-binaries
npm run corpus -- --force
npx vitest run tests/unit/flyer-stage3.test.ts
npm run tauri build
New-Item -ItemType Directory -Force C:\PDFTest | Out-Null
$g = "tests\corpus\generated"
Copy-Item -Force "$g\footing.pdf","$g\scanned-image-only.pdf","tests\corpus\out\tape-sample.pdf" C:\PDFTest\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`
(if Windows warns: **More info** > **Run anyway**). If any command prints `error`, stop
and send the last 30 lines.

`footing.pdf` is a small schedule: Q1, Q2 and Total columns, a Total row, and a
"Q1 per general ledger" line that is 0.50 off the Q1 total on purpose.

## Steps

1. **Tape in Acrobat.** Open `C:\PDFTest\tape-sample.pdf` in Acrobat.
   Pass: a small pale-yellow tape with 1,234.50 +, 100.00 -, and a ruled 1,134.50 T.
   Click it: the comment text lists the same lines.

2. **10-key.** In PDF Workbench open `C:\PDFTest\footing.pdf`, Tools pane > **Workpaper
   Tools** > **Calculator**. Type `10+5.25+` on the keyboard (number pad works too), then
   `t`. Pass: display 15.25; the tape shows 10.00 +, 5.25 +, 15.25 T.

3. **Standard and settings.** Switch the type to **Standard**, type `12+3*2=`.
   Pass: 30.00. Open **Settings**: Decimals 0 shows 30; turn on Add mode, switch back
   to 10-key, type `1234+`: Pass: 12.34. Turn Add mode off, Decimals back to 2.

4. **Click amounts.** Click **Click amounts on page**. Hover the Q1 amounts: each lights
   up. Click 1,250.00 and 4,100.50, then Shift+click 2,000.00. Esc.
   Pass: the tape shows + 1,250.00, + 4,100.50, - 2,000.00.

5. **Foot with a variance.** Click **Foot / cross-foot**. Drag a box around the four Q1
   amounts (not the Total), then click the 7,850.00 on the "per general ledger" line.
   Pass: "Foot of 4: 7,850.50", in red "variance -0.50"; the amounts are shaded blue and
   the total green. Click **Mark total**: a red UD tickmark appears beside 7,850.00.

6. **Foot that agrees, cross-foot.** Clear, Foot again around the Q2 amounts, click
   849.75 in the Total row: Pass "agrees" in green; **Mark total** puts a footed caret.
   Then Foot around the Cash row's Q1 and Q2 (drag sideways), click 1,550.00: Pass
   "Cross-foot of 2 ... agrees"; Mark total puts a cross-footed mark.

7. **Tape on the page.** **Add to tape**, then **Place tape on page**, click an empty
   spot. Pass: the tape appears; Stamp Summary lists "Calculator tape". Place a tickmark
   on the tape and draw a connector from the tape to an amount: both work.

8. **Edit a tape.** Click the tape on the page, click **Open this tape in the
   calculator**, type `100+`, click **Update tape**. Pass: the tape on the page now ends
   with 100.00 +, in the same spot; the connector still points at it.

9. **Tape color.** Settings > Tape color: pick light blue, place another tape.
   Pass: the new tape is light blue.

10. **Save, reopen, Acrobat.** Ctrl+S, close, open `footing.pdf` again: everything is
    still there and the tape still opens in the calculator. Open it in Acrobat: tapes,
    tickmarks and connectors look the same.

11. **Scanned page.** Open `C:\PDFTest\scanned-image-only.pdf`, Foot / cross-foot, drag
    over the text. Pass: a message says there are no amounts (scans need OCR first).

12. **Settings file.** Library > **Export my tickmarks, stamps and calculator…** to
    `C:\PDFTest\wp.json`, change the tape color, **Import…** `wp.json`.
    Pass: the tape color is back to what was exported.

## Checklist

- [ ] 1 Tape in Acrobat
- [ ] 2 10-key from the keyboard
- [ ] 3 Standard, decimals, add mode
- [ ] 4 Click amounts (Shift subtracts)
- [ ] 5 Foot with variance, Mark total
- [ ] 6 Agrees and cross-foot
- [ ] 7 Tape on page, tickmark and connector on it
- [ ] 8 Edit a tape
- [ ] 9 Tape color
- [ ] 10 Reopen and Acrobat
- [ ] 11 Scanned page message
- [ ] 12 Settings file

## If a step fails

Send the step number, what you clicked, what you saw (a screenshot helps), and for
step 10 the saved `footing.pdf` (synthetic, safe to send).
