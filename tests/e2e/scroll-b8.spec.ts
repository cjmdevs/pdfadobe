// B8: horizontal scrolling: a scrollbar when the page is wider than the view, Shift+wheel
// scrolls sideways, holding Space or the Hand tool pans.
import { P, boot, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

const vp = (page: Page) => page.getByTestId("viewport");
const scrollPos = (page: Page) =>
  vp(page).evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));

async function zoomedIn(page: Page) {
  await boot(page);
  await openPaths(page, [P.text]);
  await waitForPainted(page, 0);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Equal");
  await expect
    .poll(() => vp(page).evaluate((el) => el.scrollWidth > el.clientWidth + 50))
    .toBe(true);
}

test.describe("horizontal scrolling (B8)", () => {
  test("a wide page shows a horizontal scrollbar; Shift+wheel scrolls sideways", async ({
    page,
  }) => {
    await zoomedIn(page);
    // Headless Chromium hides every scrollbar, so check the view scrolls sideways and that
    // the always-visible scrollbar style is in place (the real look: owner test guide).
    expect(await vp(page).evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    const styled = await page.evaluate(() =>
      [...document.styleSheets].some((sh) => {
        try {
          return [...sh.cssRules].some((r) => r.cssText.includes(".viewport::-webkit-scrollbar"));
        } catch {
          return false;
        }
      }),
    );
    expect(styled).toBe(true);
    const b = (await vp(page).boundingBox())!;
    await page.mouse.move(b.x + 200, b.y + 200);
    const before = await scrollPos(page);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await scrollPos(page)).x).toBeGreaterThan(before.x + 50);
  });

  test("holding Space and dragging pans the page", async ({ page }) => {
    await zoomedIn(page);
    await vp(page).focus();
    const b = (await vp(page).boundingBox())!;
    const before = await scrollPos(page);
    await page.keyboard.down("Space");
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 250, b.y + 150, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const after = await scrollPos(page);
    expect(after.x - before.x).toBeGreaterThan(100);
    expect(after.y - before.y).toBeGreaterThan(100);
    await expect(vp(page)).not.toHaveClass(/panning/);
  });

  test("the Hand tool pans until another tool starts", async ({ page }) => {
    await zoomedIn(page);
    const hand = page.getByRole("button", { name: "Hand tool (hold Space)" });
    await hand.click();
    await expect(hand).toHaveAttribute("aria-pressed", "true");
    const b = (await vp(page).boundingBox())!;
    const before = await scrollPos(page);
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 300, b.y + 300, { steps: 5 });
    await page.mouse.up();
    expect((await scrollPos(page)).x - before.x).toBeGreaterThan(60);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page
      .getByTestId("tool-toolbar")
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    await expect(hand).toHaveAttribute("aria-pressed", "false");
  });
});
