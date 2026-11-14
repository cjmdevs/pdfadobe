// Fixes from the B8 code review: a top bar button that opens its tool keeps what it
// started, the Hand tool lets go, right-click menus give focus back, two-up paging is not
// a jump, the top bar re-fits, Add divider, the Snap distance box.
import {
  P,
  boot,
  currentPageNumber,
  expect,
  menu,
  openPaths,
  pages,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

const thumb = (page: Page, n: number) =>
  page.getByTestId("thumbs").getByRole("option", { name: `Page ${n}`, exact: true });
const thumbs = (page: Page) => page.getByTestId("thumbs").getByTestId("thumb");

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

  test("after right-click > Copy, Ctrl+V pastes without another click", async ({ page }) => {
    await boot(page);
    await open(page, P.wpA);
    await expect(thumbs(page)).toHaveCount(3);
    await thumb(page, 2).click({ button: "right" });
    await page
      .getByRole("menu", { name: "Page menu" })
      .getByRole("menuitem", { name: "Copy" })
      .click();
    await expect(page.getByText("Copied 1 page.")).toBeVisible();
    await expect(page.getByTestId("thumbs")).toBeFocused();
    await page.keyboard.press("Control+v");
    await expect(thumbs(page)).toHaveCount(4);
  });

  test("two-up: Next page is not a jump for Previous view; Go to page is", async ({ page }) => {
    await boot(page, { settings: { viewMode: "twoUp" } });
    await open(page, P.nav);
    const next = page.getByRole("button", { name: /^Next page/ });
    for (let i = 0; i < 2; i++) {
      await next.click();
      await page.waitForTimeout(600);
    }
    const here = await currentPageNumber(page);
    expect(here).toBeGreaterThan(1);
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(300);
    expect(await currentPageNumber(page)).toBe(here);
    const box = page.getByLabel("Page number");
    await box.fill("9");
    await box.press("Enter");
    // The last spread cannot scroll all the way up: any page well past `here` will do.
    await expect.poll(() => currentPageNumber(page)).toBeGreaterThan(here + 2);
    await page.waitForTimeout(600);
    await page.getByTestId("viewport").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(() => currentPageNumber(page)).toBe(here);
  });

  test("the top bar re-fits when an item gets wider (Cover page in two-up)", async ({ page }) => {
    await boot(page);
    await open(page, P.wpA);
    const bar = page.getByTestId("top-bar");
    // A window the bar only just fits in.
    const need = await bar.evaluate((el) => {
      const cs = getComputedStyle(el);
      const slots = [...el.querySelectorAll<HTMLElement>("[data-slot]")];
      return (
        slots.reduce((s, x) => s + (x.dataset.slot === "bar:spacer" ? 0 : x.offsetWidth + 4), 0) +
        parseFloat(cs.paddingLeft) +
        parseFloat(cs.paddingRight)
      );
    });
    await page.setViewportSize({ width: Math.ceil(need) + 20, height: 720 });
    await expect(page.getByTestId("top-bar-more")).toHaveCount(0);
    await bar.getByLabel("Page display").selectOption("twoUp");
    await expect(page.getByTestId("top-bar-more")).toBeVisible();
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // Back to one page a row: everything fits again.
    await bar.getByLabel("Page display").selectOption("continuous");
    await expect(page.getByTestId("top-bar-more")).toHaveCount(0);
  });
});
