# Test guide: B8 follow-up (your three findings)

About 5 minutes on the build PC. Nothing about saving or file formats changed, so there's
no Acrobat check. All test files are synthetic.

## Setup (PowerShell)

```powershell
cd "C:\Users\carso\Claude Projects\code\pdfadobe"
git pull
npm ci
npm run corpus
npm run tauri build
New-Item -ItemType Directory -Force C:\B8Test | Out-Null
Copy-Item tests\corpus\generated\navigation.pdf, tests\corpus\edit\memo.pdf, tests\corpus\fixtures\photo-rgb.jpg C:\B8Test\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` over the
old one and open `C:\B8Test\navigation.pdf`.

## Steps

1. **Single page view scrolls.** On the top bar set **Page display** to **Single page**.
   Press **Ctrl+=** five times. Turn the mouse wheel down. Pass: the page scrolls, it has
   scrollbars, and it never covers the Pages panel on the left or the tools list on the
   right.
2. **The wheel turns pages.** Keep turning the wheel down past the bottom of the page.
   Pass: page 2 comes up, starting at its top. Wheel back up past the top. Pass: page 1
   comes back, at its bottom. Press **Ctrl+0** (the whole page fits). Pass: every notch
   of the wheel is one page.
3. **Narrow window.** Set **Page display** back to **Continuous**. Click **Comment** in
   the tools list so the Comments panel opens. Drag the right edge of the window in as far
   as it goes. Pass: the panels get narrower, the page area in the middle is still there,
   and the page never draws over a panel. Make the window wide again. Pass: the panels are
   back to full width. Close Comment with its **X**.
4. **Text shows while you drag it.** Open `C:\B8Test\memo.pdf`. Click **Edit PDF**. Press
   on the paragraph that starts "We selected sales", hold, and drag it down and right.
   Pass: the paragraph's words move with the mouse, the old spot goes pale, and when you
   let go the text lands exactly where the moving copy was. Press **Ctrl+Z**.
5. **Images too.** Click **Add image**, pick `C:\B8Test\photo-rgb.jpg`, click on the page to
   place it. Drag the picture somewhere else. Pass: the picture itself moves with the mouse, not
   only a dashed frame. Press **Ctrl+Z** twice and close Edit PDF without saving.

## Checklist

- [ ] 1 Single page view: a zoomed page scrolls and stays in its area
- [ ] 2 The wheel turns pages at the end of a page
- [ ] 3 Narrow window: panels shrink, the page never covers them
- [ ] 4 Dragged text shows its words moving
- [ ] 5 Dragged image shows the picture moving

## If a step fails

Send the step number, what you clicked, what you saw, and a screenshot.
