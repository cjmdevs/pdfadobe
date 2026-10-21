// Phase 1 performance targets on the 500-page corpus file (opened from a UNC path):
//  1. open to first painted page in under 2 seconds;
//  2. scrolling does not leave blank pages on screen.
//
// Measured in headless Chromium on Linux. WebView2 on the office PCs is the same engine,
// but the real number must also be checked on Windows (docs/progress.md manual check).
import { P, boot, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("performance (500 pages)", () => {
  test("opens to the first page in under 2 seconds", async ({ page }) => {
    await boot(page);
    const start = await page.evaluate(() => performance.now());
    await openPaths(page, [P.long500]);
    await waitForPainted(page, 0);
    const ms = (await page.evaluate(() => performance.now())) - start;
    console.log(`500-page open to first painted page: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(2000);
    await expect(page.getByTestId("page-count")).toHaveText("/ 500");
  });

  test("no blank pages linger after scrolling", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.long500]);
    await waitForPainted(page, 0);
    const viewport = page.getByTestId("viewport");

    /** Visible pages without a painted image. */
    const blankVisible = () =>
      viewport.evaluate((vp) => {
        const v = vp.getBoundingClientRect();
        const blank: number[] = [];
        for (const el of vp.querySelectorAll<HTMLElement>("[data-page-index]")) {
          const r = el.getBoundingClientRect();
          if (r.bottom < v.top || r.top > v.bottom) continue;
          const painted = [...el.querySelectorAll("img")].some(
            (i) => i.complete && i.naturalWidth > 0,
          );
          if (!painted) blank.push(Number(el.dataset.pageIndex));
        }
        return blank;
      });

    // Jumps (scrollbar drag) and continuous wheel scrolling.
    for (const fraction of [0.1, 0.37, 0.5, 0.82, 1]) {
      await viewport.evaluate((vp, f) => {
        vp.scrollTop = (vp.scrollHeight - vp.clientHeight) * f;
      }, fraction);
      await expect.poll(blankVisible, { timeout: 1000, intervals: [50, 100, 200] }).toEqual([]);
    }
    await viewport.evaluate((vp) => (vp.scrollTop = 0));
    await viewport.hover();
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 900);
    await expect.poll(blankVisible, { timeout: 1000, intervals: [50, 100, 200] }).toEqual([]);
  });
});
