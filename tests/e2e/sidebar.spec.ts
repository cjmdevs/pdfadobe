// Left panel: thumbnails, bookmarks (outline tree), attachments.
import { readFileSync } from "node:fs";
import { P, boot, currentPageNumber, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("navigation pane", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.nav]);
    await waitForPainted(page, 0);
  });

  test("thumbnails render and jump to their page", async ({ page }) => {
    const thumbs = page.getByTestId("thumb");
    await expect(thumbs.first()).toBeVisible();
    await expect(thumbs.first().locator("img")).toHaveJSProperty("complete", true);
    await page.getByRole("button", { name: "Page 3", exact: true }).click();
    await expect.poll(() => currentPageNumber(page)).toBe(3);
    await expect(page.getByRole("button", { name: "Page 3", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("bookmarks show the nested outline and navigate", async ({ page }) => {
    await page.getByRole("tab", { name: "Bookmarks" }).click();
    const tree = page.getByRole("tree", { name: "Bookmarks" });
    await expect(tree.getByRole("treeitem")).toHaveCount(6); // 3 top-level + 2 + 1 open children
    await expect(tree.getByRole("button", { name: "Legal page" })).toBeVisible();
    // Third level is collapsed until expanded.
    await expect(tree.getByRole("button", { name: "Landscape page" })).toHaveCount(0);
    const a4 = tree.getByRole("treeitem").filter({ hasText: "A4 page" });
    await a4.getByRole("button", { name: "Expand" }).click();
    await tree.getByRole("button", { name: "Landscape page" }).click();
    await expect.poll(() => currentPageNumber(page)).toBe(5);
    // Keyboard: Left collapses a node (Adobe: Left Arrow or Minus).
    await tree.getByRole("button", { name: "Part II - Schedules" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tree.getByRole("button", { name: "Schedule B" })).toHaveCount(0);
  });

  test("attachments are listed and can be saved", async ({ page }) => {
    await page.getByRole("tab", { name: "Attachments" }).click();
    const items = page.getByTestId("attachment");
    await expect(items).toHaveCount(2);
    const csv = items.filter({ hasText: "trial-balance.csv" });
    await expect(csv).toContainText("Synthetic trial balance");
    const download = page.waitForEvent("download");
    await csv.getByRole("button", { name: "Save…" }).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe("trial-balance.csv");
    expect(readFileSync(await d.path(), "utf8")).toContain("account,debit,credit");
  });

  test("the pane can be hidden with F4", async ({ page }) => {
    await expect(page.getByRole("complementary", { name: "Navigation pane" })).toBeVisible();
    await page.keyboard.press("F4");
    await expect(page.getByRole("complementary", { name: "Navigation pane" })).toHaveCount(0);
    await page.keyboard.press("F4");
    await expect(page.getByRole("complementary", { name: "Navigation pane" })).toBeVisible();
  });
});
