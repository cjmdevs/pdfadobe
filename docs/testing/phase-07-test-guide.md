# Test guide: Phase 7 (Scan & OCR, Optimize, document tools, conversions)

About 30 minutes. Synthetic files only. The local share `\\localhost\PDFTest` stands
in for the network; the real network check is deferred to Phase 10.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed. The OCR build step
needs Visual Studio's C++ tools (already on the build PC) and takes about 10 minutes
the first time.

```powershell
git pull origin main
npm ci
npm run build-tesseract
npm run corpus -- --force
npm run tauri build
$g = "tests\corpus\generated"; $f = "tests\corpus\fixtures"
New-Item -ItemType Directory -Force C:\PDFTest\Batch | Out-Null
Copy-Item -Force "$g\scanned-image-only.pdf","$g\scanned-tilted.pdf","$g\scanned-sideways.pdf","$g\navigation.pdf","$g\text-1p.pdf","$g\workpaper-b.pdf","$f\photo-rgb.jpg","$f\scan-g4-3p.tif" C:\PDFTest\
Copy-Item -Force "$g\scanned-image-only.pdf","$g\scanned-tilted.pdf","$g\text-1p.pdf" C:\PDFTest\Batch\
Remove-Item C:\PDFTest\*_OCR*.pdf,C:\PDFTest\Batch\*_OCR*.pdf,C:\PDFTest\*_Bates*.pdf,C:\PDFTest\*_Optimized*.pdf,C:\PDFTest\*.png,C:\PDFTest\*.txt -ErrorAction SilentlyContinue
```

Pass: `npm run tauri build` ends with `PDF Workbench_0.1.0_x64-setup.exe`. Install
`src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`. If
`\\localhost\PDFTest` doesn't exist yet, run the share commands in
`phase-02-test-guide.md`, Setup step 3.

## Steps

1. **Recognize Text.** Open `C:\PDFTest\scanned-image-only.pdf`. In the Tools pane
   click **Scan & OCR**. Pass: the toolbar reads Insert ▾, Enhance ▾, Recognize Text ▾,
   Bates Numbering ▾ | Extract, Rotate left, Rotate right, Delete. In the panel on the
   right, leave **All pages** and click **Recognize Text**. Pass: a progress bar, then
   "Read 1 page.", and the page looks exactly the same. Press Ctrl+F, type
   `Engagement Memo`, press Enter. Pass: 1 match, highlighted on the scan's words. Drag
   across a line of the scan. Pass: the words highlight. **Save As**
   `C:\PDFTest\scan-ocr.pdf`. Open it in Acrobat, Ctrl+F `trial balance`. Pass: Acrobat
   finds it on the scan and the scan looks unchanged.

2. **Skip and cancel.** Back in our app, click **Recognize Text** again. Pass: "1 page
   already had text" and Undo is unchanged. Now Tools pane > **Create PDF** > **Add
   Images…**, pick `C:\PDFTest\scan-g4-3p.tif`, untick Recognize text, click **Create
   PDF from 1 image**. In the new tab open Scan & OCR, click **Recognize Text**, then
   **Cancel** while it runs. Pass: the message says it was cancelled and nothing changed.

3. **Enhance.** Open `scanned-tilted.pdf`. Click **Enhance ▾ > Straighten All Pages**.
   Pass: the text lines become level and the message says "Straightened 1 page". Open
   `scanned-sideways.pdf` and click **Enhance ▾ > Turn Pages Upright**. Pass: the page
   turns so the text reads normally. Ctrl+Z. Pass: it goes back.

4. **Folder of scans (and the share).** Click **Recognize Text ▾ > In Multiple Files (a
   folder)…**, then **Choose Folder…**, and type `\\localhost\PDFTest\Batch`. Pass: 3
   files are listed. Click **Recognize Text in 3 files**. Pass: "Finished: 2 saved, 1
   left alone, 0 failed" (text-1p already has text). In Explorer the Batch folder now
   has `scanned-image-only_OCR.pdf` and `scanned-tilted_OCR.pdf`, and the originals'
   dates haven't changed.

