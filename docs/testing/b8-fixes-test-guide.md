# Test guide: B8 fixes (round 2)

About 10 minutes. Retests what you sent back, then finish the B8 guide from step 6.

## Setup (PowerShell)

```powershell
cd "C:\Users\carso\Claude Projects\code\pdfadobe"
git pull
npm ci
npm run tauri build
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` over the
old one and open `C:\B8Test\workpaper-a.pdf`.

## Steps

1. **One click goes to the page.** Click page 3 in the Pages panel on the left. Pass: the
   view jumps to page 3 straight away, and only page 3 has a green outline (no green fill
   anywhere). Ctrl+click page 1. Pass: you stay on page 3 and pages 1 and 3 are outlined.
2. **One mark in Organize.** Open **Organize Pages** and click page 1, then page 2, then
   page 3. Pass: only the page you clicked last has the green outline; no page is filled
   and no other page keeps an outline.
3. **Leaving a tool stops it.** Click **Comment** > **Rectangle**, then close the Comment
   toolbar with its **X** (or open another tool). Zoom in (Ctrl+=) and click and drag on
   the page. Pass: no rectangle is drawn.
4. **Menu bar stays on screen.** Make the window narrow, press **Alt+Q**, type something,
   press Esc, and click around. Pass: **File Edit View Window Help** are always fully
   visible at the top left. Now do B8 step 8 (menus and Preferences).
5. **Hand tool.** Click **View** in the menu bar (top left), then **Hand tool**. Drag the
   page. Pass: it pans. (Holding **Space** and dragging does the same without the menu.)
6. **Search points, it doesn't do.** Press **Alt+Q**, type `rotate right`, press Enter.
   Pass: the Rotate right button pulses with a green outline; nothing is rotated. Type
   `zoom in` and press Enter. Pass: the View menu opens at Zoom with **Zoom in**
   highlighted; the zoom doesn't change until you click it.
7. **Help fits.** Press **F1**. Pass: the whole Help window shows with no scrollbar along
   the bottom. Same for **Ctrl+K** (Preferences).

Then carry on with steps 9 and 10 of `docs/testing/b8-test-guide.md`.

## Checklist

- [ ] 1 One click goes to the page; one outline, no fill
- [ ] 2 Organize: only the clicked page is marked
- [ ] 3 Closing the Comment toolbar stops Rectangle
- [ ] 4 Menu bar always fully visible
- [ ] 5 View > Hand tool pans
- [ ] 6 Alt+Q highlights the button or menu item instead of running it
- [ ] 7 Help and Preferences fit without a bottom scrollbar

## If a step fails

Send the step number, what you clicked, what you saw, and a screenshot.
