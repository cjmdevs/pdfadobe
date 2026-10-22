# Phase 2 test guide: page organization

For the person testing on the build PC. You do not need to know how the app is built.
Use only the synthetic test files named here: never client files.

Not covered yet: **Organize Pages in a Tools pane (backlog B4)** is waiting on a
question to the owner. Real office-network checks are **deferred to Phase 10**; here a
local share (`\\localhost\PDFTest`) stands in for the network.

## A. Setup (about 15 minutes, once)

You need what Phase 1 installed: Node.js 22, Rust, Visual Studio Build Tools, Git, and
Adobe Acrobat (or Reader) for checking results.

1. Open **PowerShell** (normal, not admin) in the `pdfadobe` folder and run:

   ```powershell
   git pull origin main
   npm ci
   npm run fetch-win-binaries
   npm run corpus -- --force
   npm run tauri build
   ```

   Pass: the last line mentions `PDF Workbench_0.1.0_x64-setup.exe`. If any command
   prints `error`, stop and send the last 30 lines.

2. Install: double-click
   `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`. Windows may
   say "Windows protected your PC": click **More info**, then **Run anyway**. It installs
   over the old version; no uninstall needed.

3. Make the local share (stands in for the office network). Open **PowerShell as
   Administrator** (right-click PowerShell > Run as administrator) and run:

   ```powershell
   New-Item -ItemType Directory -Force C:\PDFTest | Out-Null
   New-SmbShare -Name PDFTest -Path C:\PDFTest -FullAccess $env:USERNAME
   ```

   If it says the share already exists, that is fine.

