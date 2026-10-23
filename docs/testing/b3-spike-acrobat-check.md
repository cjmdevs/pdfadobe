# Acrobat check: B3 Edit PDF spike (2026-10-23)

This checks that text our spike edited looks right in Adobe Acrobat, can be selected and
searched, and can be edited again with Acrobat's own Edit PDF. There's no app to install.
The spike makes test PDFs, and you open them in Acrobat. All files are synthetic.

## Setup (build PC, PowerShell)

Do this on the build PC. It needs Node 22 or newer, which is already installed there.

```powershell
cd "C:\Users\carso\Claude Projects\code\pdfadobe"
git pull origin main
npm ci
npm run corpus:edit
npm run spike:edit
```

`npm run spike:edit` prints one line per case. Pass: every line says `PASS` or `PASS*`
(`PASS*` = it worked but ran into text below; that's expected for some files). The
last line is `results: ...results.json`.

The files are in `tests\corpus\out\edit\`. Acrobat isn't installed on the build PC, so
copy that whole folder to a PC that has Acrobat, for example
`C:\PDFTest\edit\` (a USB stick is fine). The `local` subfolder holds Windows-font
subsets, so it's fine to copy inside the firm but don't post it anywhere.

## Steps

Do steps 1 to 4 for each of these files:

| #   | File                                        | What changed                                               |
| --- | ------------------------------------------- | ---------------------------------------------------------- |
| a   | `committed\engagement-letter.A-present.pdf` | 1st paragraph: "federal, state and local", justified       |
| b   | `local\engagement-letter.C-windows.pdf`     | 1st paragraph in Times New Roman, "quarter (Q4)"           |
| c   | `local\memo.B-proposed.pdf`                 | 1st body paragraph in Carlito, "(Journal ref. 2025-Q1-07)" |
| d   | `committed\memo.B-completed.pdf`            | same edit, in Liberation Sans from the firm folder         |
| e   | `committed\pbc-list.D-firm.pdf`             | row 2 "Item requested" cell in Noto Sans, "(Q4 only)"      |

1. **Looks right.** Open the file. Compare it with the matching picture in
   `docs\edit-spike\` (or with the same file name ending `.png` in the same folder).
   Pass: same words and line breaks, no boxes, gaps or overlapping letters.
2. **Search.** Press **Ctrl+F** and search for the new words (for example `Q4`, `local`,
   `Journal`). Pass: Acrobat finds and highlights them in the edited paragraph.
3. **Select and copy.** Drag across the edited paragraph, **Ctrl+C**, paste into
   Notepad. Pass: the pasted text reads correctly, with spaces between words.
4. **Fonts and editing.** Go to **File > Properties > Fonts**. Pass: the new font (for
   example `XXXXXX+Calibri`) says **Embedded Subset**. File a has no new font (it reuses
   the original `LiberationSans-…` font): pass if that font says Embedded or Embedded
   Subset. Close it. Then open **All tools >
   Edit a PDF** and click the edited paragraph. Pass: one box around the whole
   paragraph, and you can type a word. **Write down exactly what Acrobat says** if it
   warns about the font, and which font name shows in the font box.

Then three short checks:

5. **Grows into the text below (known).** Open `committed\two-column.B-completed.pdf`.
   Pass for this spike: the last line of the right-hand top paragraph overlaps the
   paragraph below, the same as `docs\edit-spike\14-two-column-B-overlaps-below.png`.
   Then in **Edit a PDF**, type extra words into the _original_ file
   `tests\corpus\edit\two-column.pdf` (same paragraph). Write down whether Acrobat
   pushes the paragraph below down or lets it overlap.
6. **Stacked lines.** Open `tests\corpus\edit\irs-header.pdf` in **Edit a PDF**.
   Write down whether "Department of the Treasury" and "Internal Revenue Service" are
   one box or two.
7. **Images.** Open `committed\images.added.pdf`. Pass: a red/white rotated rectangle
   (bottom right) and a green-yellow "Synthetic photo" (bottom left), as in
   `docs\edit-spike\15-images.png`. In **Edit a PDF** click each one: it's selectable
   as an image.

## Checklist

| File / step | 1 Looks | 2 Search | 3 Copy | 4 Fonts + edit |
| ----------- | ------- | -------- | ------ | -------------- |
| a           | ☐       | ☐        | ☐      | ☐              |
| b           | ☐       | ☐        | ☐      | ☐              |
| c           | ☐       | ☐        | ☐      | ☐              |
| d           | ☐       | ☐        | ☐      | ☐              |
| e           | ☐       | ☐        | ☐      | ☐              |

5 ☐ (and: pushes down / overlaps) 6 ☐ (one box / two) 7 ☐

## What to send back

- the checklist with ticks
- your notes for 4 (any font warning, word for word), 5 and 6
- for any fail: the file name, step number, what you saw, and a screenshot

If `npm run spike:edit` itself fails, send the last 20 lines it printed.
