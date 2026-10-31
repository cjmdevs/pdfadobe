# Test guide: Phase 7 re-check (Tesseract in the installed app)

About 10 minutes. Re-runs the steps that failed: 1, 2, 3 (second part), 4, 10, and a
clearer look at 8.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed.

```powershell
git pull origin main
npm ci
npm run tauri build
Remove-Item C:\PDFTest\*_OCR*.pdf,C:\PDFTest\Batch\*_OCR*.pdf -ErrorAction SilentlyContinue
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` over
the old one. The test files from the first run are still in `C:\PDFTest`.

## Steps

1. **Recognize Text.** Open `C:\PDFTest\scanned-image-only.pdf`, then Tools pane > **Scan
   & OCR**, and click **Recognize Text**. Pass: "Read 1 page." Ctrl+F `Engagement Memo`
   finds 1 match. Save As `C:\PDFTest\scan-ocr.pdf`, open it in Acrobat, and Ctrl+F
   `trial balance`. Pass: found.
2. **Skip and cancel.** Click **Recognize Text** again. Pass: "1 page already had text".
   Tools pane > **Create PDF** > **Add Images…**, pick `scan-g4-3p.tif`, untick Recognize
   text, and click Create. In the new tab click **Recognize Text**, then **Cancel**.
   Pass: "cancelled. Nothing was changed."
3. **Turn Upright.** Open `scanned-sideways.pdf` and click **Enhance ▾ > Turn Pages
   Upright**. Pass: the page turns so the text reads normally.
4. **Folder.** **Recognize Text ▾ > In Multiple Files (a folder)…** > **Choose Folder…**,
   type `\\localhost\PDFTest\Batch`, then **Recognize Text in 3 files**. Pass: "Finished:
   2 saved, 1 left alone, 0 failed".
5. **Create PDF with OCR.** Tools pane > **Create PDF**, add `photo-rgb.jpg` and
   `scan-g4-3p.tif`, leave **Recognize text** ticked, and click Create. Pass: a 4-page
   `photo-rgb.pdf` tab opens.
6. **Background.** Open `text-1p.pdf`, then Edit PDF > **More ▾ > Background > Add…** >
   **Apply**. Pass: the whole page turns pale yellow behind the text. Ctrl+Z puts it
   back to white.

## If a step fails

Send the step number and the exact message. Messages now say why Tesseract stopped
(for example "Failed loading language 'eng'"), so copy that text in full.
