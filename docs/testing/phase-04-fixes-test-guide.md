# Test guide: Phase 4 fixes (letter tickmarks, sections, Clear Recent, Library)

About 10 minutes. Covers only what changed after your B and C results. Synthetic files
only.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed:

```powershell
git pull origin main
npm ci
npm run corpus -- --force
npm run tauri build
$g = "tests\corpus\generated"
Copy-Item -Force "$g\text-1p.pdf","$g\workpaper-a.pdf" C:\PDFTest\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`.

## Steps

1. **Sections.** Open `C:\PDFTest\workpaper-a.pdf`, Tools pane > **Workpaper Tools**.
   Pass: the toolbar has red-symbol buttons Letters, Numbers, Checks, Confirmations,
   Footing, Other (Mine shows once you add your own). Each arrow lists only that
   section; the button itself places the last one you used from it.

2. **A letter stays the same.** Arrow next to **Letters** > a grid of A-Z: pick **C**.
   Click the page 3 times, Esc. Pass: three circled C's (not C, D, E). The Numbers grid
   works the same (1-99). "Letters counting up" is still at the bottom of the grid.

3. **Matching letters link.** Put another C on page 2. Select a C (click it, or click
   its row in Stamp Summary). Pass: a **Go to the next C (page N)** button at the top
   jumps to the next C, and you can still drag a C around. Ctrl+S, open the file in
   Acrobat, click a C: Acrobat jumps to the next C, the last one back to the first.

4. **Clear Recent.** Place a tickmark, then click **Recent** > **Clear Recent Stamps**.
   Pass: a "Recent tickmarks cleared." message, placing stops (the next click on the page
   does nothing), and Recent is empty.

5. **Library.** Click **Library**. Pass: three tabs (Tickmarks, Sign-off stamps, Firm &
   files). On Tickmarks click **New tickmark…**: every field has a one-line explanation
   and the preview updates as you type. Make `Traced` (Symbol, Check, letters `T`,
   section Checks), **Add tickmark**. Pass: the message says where it is; it shows under
   **Checks** on the toolbar. On Sign-off stamps, **New stamp…** works the same way.

## Checklist

- [ ] 1 Section buttons
- [ ] 2 Letter stays the same
- [ ] 3 Matching letters jump (app and Acrobat)
- [ ] 4 Clear Recent
- [ ] 5 Library tabs and New forms

## If a step fails

Send the step number, what you clicked and what you saw (a screenshot helps). For step
4, say exactly what you expected Clear Recent to clear.
