# Test guide: Phase 3 (markup)

About 60 minutes after setup. Use only the synthetic test files below, never client
files. Real office-network checks are deferred to Phase 10; `\\localhost\PDFTest`
stands in for the network share.

You need Adobe Acrobat (or Acrobat Reader) to check results: every comment must look
the same there as in PDF Workbench.

## Setup (once, about 15 minutes)

You need what Phase 1 installed (Node.js 22, Rust, Visual Studio Build Tools, Git).
Close PDF Workbench first.

1. **PowerShell** (normal) in the `pdfadobe` folder:

   ```powershell
   git pull origin main
   npm ci
   npm run fetch-win-binaries
   npm run corpus -- --force
   npx vitest run tests/unit/markup-roundtrip.test.ts
   npm run tauri build
   ```

   Pass: the vitest line ends `70 passed`; the build ends mentioning
   `PDF Workbench_0.1.0_x64-setup.exe`. If a command prints `error`, stop and send the
   last 30 lines.

2. Install: double-click
   `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` (if Windows
   says "protected your PC": **More info** > **Run anyway**).

3. Fresh test files. If `\\localhost\PDFTest` does not exist yet, first run the share
   commands in `phase-02-test-guide.md`, Setup step 3.

   ```powershell
   $g = "tests\corpus\generated"; $o = "tests\corpus\out"
   Copy-Item -Force "$g\workpaper-a.pdf","$g\workpaper-b.pdf","$g\text-1p.pdf","$g\stamp-reviewed.png","$o\markup-all.pdf" C:\PDFTest\
   Remove-Item C:\PDFTest\*.bak, C:\PDFTest\*flattened*, C:\PDFTest\*summary*, C:\PDFTest\*.xfdf -ErrorAction SilentlyContinue
   ```

Open files with **Ctrl+O** and type the path, e.g. `\\localhost\PDFTest\text-1p.pdf`.
The **Comment** tool is in the Tools pane on the right; clicking it shows its toolbar
above the page. Clicking a tool button turns it on (button looks pressed); clicking it
again, or **Esc**, turns it off.

## A. Every markup type in Acrobat (made by the test suite)

1. Open `C:\PDFTest\markup-all.pdf` in **Acrobat** (not in PDF Workbench).
   Pass: you see, on one page: yellow highlight, green underline, red strikethrough,
   blue squiggly line, a yellow sticky-note icon, a text box with red text on a pale
   yellow fill, a callout (box with a blue leader line ending in an arrow), a red
   rectangle, a blue-outlined ellipse with pale blue fill, a black line, a dark red
   arrow, a purple zig-zag polyline, a green triangle, a red **cloud** (scalloped
   edge), a blue scribble, an image stamp and a green **APPROVED** stamp with
   "Test Reviewer, 10/23/2026 9:00 AM" under it.
2. In Acrobat open the Comments list. Pass: each item shows author **Test Reviewer**;
   the sticky note shows a reply "Agreed, ticked." from Second Reviewer and status
   **Accepted**.
3. Click the sticky note icon in Acrobat. Pass: its note window opens and shows
   "Sticky note: tie to TB" (we do not write `/Popup` objects; Acrobat must open the note
   anyway).
4. Send a screenshot of the page in Acrobat with your result, pass or fail.

## B. Draw, style, undo (PDF Workbench)

1. Open `text-1p.pdf`. Tools pane > **Comment**.
2. **Highlight**: click **Highlight**, drag across the heading "Sample Engagement Memo".
   Pass: yellow highlight; the bar under the toolbar shows **Highlight** with Color and
   Opacity.
3. **Underline**, **Strikethrough**, **Squiggly**: same, each on a different line of text.
4. **Text box**: click **Text box**, drag a box in empty space, type `Agrees to TB`,
   press **Esc** twice. Pass: the text stays; the tool turns off. Click the box: the bar
   shows Text color, Font, Size, Fill color, Border color, Border width. Change Font to
   Times, Size 14, Fill yellow. Pass: the box changes.
5. **Callout**: click **Callout**, click near some text, type `See A-1`, Esc twice.
   Pass: a box with a leader line and arrow.
6. **Sticky note**: click **Sticky note**, click on the page. Pass: a note icon.
7. **Rectangle**, **Ellipse**, **Line**, **Arrow**: drag each. **Polyline** and
   **Polygon**: click the corners, double-click the last one. **Cloud**: same as
   Polygon. Pass: each appears; the cloud has a scalloped edge.
8. Select the rectangle (click its edge). In the bar set Line color blue, Width 4 pt,
   Style **Cloudy**. Pass: the rectangle gets a blue cloud edge.
9. **Draw**: click **Draw**, draw a squiggle. Then click **Eraser** and drag across the
   middle of the squiggle. Pass: the squiggle is cut in two where you dragged.
10. **Undo/redo**: press **Ctrl+Z** five times, then **Ctrl+Y** five times. Pass: the
    last five changes go away one at a time and come back. The Undo button tooltip says
    "Undo Markup".
11. **Lock**: select the ellipse, click the lock button at the right of the bar
    (tooltip "Lock"). Try to drag it and press **Delete**. Pass: it does not move and
    is not deleted. Click the lock again (Unlock), press **Delete**: it is deleted.
