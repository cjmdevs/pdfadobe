// Acrobat-compatible keyboard shortcuts (table in src/app/shortcuts.ts, sources cited there).
import {
  P,
  boot,
  currentPageNumber,
  expect,
  idle,
  openPaths,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

/**
 * The page number updates as soon as a jump starts, but the viewport scrolls a frame or
 * two later. Waits for both, so the next key starts from where the last one landed.
 */
async function onPage(page: Page, n: number) {
  await expect.poll(() => currentPageNumber(page)).toBe(n);
  let last = -1;
  await expect
    .poll(
      async () => {
        const top = await page.getByTestId("viewport").evaluate((el) => el.scrollTop);
        const still = top === last;
        last = top;
        return still;
      },
      { intervals: [50] },
    )
    .toBe(true);
  expect(await currentPageNumber(page)).toBe(n);
}

async function zoomPercent(page: Page) {
  return Number((await page.getByLabel("Zoom percentage").inputValue()).replace("%", ""));
}

test.describe("keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.long200]);
    await waitForPainted(page, 0);
    // The zoom plugin re-fits 150 ms after the viewport gets its scrollbar and scrolls
    // back to where it was; a key pressed before that has its page jump undone.
    await idle(page);
  });

  test("page navigation keys", async ({ page }) => {
    await page.keyboard.press("ArrowRight");
    await onPage(page, 2);
    await page.keyboard.press("Control+PageDown");
    await onPage(page, 3);
    await page.keyboard.press("ArrowLeft");
    await onPage(page, 2);
    await page.keyboard.press("End");
    await onPage(page, 200);
    await page.keyboard.press("Home");
    await onPage(page, 1);
    await page.keyboard.press("Control+Shift+ArrowDown");
    await onPage(page, 200);
    await page.keyboard.press("Control+Shift+PageUp");
    await onPage(page, 1);
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => page.getByTestId("viewport").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
  });

  test("Ctrl+Shift+N goes to a page", async ({ page }) => {
    await page.keyboard.press("Control+Shift+N");
    await expect(page.getByLabel("Page number")).toBeFocused();
    await page.keyboard.type("120");
    await page.keyboard.press("Enter");
    await expect.poll(() => currentPageNumber(page)).toBe(120);
  });

  test("zoom keys", async ({ page }) => {
    await page.keyboard.press("Control+1");
    await expect.poll(() => zoomPercent(page)).toBe(100);
    await page.keyboard.press("Control+Equal");
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
    await page.keyboard.press("Control+Minus");
    await page.keyboard.press("Control+Minus");
    await expect.poll(() => zoomPercent(page)).toBeLessThan(100);
    await page.keyboard.press("Control+2");
    await expect(page.getByRole("button", { name: "Fit width (Ctrl+2)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Control+0");
    await expect(page.getByRole("button", { name: "Fit page (Ctrl+0)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Ctrl+Y is Redo in Acrobat (owner-verified); the viewer leaves it unbound.
    await page.keyboard.press("Control+y");
    await expect(page.getByLabel("Zoom percentage")).not.toBeFocused();
  });

  test("rotate view keys (Ctrl+Shift+Plus / Minus)", async ({ page }) => {
    const shape = async () => {
      const b = (await page
        .locator('[data-testid=viewport] [data-page-index="0"]')
        .first()
        .boundingBox())!;
      return b.width > b.height ? "landscape" : "portrait";
    };
    expect(await shape()).toBe("portrait");
    await page.keyboard.press("Control+Shift+Equal");
    await expect.poll(shape).toBe("landscape");
    await page.keyboard.press("Control+Shift+Minus");
    await expect.poll(shape).toBe("portrait");
  });

  test("find, properties, shortcuts help, navigation pane", async ({ page }) => {
    await page.keyboard.press("Control+f");
    await expect(page.getByLabel("Find text")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Find text")).toHaveCount(0);

    await page.keyboard.press("Control+d");
    await expect(page.getByRole("dialog", { name: "Document Properties" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("F1");
    const help = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(help).toContainText("Go to page");
    await expect(help).toContainText("Ctrl+Shift+N");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+Shift+F5");
    await expect(page.getByRole("tab", { name: "Pages" })).toBeFocused();
  });

  test("typing in a box does not trigger page shortcuts", async ({ page }) => {
    await page.keyboard.press("Control+f");
    await page.getByLabel("Find text").fill("schedule");
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    expect(await currentPageNumber(page)).toBe(1);
  });
});
