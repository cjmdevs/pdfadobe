# Test guide: Phase 2 main checks + new workspace (B4) + multiple windows (B1)

Short list. About 30 minutes after setup. Use only the synthetic test files below,
never client files. Real office-network checks are deferred to Phase 10; the local
share `\\localhost\PDFTest` stands in for the network.

## Setup (once, about 15 minutes)

You need what Phase 1 installed (Node.js 22, Rust, Visual Studio Build Tools, Git) and
Adobe Acrobat or Reader for checking results. Close PDF Workbench first.

1. **PowerShell** (normal) in the `pdfadobe` folder:

   ```powershell
   git pull origin main
   npm ci
   npm run fetch-win-binaries
   npm run corpus -- --force
   npm run tauri build
   ```

   Pass: the end mentions `PDF Workbench_0.1.0_x64-setup.exe`. If a command prints
   `error`, stop and send the last 30 lines.

2. Install: double-click
   `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` (if Windows
   says "protected your PC": **More info** > **Run anyway**).

3. Fresh test files (normal PowerShell, `pdfadobe` folder). If `\\localhost\PDFTest`
   does not exist yet, first run the share commands in `phase-02-test-guide.md`, Setup
   step 3.

   ```powershell
   $g = "tests\corpus\generated"; $f = "tests\corpus\fixtures"
   Copy-Item -Force "$g\workpaper-a.pdf","$g\workpaper-b.pdf","$g\workpaper-c.pdf","$g\navigation.pdf","$g\long-500p.pdf" C:\PDFTest\
   New-Item -ItemType Directory -Force C:\PDFTest\Folder | Out-Null
   Copy-Item -Force "$g\workpaper-a.pdf","$g\workpaper-b.pdf","$g\workpaper-c.pdf","$f\scan-g4-3p.tif" C:\PDFTest\Folder\
   Remove-Item C:\PDFTest\*.bak -ErrorAction SilentlyContinue
   ```

Open files with **Ctrl+O** and type the path, e.g. `\\localhost\PDFTest\workpaper-a.pdf`.

## A. Phase 2 main checks

1. **Organize + save.** Open `workpaper-a.pdf`. In the **Tools** pane on the right click
   **Organize Pages**. A toolbar appears above the pages (Insert, Extract, Replace,
   Split, rotate, Delete...). Drag page 3 in front of page 1. Click page 1, Shift+click
   page 2, click **Rotate right** twice. Click page 3, **Delete**. Press **Ctrl+Z**:
   page 3 comes back. Press **Ctrl+S**.
   Pass: the tab's dot (•) disappears; `C:\PDFTest\workpaper-a.pdf.bak` exists. Open
   the file in Acrobat: 3 pages in the order page 3, page 1, page 2; the first two are
   upside down.
2. **Save while Acrobat has it open.** Keep it open in Acrobat. In the app rotate any
   page, Ctrl+S. Pass: message says the file is open in another program; nothing else
   breaks. Close Acrobat, Ctrl+S again: saves.
3. **Combine.** Close all tabs (**Ctrl+Shift+W**). Tools pane > **Combine Files** >
   **Add folder…** > pick `C:\PDFTest\Folder` > **Combine**, then **Ctrl+S** and save as
   `C:\PDFTest\combined.pdf`. Pass in Acrobat: 12 pages; Bookmarks show workpaper-a,
   -b, -c and scan-g4-3p; yellow sticky notes on pages 1, 4, 7.
4. **Split.** Open `navigation.pdf`, Organize Pages > **Split**, choose "Top-level
   bookmarks", **Split**. Pass: 3 new files in `C:\PDFTest` (navigation - Cover, - Part
   I - Sizes, - Part II - Schedules). Run it again: new files get " (2)"; nothing is
   overwritten.

## B. New workspace (B4)

5. **Layout.** One row at the top (Open, Save, Print, Find, Undo/Redo, page box, zoom,
   pinned tools; Customize and Tools-pane buttons at the right). Left: icon rail
   (Pages, Bookmarks, Attachments) that opens a panel with a title and an X. Right:
   Tools pane. Type `org` in **Search tools**: only Organize Pages stays.
   Pass: all of that is there and no Adobe logos or names are used.
