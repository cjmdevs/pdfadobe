# Test guide: B8 UX fixes

About 30 minutes on the build PC. Nothing about saving or file formats changed except
that pages can now be pasted from one file into another. All test files are synthetic.

## Setup (PowerShell)

```powershell
cd "C:\Users\carso\Claude Projects\code\pdfadobe"
git pull
npm ci
npm run corpus
npm run tauri build
New-Item -ItemType Directory -Force C:\B8Test | Out-Null
Copy-Item tests\corpus\generated\workpaper-a.pdf, tests\corpus\generated\workpaper-b.pdf, tests\corpus\generated\ssn-redaction.pdf, tests\corpus\generated\text-1p.pdf C:\B8Test\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` and open
PDF Workbench. Keep Adobe Acrobat handy for step 3.

## Steps

1. **No placeholders.** Look at the Tools pane on the right. Pass: no tool says "Coming in
   Phase …" and the "Show tools that are coming later" box is gone.
2. **Pages panel mouse actions.** Open `C:\B8Test\workpaper-a.pdf`. In the Pages panel on
   the left, click page 1, then Shift+click page 3, then Ctrl+click page 2. Pass: pages 1
   and 3 are tinted (selected), page 2 isn't, and the page you're reading doesn't change.
   Double-click page 3. Pass: the view jumps to page 3. Press **Delete**. Pass: page 3 is
   gone; **Ctrl+Z** brings it back.
3. **Copy, cut, paste across files.** Click page 2 in the Pages panel and press **Ctrl+C**
   ("Copied 1 page." shows). Open `workpaper-b.pdf`, click its page 1 and press
   **Ctrl+V**. Pass: workpaper-b now has 4 pages and the copied page is page 2. Right-click
   a page: the menu has Cut, Copy, Paste before, Paste after, Insert, Delete, Extract,
   Replace, Rotate and Page properties. Pick **Cut** on the last page, then right-click
   page 1 and **Paste before**. Pass: that page is now first. Drag `workpaper-b` out of the
   window to make a second window, copy a page in one window and paste in the other. Pass:
   it pastes. **Save As** to `C:\B8Test\b-pasted.pdf` and open it in **Acrobat**: the pages
   are in the same order as in PDF Workbench.
4. **Page properties and Organize.** Right-click a page and choose **Page properties…**.
   Pass: it shows "8.50 in × 11.00 in (Letter)", Portrait, 0°. Open **Organize Pages** and
   right-click a page there. Pass: same menu, and Ctrl+C / Ctrl+V work in the grid too.
5. **Drag feedback.** In the Pages panel drag page 1 down below page 2. Pass: a
   see-through picture of the page follows the mouse, a green line shows where it will go,
   and it lands there. Open `ssn-redaction.pdf` > **Redact** > **Mark an area**, and drag
   a box starting just inside the left edge of the page. Pass: a dark label shows X, Y, W,
   H in inches while dragging, a thin line shows at the page edge, and the box starts
   exactly at the edge. Do it again holding **Alt**. Pass: no snapping. Open
   `text-1p.pdf` > **Comment** > **Rectangle**, draw one, then drag it near the left edge.
   Pass: the label shows X/Y and it snaps to the edge.
6. **Scrolling and panning.** Zoom to 300 % (Ctrl+= a few times). Pass: a horizontal
   scrollbar shows at the bottom of the page view all the time (not only on hover).
   **Shift+mouse wheel** scrolls sideways. Hold **Space** and drag the page. Pass: it pans
   with a hand cursor. Pick **View > Hand tool** and drag. Pass: it pans; picking a comment
   tool turns the Hand tool off.
7. **Previous / next view.** In a multi-page file type 5 in the page box and press Enter,
   then press **Alt+Left**. Pass: back on page 1. **Alt+Right**: page 5 again. Press the
   mouse's back and forward side buttons. Pass: same.
8. **Menus and Preferences.** Click **File**, **Edit**, **View**, **Window**, **Help** in
   the new menu bar. Pass: each item shows its shortcut on the right (Open Ctrl+O, Save As
   Ctrl+Shift+S, Preferences Ctrl+K…). Press **Alt** then **F**: File opens; arrow keys
   move; Esc closes. Press **Ctrl+K**. Pass: Preferences opens with General, Page Display,
   Commenting, Edit PDF, Fonts, PDFlyer, Security, Updates on the left. Change **Page
   Display > Units** to Millimetres and open Page properties again: 215.9 mm × 279.4 mm.
   **Help > About PDF Workbench** shows the version, Check for updates and notices.
9. **Search, help, tooltips.** Press **Alt+Q**, type `rotate`. Pass: Rotate left / right
   are listed; Enter runs the first. Type `units` and press Enter: Preferences opens at the
   Units row, outlined. Press **F1**. Pass: Help opens with one page per feature; type
   `redact` in its filter and read the page. Hover any top-bar button for a second. Pass: a
   dark tooltip shows its name and shortcut (for example Open, Ctrl+O).
10. **Customize the top bar.** **Window > Customize top bar…**. Click **Print** in the
    strip and set **Put it in** to **File menu**; set **Hand tool** (under "In a menu, or
    hidden") to **Top bar**; drag an item to a new place (a green line shows where). Save.
    Pass: Print is gone from the bar and listed at the end of the File menu, the Hand tool
    button is on the bar, the order matches. Make the window narrow. Pass: tools that don't
    fit move into a **…** button at the right whose menu runs them. Restart PDF Workbench:
    the layout is kept. **Window > Reset top bar** brings the default back.

UNC shares and the firm layout file on a real share are deferred to Phase 10.

## Checklist

- [ ] 1 No "Coming in Phase" anywhere
- [ ] 2 Pages panel: click / Ctrl / Shift select, double-click jumps, Delete + Ctrl+Z
- [ ] 3 Copy / cut / paste between files and windows; order right in Acrobat
- [ ] 4 Page properties; Organize has the same menu
- [ ] 5 Drag preview, insertion line, X/Y W/H label, snapping, Alt turns it off
- [ ] 6 Horizontal scrollbar always visible, Shift+wheel, Space and Hand tool pan
- [ ] 7 Alt+Left / Alt+Right and mouse side buttons
- [ ] 8 Menu bar with shortcuts, Alt keys, Preferences categories, About
- [ ] 9 Alt+Q search, F1 Help pages, tooltips with shortcuts
- [ ] 10 Customize top bar: move, menu, hide, overflow, kept after restart, reset

## If a step fails

Send back: the step number, what you clicked, what you expected and what you saw, a
screenshot, and the file you used. If the app crashed, also send the newest file from
**Help > Crash reports folder**.
