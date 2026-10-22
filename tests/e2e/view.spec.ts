// Page display modes, zoom, rotate view, navigation.
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

async function box(page: Page, index: number) {
  const b = await page
    .locator(`[data-testid=viewport] [data-page-index="${index}"]`)
    .first()
    .boundingBox();
  if (!b) throw new Error(`page ${index} not rendered`);
  return b;
}

async function open(page: Page, path: string) {
  await boot(page);
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
}

test.describe("page display", () => {
  test("continuous scroll stacks pages vertically", async ({ page }) => {
    await open(page, P.long200);
    await expect(page.getByLabel("Page display")).toHaveValue("continuous");
    const a = await box(page, 0);
    const b = await box(page, 1);
    expect(Math.round(b.x)).toBe(Math.round(a.x));
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  });

  test("single page shows one page at a time", async ({ page }) => {
    await open(page, P.long200);
    await page.getByLabel("Page display").selectOption("single");
    await expect(page.getByTestId("viewport").getByTestId("page")).toHaveCount(1);
    await page.getByRole("button", { name: "Next page (Right arrow)" }).click();
    await expect(page.getByTestId("viewport").getByTestId("page")).toHaveAttribute(
      "data-page-index",
      "1",
    );
    expect(await currentPageNumber(page)).toBe(2);
    await page.keyboard.press("End");
    await expect(page.getByTestId("viewport").getByTestId("page")).toHaveAttribute(
      "data-page-index",
      "199",
    );
    // Back to continuous keeps the reader on the same page.
    await page.getByLabel("Page display").selectOption("continuous");
    await expect.poll(() => currentPageNumber(page)).toBe(200);
  });

  test("two-up puts facing pages side by side, with optional cover page", async ({ page }) => {
    await open(page, P.long200);
    await page.getByLabel("Page display").selectOption("twoUp");
    await waitForPainted(page, 1);
    let a = await box(page, 0);
    let b = await box(page, 1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);

    await page.getByLabel("Cover page").check();
    await waitForPainted(page, 2);
    a = await box(page, 0);
    b = await box(page, 1);
    const c = await box(page, 2);
    expect(b.y).toBeGreaterThan(a.y + a.height - 1); // cover alone on the first row
    expect(Math.abs(b.y - c.y)).toBeLessThan(2); // then 2-3 side by side
  });
});

test.describe("zoom", () => {
  test("actual size, fit width, fit page, typed percentage, zoom in/out", async ({ page }) => {
    await open(page, P.text);
    const zoom = page.getByLabel("Zoom percentage");
    const viewport = page.getByTestId("viewport");

    await page.getByRole("button", { name: "Actual size (Ctrl+1)" }).click();
    await expect(zoom).toHaveValue("100%");
    // Letter is 8.5 in = 816 CSS px at 100%.
    await expect.poll(async () => Math.round((await box(page, 0)).width)).toBe(816);

    await zoom.fill("200");
    await zoom.press("Enter");
    await expect(zoom).toHaveValue("200%");
    await expect.poll(async () => Math.round((await box(page, 0)).width)).toBe(1632);

    await page.getByRole("button", { name: "Fit width (Ctrl+2)" }).click();
    const vw = await viewport.evaluate((el) => el.clientWidth);
    await expect.poll(async () => (await box(page, 0)).width).toBeGreaterThan(vw - 60);
    await expect.poll(async () => (await box(page, 0)).width).toBeLessThanOrEqual(vw);

    await page.getByRole("button", { name: "Fit page (Ctrl+0)" }).click();
    const vh = await viewport.evaluate((el) => el.clientHeight);
    await expect.poll(async () => (await box(page, 0)).height).toBeLessThanOrEqual(vh);
    await expect.poll(async () => (await box(page, 0)).height).toBeGreaterThan(vh - 60);

    const before = await zoom.inputValue();
    await page.getByRole("button", { name: "Zoom in (Ctrl+=)" }).click();
    await expect(zoom).not.toHaveValue(before);
    const parse = async () => Number((await zoom.inputValue()).replace("%", ""));
    const zoomedIn = await parse();
    await page.getByRole("button", { name: "Zoom out (Ctrl+-)" }).click();
    await expect.poll(parse).toBeLessThan(zoomedIn);
  });
});

test.describe("rotate view", () => {
  test("rotates the view without changing the file", async ({ page }) => {
    await open(page, P.text);
    const portrait = await box(page, 0);
    expect(portrait.height).toBeGreaterThan(portrait.width);
    // Acrobat's View > Rotate View keys. (The toolbar buttons rotate the page itself.)
    await page.keyboard.press("Control+Shift+Equal");
    await expect
      .poll(async () => {
        const b = await box(page, 0);
        return b.width > b.height;
      })
      .toBe(true);
    await page.keyboard.press("Control+Shift+Minus");
    await expect
      .poll(async () => {
        const b = await box(page, 0);
        return b.height > b.width;
      })
      .toBe(true);
  });
});

test.describe("navigation", () => {
  test("go to page, previous/next, first/last", async ({ page }) => {
    await open(page, P.long200);
    await expect(page.getByTestId("page-count")).toHaveText("/ 200");
    const input = page.getByLabel("Page number");
    await input.fill("50");
    await input.press("Enter");
    await expect.poll(() => currentPageNumber(page)).toBe(50);
    await waitForPainted(page, 49);

    await page.getByRole("button", { name: "Next page (Right arrow)" }).click();
    await expect.poll(() => currentPageNumber(page)).toBe(51);
    await page.getByRole("button", { name: "Previous page (Left arrow)" }).click();
    await expect.poll(() => currentPageNumber(page)).toBe(50);
    await page.getByRole("button", { name: "Last page (End)" }).click();
    await expect.poll(() => currentPageNumber(page)).toBe(200);
    await page.getByRole("button", { name: "First page (Home)" }).click();
    await expect.poll(() => currentPageNumber(page)).toBe(1);
    await expect(page.getByRole("button", { name: "Previous page (Left arrow)" })).toBeDisabled();
  });
});
