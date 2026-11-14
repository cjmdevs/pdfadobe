# Test guide: B8 code review fixes

About 10 minutes on the build PC. Ten small fixes from a code review of B8. Nothing about
saving or file formats changed, so there's no Acrobat check this time. All test files are
synthetic.

## Setup (PowerShell)

```powershell
cd "C:\Users\carso\Claude Projects\code\pdfadobe"
git pull
npm ci
npm run corpus
npm run tauri build
New-Item -ItemType Directory -Force C:\B8Test | Out-Null
Copy-Item tests\corpus\generated\workpaper-a.pdf, tests\corpus\generated\navigation.pdf C:\B8Test\
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe` over the
old one and open `C:\B8Test\workpaper-a.pdf`.

## Steps

1. **Redact from the top bar.** **Window** > **Customize top bar…**. Under "Tools you can
   add" open **Redact**, click **Mark an area: drag a box over what to remove**, click the
   **Add to the top bar** button next to the list, then **Save**. With no tool open, click
   the new button on the top bar (its tip starts "Mark an area"), then drag a box on the
   page. Pass: the Redact toolbar opens and the box is drawn on the first try. Close the
   Redact toolbar with its **X** (nothing is applied).
2. **Hand tool lets go.** Press **Ctrl+=** a few times to zoom in. **View** > **Hand
   tool**. Drag the scrollbar on the right. Pass: it scrolls like a normal scrollbar, and
   when you let go and move the mouse the page stays still. Now drag the page itself and,
   with the button still down, press **Alt+Tab** to another program, let go, and come
   back. Pass: the page doesn't follow the mouse. Turn the Hand tool off.
3. **Paste right after a right-click Copy.** In the Pages panel on the left, right-click
   page 2 and pick **Copy**. Without clicking anything, press **Ctrl+V**. Pass: a copy of
   page 2 appears after it. Press **Ctrl+Z**.
4. **Two-up paging isn't a jump.** Open `C:\B8Test\navigation.pdf`. **View** > **Page
   display** > **Two-up continuous**. Click **Next page** on the top bar three times, one
   second apart, then press **Alt+Left**. Pass: nothing moves. Click **First page**, wait a
   second, press **Alt+Left**. Pass: you're back on the pages you were reading.
5. **Top bar re-fits.** **View** > **Page display** > **Single page continuous**. Make the
   window narrower until the top bar only just fits (stop before a **»** button shows up
   on it). Switch **Page display** on the top bar to **Two-up**. Pass: a **»** button
   appears and nothing on the bar is cut off at the right edge.
6. **Add divider.** **Window** > **Customize top bar…**. Pass: **Add divider** and **Save**
   are both greyed. Click **Open** in the strip at the top. Pass: **Add divider** lights
   up; clicking it puts a divider right after Open. Click **Cancel**.
7. **Snap distance.** Press **Ctrl+K**, click **Edit PDF**, select the number in **Snap
   distance** and type `12`. Pass: the box shows 12. Close Preferences, press **Ctrl+K**
   and click **Edit PDF** again. Pass: it still says 12.
8. **Dragging still works.** Open **Organize Pages** and drag page 1 after page 2. Pass: a
   see-through copy follows the pointer and the page moves. Press **Ctrl+Z** and close
   Organize. Click **Comment** > **Rectangle**, draw one, then drag it toward the left edge
   of the page. Pass: a guide line appears at the edge and a small X / Y readout follows
   the box.

## Checklist

- [ ] 1 Draw box from the top bar draws on the first try
- [ ] 2 Hand tool: scrollbar works, page never sticks to the mouse
- [ ] 3 Ctrl+V works right after right-click > Copy
- [ ] 4 Two-up: Next page isn't a jump, First page is
- [ ] 5 Top bar shows » instead of cutting items off
- [ ] 6 Add divider greyed until an item is picked; Save stays greyed
- [ ] 7 Snap distance takes a typed 12 and keeps it
- [ ] 8 Page drag preview and comment snapping still work

## If a step fails

Send the step number, what you clicked, what you saw, and a screenshot.
