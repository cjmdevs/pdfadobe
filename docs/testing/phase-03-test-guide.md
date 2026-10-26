# Test guide: Phase 3 (markup)

Quick overview check, about 30 minutes. Synthetic test files only, never client files.
You need Adobe Acrobat (or Reader) to compare results.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed:

```powershell
git pull origin main
npm ci
npm run fetch-win-binaries
npm run corpus -- --force
npx vitest run tests/unit/markup-roundtrip.test.ts
npm run tauri build
$g = "tests\corpus\generated"
Copy-Item -Force "$g\workpaper-a.pdf","$g\text-1p.pdf","$g\stamp-reviewed.png","tests\corpus\out\markup-all.pdf" C:\PDFTest\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`
(if Windows warns: **More info** > **Run anyway**). If any command prints `error`, stop
and send the last 30 lines.

## Steps

1. **Every type in Acrobat.** Open `C:\PDFTest\markup-all.pdf` in Acrobat.
   Pass: highlight, underline, strikethrough, squiggly, sticky note, text box, callout,
   rectangle, ellipse, line, arrow, polyline, triangle, cloud, scribble, image stamp and
   an APPROVED stamp all show. Click the sticky note: its text opens. Comments list shows
   a reply and status "Accepted".

2. **Draw everything.** In PDF Workbench open `C:\PDFTest\text-1p.pdf`, Tools pane >
   **Comment**. Use each toolbar button once: highlight/underline/strikethrough/squiggly
   (drag over text), sticky note (click), text box and callout (drag, type, Esc twice),
   rectangle/ellipse/line/arrow (drag), polyline/polygon/cloud (click corners,
   double-click to finish), Draw (scribble).
   Pass: each one appears.

3. **Style + eraser.** Click the rectangle; in the bar under the toolbar change color,
   width and Style "Cloudy". Click **Eraser** and drag across the scribble.
   Pass: rectangle changes; scribble is cut in two.

4. **Undo, lock, delete.** Ctrl+Z a few times, then Ctrl+Y. Select the ellipse, click the
   lock button, press Delete (nothing happens), unlock, Delete (gone).
   Pass: all as described.

5. **Stamps.** Tools pane > **Stamp** > **Approved**, click on the page. Then Comment
   toolbar > **Stamp** > **Add image…** > `C:\PDFTest\stamp-reviewed.png`, click it,
   click the page. Pass: green APPROVED stamp with your name + time, and the image.

6. **Save and compare.** Ctrl+S, open `text-1p.pdf` in Acrobat.
   Pass: everything from steps 2-5 is there and looks the same.

7. **Comments panel + author.** Gear button **Settings…**: hint shows your Windows name;
   type `J. Partner`, Enter, close. Open `workpaper-a.pdf`, Comment toolbar > **List**.
   Click the Rectangle entry (jumps to page 2). On the Sticky note: Reply `Agreed`, Status
   **Accepted**. Ctrl+S, check in Acrobat's Comments list.
   Pass: reply from J. Partner, status Accepted.

8. **Flatten, export/import, summary.** In `workpaper-a.pdf` click **Flatten** > all >
   **Flatten to new file**; click **Export** and save the `.xfdf`; click **Summary**.
   Then open `text-1p.pdf`, click **Import** and pick that `.xfdf`.
   Pass: `workpaper-a (flattened).pdf` opens (comments drawn in, not selectable in
   Acrobat); `workpaper-a (comment summary).pdf` opens with page pictures and numbered
   comments; the import message appears and the sticky note shows on page 1.

9. **Safety.** Add a comment, Ctrl+W: asked to save. Move a tab to a new window with an
   unsaved comment, then Ctrl+Q in the other window > Save and quit: message names the
   file and that window comes forward.

## Checklist

- [ ] 1 Acrobat types — [ ] 2 draw — [ ] 3 style/eraser — [ ] 4 undo/lock — [ ] 5 stamps
- [ ] 6 Acrobat matches — [ ] 7 panel/author — [ ] 8 flatten/XFDF/summary — [ ] 9 safety

## If a step fails

Send the step number, what happened, a screenshot (both apps if Acrobat looks
different), and the test file from `C:\PDFTest`.
