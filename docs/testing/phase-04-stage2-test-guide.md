# Test guide: Phase 4 stage 2 (connectors, sign-off stamps, notes)

Quick overview check, about 20 minutes. Synthetic test files only, never client files.
You need Adobe Acrobat (or Reader) to compare results.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed:

```powershell
git pull origin main
npm ci
npm run fetch-win-binaries
npm run corpus -- --force
npx vitest run tests/unit/flyer-stage2.test.ts
npm run tauri build
New-Item -ItemType Directory -Force C:\PDFTest | Out-Null
$g = "tests\corpus\generated"
Copy-Item -Force "$g\text-1p.pdf","$g\workpaper-a.pdf","tests\corpus\out\workpaper-stage2.pdf" C:\PDFTest\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`
(if Windows warns: **More info** > **Run anyway**). If any command prints `error`, stop
and send the last 30 lines.

## Steps

1. **Sample in Acrobat.** Open `C:\PDFTest\workpaper-stage2.pdf` in Acrobat.
   Pass: two red carets joined by a red arrow, a blue PREPARED BY stamp (name, date,
   W/P ref A-1), a TP initials stamp and a yellow note all show.

2. **Connector between tickmarks.** In PDF Workbench open `C:\PDFTest\text-1p.pdf`, Tools
   pane > **Workpaper Tools**. Place two tickmarks far apart, Esc. Click the arrow next
   to **Connector** > **Dashed arrow**. Click the first tickmark, then the second, Esc.
   Pass: a dashed red arrow from one to the other.

3. **It stays attached.** Click one of the tickmarks and drag it somewhere else.
   Pass: the arrow follows. Click the arrow and change its color in the bar under the
   toolbar. Pass: color changes.

4. **Connector between two points.** Connector button, click two empty spots, Esc.
   Pass: an arrow between the spots (not attached to anything).

5. **Sign-off stamps.** Click **Library**, type your initials in "My initials". Close.
   Arrow next to **Sign-off** > **Prepared by**, type `A-1`, **Place**, click the page,
   Esc. Then **Initials**, click the page twice, Esc.
   Pass: PREPARED BY with your name, initials, date, time and "W/P ref: A-1"; two
   initials stamps with today's date.

6. **Your own stamp.** Library > New sign-off stamp: Title `Partner review`, Extra fields
   `Client no.`, **Add stamp**. Close, Sign-off arrow > Partner review, fill both boxes,
   Place, click the page. Pass: the stamp shows the reference and Client no.

7. **Notes.** Click **Note**, drag a box, type `Agreed to bank confirmation`, Esc twice.
   In the Tools pane click the **Notes** tab. Pass: the note is listed with your name and
   the time; clicking it selects the note.

8. **Stamp Summary.** Back on the **Stamp Summary** tab: tickmarks, connectors and both
   stamp types are listed; filter by type "Connector". **Export to CSV…** and open it.
   Pass: filter works; CSV type column says Connector / Status stamp / User stamp.

9. **Across pages.** Open `C:\PDFTest\workpaper-a.pdf`. Connector button, click on page 1,
   scroll to page 2, click there, Esc. Pass: a small "p. 2" box on page 1 and "p. 1" on
   page 2. Select one: a **Go to the other end** button jumps to the other.

10. **Save, reopen, Acrobat.** Ctrl+S on both files, close them, open again.
    Pass: everything is still there, Stamp Summary and Notes show the same counts, you
    can still move a tickmark and its connector follows. Open both in Acrobat: all items
    look the same; in `workpaper-a.pdf` clicking "p. 2" goes to page 2.

11. **Settings file.** Library > **Export my tickmarks and stamps…** to
    `C:\PDFTest\wp.json`. Remove `Partner review`, **Import…** `wp.json`.
    Pass: Partner review comes back.

## Checklist

- [ ] 1 Sample in Acrobat
- [ ] 2 Connector between tickmarks
- [ ] 3 Stays attached, restyle
- [ ] 4 Connector between points
- [ ] 5 Prepared by and Initials
- [ ] 6 Own stamp with fields
- [ ] 7 Notes panel
- [ ] 8 Stamp Summary and CSV
- [ ] 9 Across pages and jump
- [ ] 10 Reopen and Acrobat
- [ ] 11 Settings file

## If a step fails

Send the step number, what you clicked, what you saw (a screenshot helps), and for
step 10 the saved PDF (synthetic, safe to send).