12. **Make default**: click **Rectangle** (tool on, nothing selected); set Width 1 pt and
    Line color green; click the star button **Make default**. Close the app, start it
    again, open any file, Comment > Rectangle, draw. Pass: thin green rectangle.
13. **Save**: **Ctrl+S**. Pass: the tab's dot (•) goes away. Open `text-1p.pdf` in
    Acrobat. Pass: every item from steps 2-11 is there and looks the same as in the app.

## C. Stamps

1. Open `workpaper-a.pdf`. Tools pane > **Stamp**. Click **Approved**. Move the pointer
   over the page. Pass: a dashed outline follows it. Click. Pass: a green APPROVED stamp
   with your Windows name and today's date/time under it.
2. Comment toolbar > **Stamp** > **Add image (PNG or JPEG)…** > pick
   `C:\PDFTest\stamp-reviewed.png`. Pass: it appears under "My stamps". Click it, then
   press **Esc**. Pass: nothing is placed. Open the dialog again, click it, click the page.
   Pass: the image stamp is placed.
3. Close and restart the app; Stamp dialog. Pass: `stamp-reviewed` is still in My stamps.
4. **Ctrl+S**; open in Acrobat. Pass: both stamps show; Acrobat's Comments list says
   "Approved" for the first.

## D. Comments panel, replies, status, author

1. Click the gear button **Settings…** (top right). Pass: "Author name for comments" is
   empty and the grey hint shows your Windows name. Type `J. Partner`, press Enter, close.
2. Open `workpaper-b.pdf`, Comment toolbar > **List** (Comments list). Pass: a panel on the
   right with 2 comments (Sticky note, p. 1; Rectangle, p. 2), each with author and date.
3. Click the Rectangle entry. Pass: the view jumps to page 2 and the rectangle is selected.
4. Click the Sticky note entry; edit its text in the box, click elsewhere. Click **Reply**,
   type `Agreed`, **Post reply**. Set Status to **Accepted**; tick **Marked**.
   Pass: the reply shows under the note, signed **J. Partner**.
5. Filters: set Type = Rectangle. Pass: only the rectangle is listed. Set back to All.
6. **Ctrl+S**; open in Acrobat's Comments list. Pass: the note has the reply from
   J. Partner and status Accepted. Note whether Acrobat shows the Marked check mark.
7. Settings: clear the author name, Enter, close. Draw a rectangle. Pass: the List shows
   it with your Windows name.

## E. Flatten, XFDF, summary

1. With `workpaper-b.pdf` open: Comment toolbar > **Flatten** > "All comments in the
   document" > **Flatten to new file**. Pass: a new tab `workpaper-b (flattened).pdf`
   opens; `C:\PDFTest\workpaper-b (flattened).pdf` exists; `workpaper-b.pdf` is unchanged.
   In Acrobat: the comments look the same but are part of the page (no Comments list
   entries; they cannot be selected); the form fields still work.
2. Select one comment, Flatten > "Selected comments (1)". Pass: in the new file only that
   one is flattened; the others are still comments.
3. **Export**: in `workpaper-b.pdf` click **Export**, save `C:\PDFTest\workpaper-b.xfdf`.
   Open `workpaper-a.pdf`, click **Import**, pick that file. Pass: a message says how many
   were imported; the comments appear; **Ctrl+Z** removes them again (one per press).
4. In Acrobat: open `workpaper-a.pdf` (fresh copy from Setup step 3) > Comments >
   Import Comments… > `workpaper-b.xfdf`. Pass: Acrobat imports them without an error and
   they look the same as in step 3.
5. **Summary**: in `workpaper-b.pdf` click **Summary**. Pass: a new tab
   `workpaper-b (comment summary).pdf` opens: per page a small picture of the page with
   numbered red dots and the numbered comments below (type, author, date, status, text,
   replies). **Ctrl+P** prints it.

## F. Safety

1. Comment on `workpaper-a.pdf`, don't save, press **Ctrl+W**. Pass: asked to save.
2. Comment on a file, then right-click its tab > **Move to New Window**. Pass: the comment
   comes along; Ctrl+Z in the new window removes it.
3. Comment on a file in the second window, go to the first window, **Ctrl+Q**, **Save and
   quit**. Pass: a message says the file has unsaved comments and the second window comes
   to the front; nothing is lost.
4. Open `\\localhost\PDFTest\text-1p.pdf`, add a comment, **Ctrl+S**. Pass: saves; no
   `.bak` is left.

## Checklist

- [ ] A1 every type correct in Acrobat — [ ] A2 authors/reply/status — [ ] A3 note opens
- [ ] B2-B9 tools work — [ ] B10 undo/redo — [ ] B11 lock — [ ] B12 make default — [ ] B13 Acrobat
- [ ] C1 built-in stamp — [ ] C2 image stamp — [ ] C3 kept after restart — [ ] C4 Acrobat
- [ ] D1-D5 panel — [ ] D6 Acrobat — [ ] D7 Windows name
- [ ] E1-E2 flatten — [ ] E3 XFDF round trip — [ ] E4 Acrobat imports XFDF — [ ] E5 summary
- [ ] F1-F4 safety

## If a step fails

Send: the step number, what you expected, what happened, a screenshot (of both apps for
Acrobat differences), and the saved test file from `C:\PDFTest` (synthetic, safe to
share). For a crash or error message, also send the text of the message.