6. **Quick toolbar.** Click **Customize quick toolbar…**: remove one tool, add
   **Extract to new file**, drag it to the front, **Save**. Close and reopen the app.
   Pass: your toolbar is still there.
7. **Firm default.** In the same dialog type `\\localhost\PDFTest\firm-layout.json` as
   the firm layout file, click **Save this toolbar as the firm default**, then **Use firm
   default**, **Save**. Pass: `C:\PDFTest\firm-layout.json` exists and the toolbar
   matches it after reopening the app.
8. **Coming tools.** At the bottom of the Tools pane tick **Show tools that are coming
   later**. Pass: extra tools appear greyed with "Coming in a later phase" and do
   nothing when clicked.
9. **Bookmarks panel.** Open `navigation.pdf`, open **Bookmarks** in the left rail. Use
   the panel toolbar: **New bookmark**, rename it, drag it onto another bookmark.
   Pass: it nests; Ctrl+S; Acrobat shows the same bookmarks.

## C. Multiple windows (B1)

10. **Drag a tab out.** Open `workpaper-a.pdf` and `workpaper-b.pdf`. Rotate a page in
    workpaper-a (do not save; the tab shows •). Drag the **workpaper-a tab** off the
    window onto the desktop and let go.
    Pass: a new window opens there with workpaper-a, still showing •, and **Ctrl+Z**
    undoes the rotation in the new window.
11. **Between windows.** Drag the workpaper-a tab from the new window back onto the first
    window and let go. Pass: it joins the first window's tabs; the empty window closes.
12. **Menu.** Right-click a tab > **Move to New Window**. Pass: same as step 10.
13. **Snap.** Drag a window to the left screen edge, the other to the right (or Win+Left /
    Win+Right). Pass: they snap side by side; each keeps its own zoom and panels.
14. **Same file twice.** With workpaper-a in the second window, click the first window
    and open `\\localhost\PDFTest\workpaper-a.pdf` again (Ctrl+O, or double-click it in
    Explorer). Pass: no second copy; the window that has it comes to the front.
15. **Quit prompt.** Make an unsaved change in a file in each window, then press
    **Ctrl+Q**. Pass: one prompt listing both files. Click **Cancel** (nothing closes),
    Ctrl+Q again, **Save all and quit**: both files saved (each has a `.bak`), app exits.
16. **Close one window.** Open 2 windows, change a file in one, click its X. Pass: asks
    only about that window's file; the other window stays open.
17. **Memory (optional).** Open `long-500p.pdf`, `combined.pdf` and `navigation.pdf` in
    each of 2 windows (test files only, never client files). In Task Manager, expand PDF
    Workbench and note the memory of each "WebView2" entry. Send the numbers.

## Checklist

| #                 | Pass | Fail | #                     | Pass | Fail |
| ----------------- | ---- | ---- | --------------------- | ---- | ---- |
| 1 Organize + save | ☐    | ☐    | 10 Drag tab out       | ☐    | ☐    |
| 2 Locked save     | ☐    | ☐    | 11 Between windows    | ☐    | ☐    |
| 3 Combine         | ☐    | ☐    | 12 Move to New Window | ☐    | ☐    |
| 4 Split           | ☐    | ☐    | 13 Snap               | ☐    | ☐    |
| 5 Layout          | ☐    | ☐    | 14 Same file twice    | ☐    | ☐    |
| 6 Quick toolbar   | ☐    | ☐    | 15 Quit prompt        | ☐    | ☐    |
| 7 Firm default    | ☐    | ☐    | 16 Close one window   | ☐    | ☐    |
| 8 Coming tools    | ☐    | ☐    | 17 Memory (optional)  | —    | —    |
| 9 Bookmarks panel | ☐    | ☐    |                       |      |      |

## If a step fails, send back

- The step number and what you saw (one sentence is fine).
- A screenshot of the app (and of Acrobat for steps 1, 3, 9). Use only the test files,
  so no client data is in the picture.
- For an error message: its exact text.
- If the app closed by itself: what you did just before, step by step.
