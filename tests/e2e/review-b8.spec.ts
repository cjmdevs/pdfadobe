// Fixes from the B8 code review: a top bar button that opens its tool keeps what it
// started, the Hand tool lets go, right-click menus give focus back, two-up paging is not
// a jump, the top bar re-fits, Add divider, the Snap distance box.
import {
  P,
  boot,
  expect,
  menu,
  openPaths,
  pages,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

async function open(page: Page, path: string) {
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
}

test.describe("B8 review fixes", () => {
  test("Redact > Draw box on the top bar opens Redact and stays armed", async ({ page }) => {
    await boot(page, {
      settings: { topBar: { bar: ["bar:open", "redact.drawBox", "bar:spacer"], menus: {} } },
    });
    await open(page, P.wpA);
    await page
      .getByTestId("top-bar")
      .getByRole("button", { name: /^Mark an area/ })
      .click();
    await expect(page.getByTestId("tool-toolbar")).toBeVisible();
    const box = (await pages(page).first().boundingBox())!;
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 140, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId("redact-mark")).toHaveCount(1);
  });

  test("the Hand tool lets go when the button release never arrives", async ({ page }) => {
    await boot(page);
    await open(page, P.text);
    for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Equal");
    const vp = page.getByTestId("viewport");
    await expect.poll(() => vp.evaluate((el) => el.scrollWidth > el.clientWidth + 50)).toBe(true);
    const pos = () => vp.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
    await menu(page, "View", "Hand tool");
    const b = (await vp.boundingBox())!;
    // The window loses focus mid-drag (Alt+Tab): the drag is over.
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 350, b.y + 300, { steps: 3 });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const held = await pos();
    await page.mouse.move(b.x + 200, b.y + 200, { steps: 3 });
    expect(await pos()).toEqual(held);
    await page.mouse.up();
    // A move with no button held ends a drag whose release was lost.
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.down();
    await expect(vp).toHaveClass(/grabbing/);
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent("pointermove", { buttons: 0, bubbles: true })),
    );
    await expect(vp).not.toHaveClass(/grabbing/);
    await page.mouse.up();
  });
});