5. **Reduce File Size.** Open `scanned-image-only.pdf`, then Tools pane > **Optimize PDF**.
   Pick **Email** and click **Reduce File Size**. Pass: Before and After sizes with
   "% smaller". Click **Save as scanned-image-only_Optimized.pdf**. Pass: it opens in a
   new tab and looks the same, just a little softer. Open it in Acrobat. Pass: it opens
   with no error, and File > Properties shows the smaller size.

6. **Header & Footer.** Open `navigation.pdf`, then Tools pane > **Edit PDF**. Click the
   arrow on **Header & Footer ▾ > Add…**. Click in **Left header** and click **File
   Name**. Pass: the footer's right box already says `Page {page} of {pages}` and the
   preview reads "First page: Page 1 of 8". Click **Save Settings…**, name it `Firm
   footer`, then click **Apply**. Pass: every page shows the file name top-left and
   "Page N of 8" bottom-right, including the sideways page 6. Open **Header & Footer ▾ >
   Update…**, choose `Firm footer` under Saved settings, set Start page number to 101,
   and click **Apply**. Pass: pages read "Page 101 of 108", with no old numbers left.
   Save As `C:\PDFTest\nav-footer.pdf` and open it in Acrobat. Pass: the footer shows
   and prints. Back in our app, click **Header & Footer ▾ > Remove**. Pass: it's gone.

7. **Bates numbers on two files.** Still in Edit PDF on `navigation.pdf`, click **More ▾
   > Bates Numbering > Add…**. Type Prefix `MGR`, leave Digits 6, click **Add Files…**
   and pick `C:\PDFTest\workpaper-b.pdf`, then click **Apply**. Pass: the message reads
   "MGR000001 to MGR000011". `C:\PDFTest` now has `navigation_Bates.pdf` and
   `workpaper-b_Bates.pdf`. Open the second one. Pass: page 1 shows MGR000009 at the
   bottom right.

8. **Watermark and Background.** Open `text-1p.pdf` and go to Edit PDF. Click
   **Watermark ▾ > Add…**, keep DRAFT at 30% and 45°, In front of page, and **Apply**.
   Then **More ▾ > Background > Add…** and **Apply**. Pass: a faint red diagonal DRAFT
   over the text, and a cream page colour behind the text. Click **Watermark ▾ >
   Remove**. Pass: DRAFT goes and the background stays. Save As
   `C:\PDFTest\text-bg.pdf` and open it in Acrobat. Pass: the background shows.

9. **Export.** Open `navigation.pdf`, then Tools pane > **Export PDF**. Pick PNG and
   150 dpi, type `1-2` in Pages, and click **Export**. Pass: `navigation_Page_1.png` and
   `navigation_Page_2.png` are in C:\PDFTest and open in Photos. Export again with
   **Plain text (.txt)**. Pass: `navigation.txt` opens in Notepad with each page's text.

10. **Create PDF from images.** Tools pane > **Create PDF** > **Add Images…**, pick
    `photo-rgb.jpg` and `scan-g4-3p.tif` together. Leave **Recognize text** ticked and
    click **Create PDF from 2 images**. Pass: the status shows the pages being read,
    then a new tab `photo-rgb.pdf` opens with 4 pages (the photo, then 3 scan pages).

## Checklist

- [ ] 1 Recognize Text (Acrobat finds the text)
- [ ] 2 Skip and cancel
- [ ] 3 Straighten and Turn Upright
- [ ] 4 Folder of scans on `\\localhost`
- [ ] 5 Reduce File Size (opens in Acrobat)
- [ ] 6 Header & Footer, saved settings, update, remove (Acrobat)
- [ ] 7 Bates on two files
- [ ] 8 Watermark and Background (Acrobat)
- [ ] 9 Export PNG and text
- [ ] 10 Create PDF from images

## If a step fails

Send the step number, what you clicked last, what happened instead, and a screenshot.
For a setup failure, send the last 30 lines the command printed. For an Acrobat
difference, also send the saved file if it only holds the synthetic test content.
