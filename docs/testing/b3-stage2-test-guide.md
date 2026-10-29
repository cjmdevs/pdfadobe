# Test guide: B3 Edit PDF, stage 2

Quick overview check, about 35 minutes. Synthetic test files only, never client files.
You need Adobe Acrobat for step 11 (on another PC is fine) and Paint for step 9.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed:

```powershell
git pull origin main
npm ci
npm run fetch-win-binaries
npm run corpus:edit
npm run tauri build
New-Item -ItemType Directory -Force C:\PDFTest\FirmFonts | Out-Null
$e = "tests\corpus\edit"
Copy-Item -Force "$e\memo.pdf","$e\real-format\word-layouts.pdf","$e\real-format\k1-supplemental.pdf","tests\corpus\fixtures\photo-rgb.jpg" C:\PDFTest\
Copy-Item -Force "node_modules\pdfjs-dist\standard_fonts\LiberationSans-*.ttf" C:\PDFTest\FirmFonts\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`. In the
app: gear > **Settings…** > Firm font folder `C:\PDFTest\FirmFonts`. If any command
prints `error`, stop and send the last 30 lines.

## Steps

1. **Paragraphs open whole.** Open `word-layouts.pdf`, Tools > **Edit PDF**. Pass: one
   outline each around: the indented paragraph, the double-spaced paragraph, the bullet
   list, the numbered list, the centred title block, the right-aligned date block, the
   "Note A." paragraph, the paragraph with the small raised "1". Untick **Show bounding
   boxes** (panel bottom): only the box under the mouse is outlined; tick it again.

2. **Join and Split.** Open `memo.pdf`, Edit PDF. Ctrl+click "We selected…" and
   "Two invoices…" > **Join into one paragraph**. Pass: one box; Ctrl+Z gives two again.
   Click into "We selected…", put the caret before "For each invoice", click **Split at
   caret**. Pass: two boxes. Ctrl+S, close, reopen, Edit PDF: still two boxes.

3. **Move and resize.** Drag a paragraph somewhere else (a plain click still opens the
   editor). Press Esc, then Shift+→ twice. Drag the box's left side handle right: the
   text re-wraps. Drag the bottom handle up: **Auto-fit height** goes off and a red
   "taller than the box" note appears; tick Auto-fit again. Type `1` in **X**, Enter.
   Pass: each is one Ctrl+Z, and the text looks unchanged apart from where it is.

4. **Push down.** Click "Two invoices…", tick **When text grows, push the text below
   down**, add a long sentence at the end, Esc. Pass: the bullet list moves down, no red
   outline. Untick it again.

5. **Mixed formatting.** Click "We selected…", select the word `invoices`, click **B**,
   set Size `14`, a red Colour. Select `2025`-style digits or any word and click
   **Superscript**. Press Ctrl+I on another selected word. Pass: only those words change
   while typing. Esc, click the paragraph again: they are still bold / big / red / raised.

6. **Lists, indents, spacing.** In a paragraph: **Numbered list** (pick `a.` in its
   dropdown), **Increase indent**, Line spacing `1.5`, Paragraph spacing `6`, Char.
   spacing `100`, Scaling `90`; open **More**: Right indent `40`, Kerning on (pick the
   **Times** font first). Pass: each shows in the editor or on the page after Esc; a
   selected box (editor closed) changes at once, one Ctrl+Z each; the panel shows the
   values again when you reselect.

7. **Run-in heads.** Open `k1-supplemental.pdf`, click "Box 1 - Ordinary…", add a word at
   the end, Esc. Pass: "Box 1 - Ordinary business income (loss)." stays bold, the rest
   regular.

8. **Images: Objects panel.** In `memo.pdf`: **Add Image** > `photo-rgb.jpg`, click the
   page. Try **Flip horizontal**, **Flip vertical**, **Rotate left**, **Arrange > Send to
   back** (text now over it), **Crop** (drag a side handle in, **Apply crop**), **W**
   field `2` (height follows: Lock aspect ratio). Ctrl+click a text box too > **Align >
   Align left**. Pass: each does what it says, one Ctrl+Z each; Esc cancels a crop.

9. **Edit Using.** Select the image > **Edit Using > Paint**. Draw a line in Paint,
   Ctrl+S (keep PNG), back to PDF Workbench. Pass: within about 2 seconds the picture
   shows the line (one Ctrl+Z). Click **Stop**; `%TEMP%\PDF Workbench` has no image file
   left. Try **Choose a program…**: Windows' "Open with" dialog appears.

10. **Toolbar: Link, Crop Pages.** Click **Link**, drag a rectangle over a line of text,
    type `example.com`, **Add link**. Click the link: switch to **Go to a page** 1, tick
    **Visible rectangle**, **Save link**; then **Remove link**. Type
    `javascript:alert(1)`: a red refusal. **Crop Pages** opens the crop dialog. Pass:
    no Header & Footer or Watermark buttons yet (they come with Phase 7).

11. **Acrobat check.** Ctrl+S the files from steps 2-10, open them in Acrobat. Pass:
    pages look the same as in PDF Workbench (bold/red/raised words, lists with their
    numbers, spacing, cropped/flipped image); **Ctrl+F** finds edited words; copy +
    paste into Notepad gives readable text with spaces; a link you added opens
    example.com / goes to page 1; **File > Properties > Fonts** lists new fonts as
    Embedded Subset; **All tools > Edit a PDF**: an edited paragraph is one box. Write
    down any Acrobat warning word for word.

## Checklist

- [ ] 1 paragraphs — [ ] 2 join/split — [ ] 3 move/resize — [ ] 4 push down
- [ ] 5 mixed formats — [ ] 6 lists/spacing — [ ] 7 run-in heads — [ ] 8 objects
- [ ] 9 Edit Using — [ ] 10 link/crop pages — [ ] 11 Acrobat

Deferred to Phase 10: the firm font folder on the real network share.

## If a step fails

Send the step number, what happened, a screenshot (both apps if Acrobat looks
different), the saved file from `C:\PDFTest`, and any Acrobat message word for word.
