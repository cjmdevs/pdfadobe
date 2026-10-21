// Remembered between sessions: theme, last zoom, open tabs, view mode.
// (Window size/position is remembered by tauri-plugin-window-state in the Windows app.)
import { P, boot, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("persistence", () => {
  test("light / dark theme toggles and survives a restart", async ({ page }) => {
    await boot(page, { settings: { theme: "light" } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await toggle.click(); // light -> dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(30, 30, 30)");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("system theme follows Windows", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await boot(page, { settings: { theme: "system" } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("open tabs, active tab, last zoom and view mode are restored", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text, P.nav, P.long200]);
    await expect(page.getByRole("tab", { name: /\.pdf/ })).toHaveCount(3);
    await page.getByRole("tab", { name: /navigation/ }).click();
    await waitForPainted(page, 0);
    await page.getByLabel("Zoom percentage").fill("150");
    await page.getByLabel("Zoom percentage").press("Enter");
    await expect(page.getByLabel("Zoom percentage")).toHaveValue("150%");
    await page.getByLabel("Page display").selectOption("twoUp");

    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
    const tabs = page.getByRole("tab", { name: /\.pdf/ });
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText("text-1p.pdf");
    await expect(page.getByRole("tab", { name: /navigation/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Zoom percentage")).toHaveValue("150%");
    await expect(page.getByLabel("Page display")).toHaveValue("twoUp");
  });

  test("a tab whose file disappeared is skipped with a notice", async ({ page }) => {
    await boot(page, { settings: { openTabs: [P.text, P.missing], activeTab: P.text } });
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Could not reopen" })).toContainText(
      "moved-away.pdf",
    );
    await expect(page.getByRole("tab", { name: /\.pdf/ })).toHaveCount(1);
  });
});
