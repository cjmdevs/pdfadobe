// Find with result list + highlighting; text selection and copy.
import { P, boot, currentPageNumber, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("search", () => {
  test("finds every match, lists them with context, highlights and navigates", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.long200]);
    await waitForPainted(page, 0);

    await page.keyboard.press("Control+f");
    const box = page.getByLabel("Find text");
    await expect(box).toBeFocused();
    await box.fill("schedule line 15");
    await box.press("Enter");

    // "schedule line 15" and "schedule line 150..159".
    await expect(page.getByTestId("search-summary")).toHaveText(/1 of 11 matches/);
    const results = page.getByTestId("search-result");
    await expect(results).toHaveCount(11);
    await expect(results.first()).toContainText("Page 15");
    await expect(results.first().locator("mark")).toHaveText(/schedule line 15/i);

    // Highlights are drawn on the page.
    await expect.poll(() => currentPageNumber(page)).toBe(15);
    await expect(
      page.locator('[data-page-index="14"]').locator("div[style*='background']").first(),
    ).toBeVisible();

    await page.keyboard.press("F3");
    await expect(page.getByTestId("search-summary")).toHaveText(/2 of 11 matches/);
    await expect.poll(() => currentPageNumber(page)).toBe(150);
    await page.keyboard.press("Shift+F3");
    await expect(page.getByTestId("search-summary")).toHaveText(/1 of 11 matches/);

    await results.nth(10).click();
    await expect.poll(() => currentPageNumber(page)).toBe(159);
  });

  test("match case and whole words narrow the results", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.keyboard.press("Control+f");
    await page.getByLabel("Find text").fill("SAMPLE");
    await page.getByLabel("Find text").press("Enter");
    await expect(page.getByTestId("search-summary")).toHaveText(/of 1 matches/);
    await page.getByLabel("Match case").check();
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await expect(page.getByTestId("search-summary")).toHaveText("No matches");
  });

  test("no matches is reported", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Find (Ctrl+F)" }).click();
    await page.getByLabel("Find text").fill("zzzz-not-here");
    await page.getByLabel("Find text").press("Enter");
    await expect(page.getByTestId("search-summary")).toHaveText("No matches");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: "Find" })).toHaveCount(0);
  });
});

test.describe("text selection", () => {
  test("drag to select text, Ctrl+C copies it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Actual size (Ctrl+1)" }).click();
    // Zooming keeps the center fixed; bring the top of the page into view before measuring.
    await page.getByTestId("viewport").evaluate((el) => (el.scrollTop = 0));
    const p = page.locator('[data-page-index="0"]').first();
    const b = (await p.boundingBox())!;
    // Title "Sample Engagement Memo" sits at x=72pt, y=720pt from the bottom of a 792pt page.
    const scale = b.width / 612;
    const y = b.y + (792 - 726) * scale;
    await page.mouse.move(b.x + 70 * scale, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 200 * scale, y, { steps: 8 });
    await page.mouse.move(b.x + 300 * scale, y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Control+c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("Sample Engagement");
  });

  test("Ctrl+A selects all text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByTestId("viewport").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/Sample Engagement Memo[\s\S]*Total revenue per trial balance/);
  });
});
