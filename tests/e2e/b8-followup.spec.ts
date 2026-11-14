// Owner findings after the B8 review fixes: a narrow window never lets the page paint
// over the side panels, the wheel turns pages in Single page view, and a text box or
// image dragged in Edit PDF shows its content moving.
import { P, boot, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

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
});
