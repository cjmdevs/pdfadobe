// Backlog B2: Home screen. Shown at launch (last session only when asked), after the last
// tab closes and from the Home tab; Recent Files with thumbnails, pin, remove, clear all;
// offline files greyed out; Open, drop zone, quick tools.
import { join } from "node:path";
import { CORPUS, P, boot, expect, openPaths, test, type Page } from "./fixtures";

const home = (page: Page) => page.getByTestId("start-page");
const recent = (page: Page) =>
  page.getByRole("list", { name: "Recent files" }).getByRole("listitem");
const docTabs = (page: Page) => page.getByRole("tab", { name: /\.pdf/ });

test.describe("home screen", () => {
  test("launch shows Home; last session's tabs come back only when the setting is on", async ({
    page,
  }) => {
    await boot(page, { settings: { openTabs: [P.text], activeTab: P.text } });
    await expect(home(page)).toBeVisible();
    await expect(docTabs(page)).toHaveCount(0);
  });

  test("restore last session (opt-in)", async ({ page }) => {
    await boot(page, {
      settings: { restoreSession: true, openTabs: [P.text, P.nav], activeTab: P.nav },
    });
    await expect(docTabs(page)).toHaveCount(2);
    await expect(page.getByRole("tab", { name: /navigation/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("Settings turns session restore on and survives a restart", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    await page.getByLabel("Reopen last session’s files at start").check();
    await page.keyboard.press("Escape");
    await openPaths(page, [P.text]);
    await expect(docTabs(page)).toHaveCount(1);
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
    await expect(docTabs(page)).toHaveCount(1);
  });

  test("recent files: thumbnail, folder, last opened; pin, remove, clear all", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await openPaths(page, [P.long500]);
    await expect(page.getByRole("tab", { name: /long-500p/ })).toBeVisible();
    await page.keyboard.press("Control+Shift+W"); // close all: back to Home
    await expect(home(page)).toBeVisible();

    await expect(recent(page)).toHaveCount(2);
    const first = recent(page).nth(0);
    await expect(first).toContainText("long-500p.pdf");
    await expect(first).toContainText("\\\\fileserver\\share\\Corpus");
    await expect(first).toContainText(/Today, \d{1,2}:\d{2} [AP]M/);
    // Page-1 thumbnails were made when the files opened.
    await expect(page.locator(".recent-thumb img")).toHaveCount(2);

    // Pin the older one: it moves to the top.
    await page.getByRole("button", { name: "Pin text-1p.pdf" }).click();
    await expect(recent(page).nth(0)).toContainText("text-1p.pdf");
    await expect(page.getByRole("button", { name: "Unpin text-1p.pdf" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Remove long-500p.pdf from recent files" }).click();
    await expect(recent(page)).toHaveCount(1);

    // Pinned survives a restart; Clear all asks first, then empties the list.
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Unpin text-1p.pdf" })).toBeVisible();
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByText("No recent files.")).toBeVisible();
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem("pdf-workbench.settings") ?? "{}").recent,
    );
    expect(saved).toEqual([]);
  });

  test("thumbnails can be turned off", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await page.keyboard.press("Control+w");
    await expect(page.locator(".recent-thumb img")).toHaveCount(1);

    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    await page.getByLabel("Show page thumbnails in recent files").uncheck();
    await page.keyboard.press("Escape");
    await expect(page.locator(".recent-thumb")).toHaveCount(0);
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem("pdf-workbench.settings") ?? "{}").recent,
    );
    expect(saved[0].thumb).toBeNull();

    // Off: opening again makes none.
    await openPaths(page, [P.text]);
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await page.keyboard.press("Control+w");
    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    await page.getByLabel("Show page thumbnails in recent files").check();
    await page.keyboard.press("Escape");
    await expect(page.locator(".recent-thumb img")).toHaveCount(0);
  });

  test("a file on an unreachable share is greyed out, not an error", async ({ page }) => {
    await boot(page, {
      settings: {
        recent: [
          { path: P.offline, opened: 1, pinned: false, thumb: null },
          { path: P.text, opened: 1, pinned: false, thumb: null },
        ],
      },
    });
    const off = recent(page).nth(0);
    await expect(off).toHaveAttribute("data-status", "offline");
    await expect(off).toContainText("Offline");
    await expect(off).toHaveClass(/away/);
    await expect(recent(page).nth(1)).toHaveAttribute("data-status", "ok");
    await off.getByRole("button", { name: "return.pdf, offline" }).click();
    await expect(page.getByRole("status").filter({ hasText: "still offline" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a deleted local file shows Not found and opening it offers removal", async ({ page }) => {
    await boot(page, { settings: { recent: [P.missing] } });
    await expect(recent(page).nth(0)).toHaveAttribute("data-status", "missing");
    await expect(recent(page).nth(0)).toContainText("Not found");
    await recent(page).nth(0).getByRole("button", { name: "moved-away.pdf, not found" }).click();
    const dialog = page.getByRole("dialog", { name: "Can't open file" });
    await dialog.getByRole("button", { name: "Remove from recent files" }).click();
    await expect(page.getByText("No recent files.")).toBeVisible();
  });

  test("quick tools: Combine Files and Organize Pages", async ({ page }) => {
    await boot(page);
    const quick = page.getByRole("list", { name: "Quick tools" });
    await quick.getByRole("button", { name: "Combine Files" }).click();
    await expect(page.getByRole("dialog", { name: "Combine Files" })).toBeVisible();
    await page.keyboard.press("Escape");

    const chooser = page.waitForEvent("filechooser");
    await quick.getByRole("button", { name: "Organize Pages" }).click();
    await (await chooser).setFiles(join(CORPUS, "workpaper-a.pdf"));
    await expect(page.getByTestId("organize")).toBeVisible();
  });

  test("Open button and drop zone pick files", async ({ page }) => {
    await boot(page);
    let chooser = page.waitForEvent("filechooser");
    await home(page).getByRole("button", { name: "Open…" }).click();
    await (await chooser).setFiles(join(CORPUS, "text-1p.pdf"));
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await page.getByTestId("home-tab").click();
    chooser = page.waitForEvent("filechooser");
    await page.getByTestId("home-drop").click();
    await (await chooser).setFiles(join(CORPUS, "workpaper-a.pdf"));
    await expect(page.getByRole("tab", { name: /workpaper-a/ })).toBeVisible();
    await expect(home(page)).toHaveCount(0);
  });

  test("Home tab shows Home over open files; a file tab goes back", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    const tab = page.getByRole("tab", { name: /text-1p/ });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("home-tab").click();
    await expect(home(page)).toBeVisible();
    await expect(page.getByTestId("home-tab")).toHaveAttribute("aria-selected", "true");
    await expect(tab).toHaveAttribute("aria-selected", "false");
    await tab.click();
    await expect(home(page)).toHaveCount(0);
    await expect(tab).toHaveAttribute("aria-selected", "true");
  });
});
