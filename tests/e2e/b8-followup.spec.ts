// Owner findings after the B8 review fixes: a narrow window never lets the page paint
// over the side panels, the wheel turns pages in Single page view, and a text box or
// image dragged in Edit PDF shows its content moving.
import {
  P,
  boot,
  currentPageNumber,
  expect,
  openPaths,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

async function open(page: Page, path: string) {
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
}

test.describe("B8 follow-up", () => {
  test("a narrow window shrinks the side panels, never the page area to nothing", async ({
    page,
  }) => {
    await boot(page, { settings: { commentsOpen: true, toolsPaneOpen: true } });
    await open(page, P.wpA);
    // The smallest window the app allows (tauri.conf.json minWidth).
    await page.setViewportSize({ width: 640, height: 720 });
    const boxes = () =>
      page.evaluate(() => {
        const r = (sel: string) => {
          const b = document.querySelector(sel)!.getBoundingClientRect();
          return { l: Math.round(b.left), r: Math.round(b.right) };
        };
        return {
          doc: r(".doc-area"),
          viewport: r("[data-testid=viewport]"),
          left: r(".left-dock"),
          comments: r("[data-testid=comments-panel]"),
          tools: r(".tools-pane"),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
    await expect.poll(async () => (await boxes()).doc.r - (await boxes()).doc.l).toBe(240);
    const b = await boxes();
    // The page area keeps its room and the viewport stays inside it.
    expect(b.viewport).toEqual(b.doc);
    // Panels sit beside it, in order, all inside the window.
    expect(b.left.l).toBe(0);
    expect(b.left.r).toBe(b.doc.l);
    expect(b.comments.l).toBe(b.doc.r);
    expect(b.tools.l).toBe(b.comments.r);
    expect(b.tools.r).toBe(640);
    expect(b.scrollWidth).toBe(640);
    // What is under the middle of each panel is the panel, not the page.
    for (const sel of ["[data-testid=comments-panel]", ".tools-pane", ".sidebar"]) {
      const own = await page.evaluate((s) => {
        const el = document.querySelector(s)!;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && el.contains(hit);
      }, sel);
      expect(own, sel).toBe(true);
    }
    // Fit width: the page narrows with its area (the zoom re-fits a moment after a resize).
    const first = page.getByTestId("viewport").getByTestId("page").first();
    await expect.poll(async () => (await first.boundingBox())!.width).toBeLessThanOrEqual(240);
    // A wide window gives the panels their full width back.
    await page.setViewportSize({ width: 1400, height: 720 });
    await expect.poll(async () => (await boxes()).tools.r - (await boxes()).tools.l).toBe(260);
    const wide = await boxes();
    expect(wide.comments.r - wide.comments.l).toBe(320);
    expect(wide.left.r - wide.left.l).toBe(268);
  });

  test("Single page view: a zoomed page scrolls inside the document area", async ({ page }) => {
    await boot(page, { settings: { viewMode: "single" } });
    await open(page, P.wpA);
    const vp = page.getByTestId("viewport");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Equal");
    // Bigger than the window both ways: the viewport scrolls to all of it.
    await expect
      .poll(() =>
        vp.evaluate(
          (el) => el.scrollHeight > el.clientHeight + 300 && el.scrollWidth > el.clientWidth + 100,
        ),
      )
      .toBe(true);
    const shown = await vp.evaluate((el) => {
      const p = el.querySelector("[data-testid=page]")!.getBoundingClientRect();
      return {
        w: Math.round(p.width),
        h: Math.round(p.height),
        sw: el.scrollWidth,
        sh: el.scrollHeight,
      };
    });
    expect(shown.sw).toBeGreaterThanOrEqual(shown.w);
    expect(shown.sh).toBeGreaterThanOrEqual(shown.h);
    // The wheel scrolls it.
    const box = (await vp.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => vp.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    // The far corner of the page can be reached.
    await vp.evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
    const corner = await vp.evaluate((el) => {
      const p = el.querySelector("[data-testid=page]")!.getBoundingClientRect();
      const v = el.getBoundingClientRect();
      return p.right <= v.left + el.clientWidth && p.bottom <= v.top + el.clientHeight;
    });
    expect(corner).toBe(true);
  });

  test("Single page view: the wheel turns the page when there is nothing left to scroll", async ({
    page,
  }) => {
    await boot(page, { settings: { viewMode: "single", zoom: "fit-page" } });
    await open(page, P.nav);
    const vp = page.getByTestId("viewport");
    const box = (await vp.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const wheel = async (dy: number) => {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(250);
    };
    // The page fits: every notch is a page.
    await expect.poll(() => vp.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await wheel(100);
    await expect.poll(() => currentPageNumber(page)).toBe(2);
    await wheel(100);
    await expect.poll(() => currentPageNumber(page)).toBe(3);
    await wheel(-100);
    await expect.poll(() => currentPageNumber(page)).toBe(2);
    // Ctrl+wheel is zoom, never a page turn.
    await page.keyboard.down("Control");
    await wheel(100);
    await page.keyboard.up("Control");
    expect(await currentPageNumber(page)).toBe(2);
    // Nothing before the first page.
    await wheel(-100);
    await expect.poll(() => currentPageNumber(page)).toBe(1);
    await wheel(-100);
    expect(await currentPageNumber(page)).toBe(1);

    // A page taller than the window scrolls first, then turns, and starts at its top.
    for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Equal");
    await expect
      .poll(() => vp.evaluate((el) => el.scrollHeight > el.clientHeight + 300))
      .toBe(true);
    await vp.evaluate((el) => (el.scrollTop = 0));
    await wheel(100);
    expect(await currentPageNumber(page)).toBe(1);
    expect(await vp.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await vp.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await wheel(100);
    await expect.poll(() => currentPageNumber(page)).toBe(2);
    await expect.poll(() => vp.evaluate((el) => el.scrollTop)).toBe(0);
    // Back from the top lands at the bottom of the page before.
    await wheel(-100);
    await expect.poll(() => currentPageNumber(page)).toBe(1);
    await expect
      .poll(() => vp.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
      .toBe(true);
  });
});
