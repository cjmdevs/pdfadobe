# Test guide: B3 stage 2 fixes (re-check)

About 15 minutes. Synthetic files only. Same setup as `b3-stage2-test-guide.md` (pull,
`npm ci`, `npm run corpus:edit`, `npm run tauri build`, install, copy the files to
`C:\PDFTest`, firm font folder `C:\PDFTest\FirmFonts`).

## Steps

1. **Click and select in the editor.** Open `memo.pdf`, Edit PDF. Click once in the
   middle of a word in "We selected…". Pass: the cursor is right where you clicked
   (type a letter to see). Double-click another word, then drag across a few words.
   Pass: they get selected and the editor stays open.

2. **Real look while typing.** With the editor open. Pass: the text in the editor looks
   like the page (same font, size and line breaks, or very close); after Esc nothing
   jumps.

3. **Mixed formatting (old step 5).** Select one word > **B**, Size `14`, red. Select
   another > **Superscript**. Esc, click the paragraph again. Pass: only those words
   changed, and they still show changed.

4. **Lists and spacing (old step 6).** Click **Numbered list**: a menu opens; pick
   `a. b. c.`. Pass: the list letters show at once. Set Line spacing `1.5`, Paragraph
   spacing `6`, Char. spacing `100`; Esc; click the paragraph again. Pass: the panel
   shows 1.5, 6 and 100 (not the defaults).

5. **Arrow keys (old step 3).** Click a paragraph, Esc, then press Shift+→ several
   times, some quickly and some slowly. Pass: the box moves 10 points per press; the
   page never changes.

6. **Text that grows (old step 4).** Tick **When text grows, push the text below
   down**, add several long sentences to the bullet list. Pass: the lines wrap at the
   page's right margin (not off the side); when the text reaches the bottom of the page
   a red message says so and the text is kept.

7. **Join (your note).** Ctrl+click "We selected…" and "Two invoices…" > **Join into one
   paragraph**. Pass: nothing moves; it is one outline holding both paragraphs. Click
   it: both paragraphs are in the editor.

8. **Choose a program (old step 9).** Select an image > **Edit Using > Choose a
   program…**. Pass: Windows' "Open with" window stays open until you pick a program
   (no "Always use this app" box); the program opens the picture.

9. **Links (old step 10).** Add a web link with the Link tool, **Done**, Esc until the
   Edit toolbar closes. Click the link. Pass: "Open https://… in your web browser?"
   appears; **Open** opens your browser. A link set to a page jumps there. Links can't
   be dragged around.

## Checklist

- [ ] 1 click/select — [ ] 2 real look — [ ] 3 mixed formats — [ ] 4 lists/spacing
- [ ] 5 arrow keys — [ ] 6 growing text — [ ] 7 join — [ ] 8 Open with — [ ] 9 links

## If a step fails

Send the step number, what happened, a screenshot, and the saved file from
`C:\PDFTest`.
