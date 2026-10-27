# Test guide: B3 Edit PDF, stage 1

Quick overview check, about 35 minutes. Synthetic test files only, never client files.
You need Adobe Acrobat for step 10 (on another PC is fine).

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
Copy-Item -Force "$e\memo.pdf","$e\real-format\form-9999.pdf","$e\real-format\statement-courier.pdf","$e\real-format\transmittal-letter.pdf","tests\corpus\fixtures\photo-rgb.jpg" C:\PDFTest\
Copy-Item -Force "node_modules\pdfjs-dist\standard_fonts\LiberationSans-*.ttf" C:\PDFTest\FirmFonts\
```

Then, in a PowerShell **run as administrator**, share the font folder (this stands in
for the firm's share; the real network share is checked in Phase 10):

```powershell
New-SmbShare -Name FirmFonts -Path C:\PDFTest\FirmFonts -ReadAccess Everyone
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`
(if Windows warns: **More info** > **Run anyway**). If any command prints `error`, stop
and send the last 30 lines.

## Steps

1. **Outlines.** Open `C:\PDFTest\memo.pdf`, Tools pane > **Edit PDF**.
   Pass: thin grey outlines around 6 text boxes; hovering turns one blue; the panel on
   the right says "Click text to edit it".

2. **Edit in place, undo.** Click the paragraph starting "Two invoices". Type
   ` Reviewed with the controller.` at the end, press **Esc**. Then Ctrl+Z, then Ctrl+Y.
   Pass: while typing the text is in a similar font over the box; after Esc the page
   shows the new sentence with the same line spacing, and the box stays selected;
   Ctrl+Z brings back the old text, Ctrl+Y the new one.

3. **Refused letters.** Click "MEMORANDUM", type `Ł` at the end, press Esc.
   Pass: a red message names `Ł`; the heading is unchanged.

4. **Format panel.** Click the "We selected" paragraph, press Esc (it stays selected).
   Open the **Font** list. Pass: groups "In this document", "Standard PDF fonts (not
   embedded)", "Windows" (and "Firm" after step 9). Then pick **Arial**, set Size `12`,
   pick a red Colour, click **U** and **C** (centre), set Line spacing `18`.
   Pass: each change redraws the paragraph (one Ctrl+Z each); Arial shows a note if it
   replaces the document's font. Pick a font that lacks letters you typed (or a
   symbol font such as Wingdings): a red warning and no change.

5. **Tax-software files.** Open `statement-courier.pdf`, Edit PDF, click "SECOND
   SAMPLE CREDIT UNION", add ` FCU`, Esc. Pass: the amounts `812.` and `422.` on the
   same rows are still there and unchanged. Open `form-9999.pdf`, click "Taxable
   interest", add ` and tax-exempt interest`, Esc. Pass: the label grows to the right,
   its outline turns red, and the panel says it runs into the dot leaders; nothing is
   pushed down.

6. **Box width.** With that label (or any paragraph) selected, drag the small handle in
   the middle of its right edge to the left. Pass: a dashed outline follows; on release
   the text wraps to the new width (one Ctrl+Z undoes it).

7. **Add Text.** Open `transmittal-letter.pdf`, Edit PDF, click **Add Text**, in the panel
   pick **Times**, size 11. Click in the empty area at the bottom, type `Prepared by AB`,
   Esc. Click **Add Text** again and drag a box about 5 cm wide, type two sentences, Esc.
   Pass: first text on one line, second wraps at the dragged width; both stay selectable.

8. **Images.** Click **Add Image**, pick `C:\PDFTest\photo-rgb.jpg`, click on the page.
   Drag the picture to move it; drag a corner to resize (proportions kept; Shift: free);
   drag the round handle to rotate (Shift: 15° steps); panel **Rotate left**; panel
   **Replace image…** with the same JPEG; press **Delete**; Ctrl+Z.
   Pass: each action works and is one undo step; after Ctrl+Z the image is back.

9. **Firm fonts, offline.** Gear button > **Settings…** > Firm font folder
   `\\localhost\FirmFonts`, Enter, close. Select a paragraph: the Font list has
   **Firm > Liberation Sans**; pick it and click **B**. Pass: bold Liberation Sans, no
   "simulated" note. Then (admin PowerShell) `Remove-SmbShare -Name FirmFonts -Force`,
   restart PDF Workbench, open a file, Edit PDF, select text. Pass: Liberation Sans is
   still under Firm, and the panel says the firm folder is offline (local copy used).

10. **Acrobat check.** Ctrl+S each file from steps 2-8, open them in Acrobat.
    Pass, for each edited paragraph: it looks the same as in PDF Workbench; **Ctrl+F**
    finds the new words; drag-select + copy + paste into Notepad gives readable text
    with spaces; **File > Properties > Fonts** lists new fonts as **Embedded Subset**
    (e.g. `ABCDEF+ArialMT`), and Times-Roman as not embedded; **All tools > Edit a
    PDF**: the edited paragraph is one box you can type in, and the picture is
    selectable as an image. Write down any font warning Acrobat shows, word for word.

11. **Safety.** Click a paragraph, type something, press **Ctrl+S** without leaving it.
    Pass: the saved file has the typed text (check in Acrobat). Make another edit and
    press Ctrl+W: asked to save.

## Checklist

- [ ] 1 outlines — [ ] 2 edit/undo — [ ] 3 refused — [ ] 4 format panel
- [ ] 5 tax files — [ ] 6 box width — [ ] 7 Add Text — [ ] 8 images
- [ ] 9 firm fonts offline — [ ] 10 Acrobat — [ ] 11 safety

Deferred to Phase 10: firm font folder on the real firm network share.

## If a step fails

Send the step number, what happened, a screenshot (both apps if Acrobat looks
different), the saved file from `C:\PDFTest`, and any Acrobat font message word for word.
