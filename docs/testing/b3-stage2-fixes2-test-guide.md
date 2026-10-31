# Test guide: B3 stage 2 fixes, second re-check

About 10 minutes. Synthetic files only. Same setup as `b3-stage2-test-guide.md` (pull,
`npm ci`, `npm run corpus:edit`, `npm run tauri build`, install, copy the files to
`C:\PDFTest`).

## Steps

1. **Editor looks like the page.** Open `word-layouts.pdf`, Edit PDF. Click in the
   bullet list, then in "We have completed…", type a few letters in each. Pass: the
   text, bullets and first-line indent don't move when the editor opens or when you
   press Esc.

2. **Make a bullet list.** Click in "Please review…". Click **Bulleted list**: a menu
   opens fully (not cut off); pick `•`. Esc. Pass: the paragraph now starts with a
   bullet. Then open `memo.pdf`, click at the end of the last bullet, press Enter, type
   "Third item". Esc. Pass: three bullets, evenly spaced.

3. **Click a box's edge.** Click a paragraph, Esc (blue frame with squares). Click one
   of the small squares without dragging. Pass: the editor opens.

4. **Line spacing.** Select "We have completed…" (click, Esc), set Line spacing `2`,
   Enter. Pass: lines spread out; if they now reach the paragraph below, the box turns
   red and a message says so (that's on purpose). Click it again. Pass: the editor
   shows the same spacing as the page.

5. **Arrow keys (still open).** Click a paragraph, Esc, press → a few times, then
   Shift+→. Tell me: does plain → move it? Is the box blue (selected) before you press?
   Does any message appear?

6. **Visible link.** With the Link tool add a link, click it, tick **Visible
   rectangle**, Save. Pass: a border shows around it in this app; in Acrobat too.

## Checklist

- [ ] 1 editor look — [ ] 2 lists — [ ] 3 edge click — [ ] 4 line spacing
- [ ] 5 arrow keys (answers) — [ ] 6 visible link

## If a step fails

Send the step number, what happened, a screenshot, and the saved file from
`C:\PDFTest`.