4. Copy the test files (normal PowerShell, in the `pdfadobe` folder):

   ```powershell
   $g = "tests\corpus\generated"; $f = "tests\corpus\fixtures"
   Copy-Item "$g\workpaper-a.pdf","$g\workpaper-b.pdf","$g\workpaper-c.pdf","$g\navigation.pdf","$g\long-200p.pdf","$g\long-500p.pdf","$g\signed-fake.pdf" C:\PDFTest\
   Copy-Item "$f\scan-g4-3p.tif","$f\photo-rgb.jpg" C:\PDFTest\
   New-Item -ItemType Directory -Force C:\PDFTest\Folder | Out-Null
   Copy-Item "$g\workpaper-a.pdf","$g\workpaper-b.pdf","$g\workpaper-c.pdf","$f\scan-g4-3p.tif" C:\PDFTest\Folder\
   ```

   In the app always open files as `\\localhost\PDFTest\...` (type it in the Open
   dialog's file name box). Before a step that changes a file, copy a fresh one again
   with the same commands if an earlier step changed it.

**What the test files contain** (all fake):

- `workpaper-a/b/c.pdf`: 3 pages each, heading "Workpaper A - page 1 of 3". Page 1 has
  a "client name" box (A: "Sample Client A") and a yellow sticky note; page 2 a
  checkbox and a red square; page 3 three round buttons. Bookmarks: "A Cover" (with
  "A Detail" inside it) and "A Summary".
- `navigation.pdf`: 8 pages of different sizes. Bookmarks: Cover; Part I - Sizes
  (Legal page, A4 page > Landscape page); Part II - Schedules (Schedule B).
- `long-200p.pdf` / `long-500p.pdf`: "Page N of 200/500" on every page.
- `scan-g4-3p.tif`: a 3-page black-and-white "scanner" file. `photo-rgb.jpg`: a photo.
- `signed-fake.pdf`: looks digitally signed (fake signature).

**Useful to know:** the **Organize pages** button is the 4-squares icon in the top
toolbar. Hover over any icon to see its name. A dot `•` after a tab's name means
unsaved changes. While the app works, a small bar at the top says what it is doing.

## B. Tests

### Organize view

1. **Open Organize.** Open `\\localhost\PDFTest\workpaper-a.pdf`, click **Organize
   pages**. Pass: a grid of 3 page pictures with numbers 1-3, and a row of buttons with
   words under them (Rotate left, Rotate right, Delete, Extract, Duplicate, Blank page,
   Insert, Replace, Crop, Page size, Split). Click **Close Organize**: you are back to
   normal reading.
2. **Select pages.** In Organize: click page 1 (blue border). Hold **Shift** and click
   page 3: all 3 selected, top-left says "3 of 3 selected". Hold **Ctrl** and click page
   2: it is unselected ("2 of 3 selected"). Click in the grid and press **Ctrl+A**: all
   selected. Press **Esc**: none selected.
3. **Drag to reorder.** Press and hold on page 3, drag it to the left half of page 1,
   release. Pass: a blue bar shows where it will land; after release the order is 3, 1,
   2 (read the headings) and the tab shows `•`.
4. **Rotate.** Select page 2, click **Rotate right**. Pass: only page 2 turns.
   **Rotate left** turns it back. Then, outside Organize, go to page 2 and click the
   rotate icon in the top toolbar (its tooltip says "Rotate page 2 right"): only page 2
   turns. **Ctrl+Shift+Plus** turns the whole view (all pages, not saved) and
   **Ctrl+Shift+Minus** turns it back.
5. **Delete.** Select page 1, press **Delete**. Pass: 2 pages left. Press **Ctrl+Z**: 3
   again.
6. **Duplicate.** Select page 2, click **Duplicate**. Pass: 4 pages, the copy is right
   after page 2.
7. **Extract.** Select page 1, click **Extract**. Pass: a new tab
   "workpaper-a (pages 1).pdf" with 1 page and `•`. Press **Ctrl+S**, save it in
   `C:\PDFTest` as `extract-test.pdf`. Open it in Acrobat: 1 page, client name box shows
   "Sample Client A".
8. **Blank page.** Back on workpaper-a, Organize, click **Blank page**, choose
   Location "First", Number of pages 2, **Insert**. Pass: 2 empty pages at the start.
9. **Insert from a PDF.** Select page 1, click **Insert**, **Choose file…**, pick
   `workpaper-b.pdf`. Pages to insert: `1`. Location: After page 1. **Insert**. Pass: B's
   page 1 appears after page 1.
10. **Insert scanner images.** Click **Insert**, choose `scan-g4-3p.tif`. Pass: it says
    "(3 pages)". Location "Last", **Insert**: 3 scan pages at the end, black text on
    white (not a negative). Repeat with `photo-rgb.jpg` (1 page).
11. **Replace.** Select page 2, click **Replace**, choose `workpaper-c.pdf`, "With
    pages" `2`, **Replace**. Pass: page 2 now shows "Workpaper C - page 2 of 3".
12. **Crop.** Select page 1, click **Crop**. Pass: "Apply to" already shows "This page
    (1)". Top `1`, Left `0.5`, click **Crop**: page 1 loses 1 inch at the top and half
    an inch at the left.
13. **Page size.** With page 1 still selected, click **Page size**, choose Legal,
    **Apply**. Pass: page 1 is taller, and the part you cropped in step 12 stays hidden.
14. **Undo / redo.** Press **Ctrl+Z** several times: each change goes back one at a
    time (a message says "Undid: ..."). **Ctrl+Y** redoes. Hover the curved-arrow
    buttons: they name the step.
15. **Save and check in Acrobat.** Press **Ctrl+S**. Pass: the `•` goes away and
    `workpaper-a.pdf.bak` appears in `C:\PDFTest` (open the folder in Explorer). Open
    `\\localhost\PDFTest\workpaper-a.pdf` in **Acrobat**: everything from steps 3-14 is
    there (rotations, crop, Legal page, inserted pages, sticky note still visible).
    Close it in Acrobat, close and reopen it in PDF Workbench: the `.bak` is gone.
16. **Save while Acrobat has the file open.** Open workpaper-a in Acrobat AND PDF
    Workbench. In Workbench rotate a page, press Ctrl+S. Pass: a message says the file is
    open in another program; nothing changes on disk; no new `.bak`. Close Acrobat,
    Ctrl+S again: it saves.
17. **Save As.** Press **Ctrl+Shift+S**, save as `C:\PDFTest\saveas-test.pdf`. Pass:
    the tab's name changes; the original file is not changed.
18. **Unsaved changes.** Make a change, press **Ctrl+W**. Pass: "Unsaved changes"
    box. **Cancel** keeps the tab; Ctrl+W again and **Don't save** closes it.
19. **Signed document.** Open `signed-fake.pdf`, click the toolbar rotate button. Pass:
    "Digitally signed document" warning. **Cancel**: nothing changes. Again and **Change
    anyway**: the page rotates; no more warnings for this file.
20. **Speed.** Open `\\localhost\PDFTest\long-500p.pdf`, Organize, drag page 10 before
    page 1. Write down roughly how many seconds until the grid updates. Pass: under 10
    seconds. (Real network speed: deferred to Phase 10.)

### Combine Files

21. **Combine with a folder.** Close all tabs (Ctrl+Shift+W). Click **Combine Files…**
    (overlapping squares icon). Click **Add folder…**, pick `C:\PDFTest\Folder`. Pass:
    4 rows (scan-g4-3p.tif, workpaper-a, -b, -c).
22. **Reorder and ranges.** Drag the scan row (hold on its name) to the bottom; or use
    the ↑ ↓ buttons. In workpaper-c's "Page range" type `1, 3`. Keep "Add a bookmark for
    each file" ticked. Pass: bottom right says "11 pages". Click **Combine**: a new tab
    "Combined.pdf".
23. **Check in Acrobat.** Ctrl+S, save as `C:\PDFTest\combined-test.pdf`, open it in
    Acrobat. Pass: 11 pages in order A1-A3, B1-B3, C1, C3, then 3 scan pages; Bookmarks
    panel shows workpaper-a, -b, -c, scan-g4-3p, each with its own bookmarks inside;
    yellow sticky notes on pages 1, 4, 7; the client name boxes show A, B and C, and
    typing in one does not change the others.
24. **Combine from an open file.** Open workpaper-b, click **Combine Files…**. Pass:
    workpaper-b is already in the list. Add workpaper-c with **Add files…**, Combine:
    6 pages. workpaper-b's own tab is unchanged.
25. **Same tax form twice (optional; owner said low priority).** In Acrobat fill
    `tests\corpus\irs\fw9.pdf` with name "Test Person A", save as `C:\PDFTest\w9-A.pdf`;
    again with "Test Person B" as `w9-B.pdf`. Combine both and save. In Acrobat: page 1
    says A, page 7 says B, editing one does not change the other. In free Adobe Reader:
    no "extended features" warning.

### Split

26. **By bookmarks.** Open `\\localhost\PDFTest\navigation.pdf`, Organize, **Split**,
    choose "Top-level bookmarks", **Split**. Pass: a list of 3 new files
    (navigation - Cover, - Part I - Sizes, - Part II - Schedules) in `C:\PDFTest`.
    Run it again: new files get " (2)"; nothing is overwritten.
27. **By page count / ranges / size.** Open long-200p, Split by "Number of pages per
    file" `80`: 3 files (80, 80, 40 pages). Split by ranges `1-10; 50-60`: 2 files.
    Then open long-500p (about 0.9 MB) and Split by "Maximum file size" `0.3` MB:
    at least 3 files, each under 300 KB in Explorer (Size column).
    Open one of each in Acrobat: page headings are the right ones.

### Bookmarks

Open `navigation.pdf`, click **Bookmarks** in the left pane.

28. **Move pages by dragging a bookmark.** Hold on "Part II - Schedules" and drag it
    onto the TOP EDGE of "Part I - Sizes" (a blue line appears above it), release.
    Pass: Part II is now second, and its 2 pages ("Schedule A/B") moved to pages 2-3;
    "Schedule B" moved with it.
29. **Nest only (pages stay).** Untick "Dragging a bookmark moves its pages". Drag
    "Cover" onto the MIDDLE of "Part II - Schedules" (box outline): Cover goes inside
    Part II; the page order does not change.
30. **Delete with pages.** Click "Part I - Sizes", click the toolbar icon "Delete
    bookmark and its pages…". Pass: the box says how many pages (5); **Delete** removes
    the bookmark and those pages. Ctrl+Z restores them.
31. **Extract a bookmark's pages.** Click "Part II - Schedules", click "Extract
    bookmark's pages to new file". Pass: a new tab with 2 pages and its bookmarks.
32. **Add, rename, set destination.** Go to page 5, click "New bookmark…" (bookmark +
    icon): "Untitled" appears. Select some text on the page with the mouse, then New
    bookmark again: it is named after that text. Click a bookmark, press **F2**, type a
    new name, Enter. Go to page 3, click the bookmark, click "Set destination to current
    view": clicking the bookmark now goes to page 3.
33. **Delete, expand/collapse, bookmark every page.** Select a bookmark, press
    **Delete**: only the bookmark goes (pages stay). Use the ⋯ menu: **Collapse all**,
    **Expand all**, **Bookmark every page** (confirm): 8 bookmarks "Page 1".."Page 8".
34. **Save and check in Acrobat.** Ctrl+Shift+S as `C:\PDFTest\bookmarks-test.pdf`,
    open in Acrobat: bookmarks match what you see in Workbench and clicking each goes to
    the right page.

## C. Checklist

| #     | Test                                        | Pass / Fail |
| ----- | ------------------------------------------- | ----------- |
| 1-2   | Organize opens, selection                   |             |
| 3     | Drag pages                                  |             |
| 4     | Rotate (page and view)                      |             |
| 5-8   | Delete, duplicate, extract, blank           |             |
| 9-11  | Insert PDF, images, replace                 |             |
| 12-13 | Crop, page size                             |             |
| 14    | Undo / redo                                 |             |
| 15-18 | Save, .bak, locked, Save As, unsaved prompt |             |
| 19    | Signed warning                              |             |
| 20    | Speed (seconds: \_\_\_)                     |             |
| 21-24 | Combine Files                               |             |
| 25    | W-9 twice (optional)                        |             |
| 26-27 | Split                                       |             |
| 28-34 | Bookmarks                                   |             |

## D. If a step fails, send back

1. The step number.
2. What you clicked, and what you saw instead of the "Pass" text (exact message text).
3. A screenshot (Win+Shift+S) of the app, and of Acrobat if the problem shows there.
4. If a file looks wrong, the file itself from `C:\PDFTest` (test files only).
5. If the app froze or closed: what you did just before.
