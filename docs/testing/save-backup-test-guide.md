# Test guide: .bak clean-up and lower memory (2026-10-23)

Two quick checks after the change: Save now deletes the `.bak` once the saved file
checks out, and windows no longer keep an extra copy of each document in memory.

## Setup

Same as `b1-b4-test-guide.md` (Setup steps 1-3): `git pull origin main`, `npm ci`,
`npm run fetch-win-binaries`, `npm run corpus -- --force`, `npm run tauri build`,
install the new setup .exe, copy fresh test files. Delete old backups first:

```powershell
Remove-Item C:\PDFTest\*.bak -ErrorAction SilentlyContinue
```

## Steps

1. **No .bak left after Save.** Open `\\localhost\PDFTest\workpaper-a.pdf`, rotate a
   page, **Ctrl+S**. Pass: the message says "Saved workpaper-a.pdf."; in Explorer there
   is no `workpaper-a.pdf.bak` in `C:\PDFTest`; Acrobat shows the rotated page.
2. **Old leftovers go too.** In PowerShell make a fake leftover:
   `Copy-Item C:\PDFTest\workpaper-b.pdf C:\PDFTest\workpaper-b.pdf.bak`. Open
   `workpaper-b.pdf` in the app. Pass: `workpaper-b.pdf.bak` is gone.
3. **Ctrl+Q save.** Change files in two windows, **Ctrl+Q** > **Save all and quit**.
   Pass: both saved, no `.bak` files left.
4. **Still works with the memory change.** Open `long-500p.pdf`: Organize Pages,
   rotate a page, delete a page, Ctrl+Z, then Split by "Number of pages per file" `100`.
   Open `navigation.pdf`: the Bookmarks panel lists its bookmarks. Click **Combine
   Files**: navigation.pdf is already in the list. Pass: all work as before.

Pass/fail: 1 ☐ 2 ☐ 3 ☐ 4 ☐

If a step fails, send the step number, what you saw, and a screenshot (test files only).
If you ever see "was saved, but reading it back did not match", send that message's
exact text and keep the `.bak` file it names.
