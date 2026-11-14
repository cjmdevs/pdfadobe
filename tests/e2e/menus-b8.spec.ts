// B8: menu bar with shortcuts, Preferences with categories, command search (Alt+Q),
// in-app Help, tooltips with shortcuts.
import {
  P,
  boot,
  expect,
  menu,
  openPaths,
  openPreferences,
  test,
  waitForPainted,
} from "./fixtures";

test.describe("menus, preferences, search, help (B8)", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
  });

  test("the menu bar lists File, Edit, View, Window, Help with shortcuts; Alt keys work", async ({
    page,
  }) => {
    const bar = page.getByRole("menubar", { name: "Menu bar" });
    for (const m of ["File", "Edit", "View", "Window", "Help"])
      await expect(bar.getByRole("menuitem", { name: m, exact: true })).toBeVisible();
    await page.keyboard.press("Alt+f");
    const file = page.getByRole("menu", { name: "File" });
    // The open menu is fully on screen, under its title (it once opened off the left edge).
    await expect(file).toBeInViewport({ ratio: 1 });
    await expect(file.getByRole("menuitem", { name: /Open…/ })).toContainText("Ctrl+O");
    await expect(file.getByRole("menuitem", { name: /^Save As…/ })).toContainText("Ctrl+Shift+S");
    // Right arrow moves to the next menu; Escape closes.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menu", { name: "Edit" })).toContainText("Ctrl+K");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Edit" })).toHaveCount(0);
    // A submenu: View > Zoom > Fit page.
    await menu(page, "View", "Zoom", "Fit page");
    await expect(page.getByLabel("Zoom percentage")).not.toHaveValue("");
    // Window lists the open tab.
    await menu(page, "Window");
    await expect(page.getByRole("menu", { name: "Window" })).toContainText("workpaper-a");
    await page.keyboard.press("Escape");
  });

  test("Edit > Copy and Paste act on the selected pages", async ({ page }) => {
    const thumbs = page.getByTestId("thumbs").getByTestId("thumb");
    await expect(thumbs).toHaveCount(3);
    await page.getByTestId("thumbs").getByRole("option", { name: "Page 2", exact: true }).click();
    await menu(page, "Edit", "Copy");
    await expect(page.getByText("Copied 1 page.")).toBeVisible();
    await menu(page, "Edit", "Paste");
    await expect(thumbs).toHaveCount(4);
  });

  test("Preferences has every category; units change Page properties", async ({ page }) => {
    const dlg = await openPreferences(page);
    for (const c of [
      "General",
      "Page Display",
      "Commenting",
      "Edit PDF",
      "Fonts",
      "PDFlyer",
      "Security",
      "Updates",
    ])
      await expect(dlg.getByRole("tab", { name: c, exact: true })).toBeVisible();
    await dlg.getByRole("tab", { name: "Page Display" }).click();
    await dlg.getByLabel("Units").selectOption("mm");
    await page.keyboard.press("Escape");
    await page
      .getByTestId("thumbs")
      .getByRole("option", { name: "Page 1", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Page properties…" }).click();
    await expect(page.getByTestId("page-properties")).toContainText("215.9 mm × 279.4 mm");
  });

  test("Alt+Q searches tools, commands, settings and help", async ({ page }) => {
    await page.keyboard.press("Alt+q");
    const box = page.getByRole("combobox", { name: /Search tools, commands and settings/ });
    await expect(box).toBeFocused();
    await box.fill("rotate right");
    const list = page.getByRole("listbox", { name: "Search results" });
    await expect(list.getByRole("option").first()).toContainText("Rotate right");
    await box.fill("units");
    await expect(list.getByRole("option").first()).toContainText("Setting");
    await page.keyboard.press("Enter");
    const dlg = page.getByRole("dialog", { name: "Preferences" });
    await expect(dlg.getByRole("tab", { name: "Page Display" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dlg.locator("[data-pref=units]")).toHaveClass(/found/);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+q");
    await box.fill("bates");
    await expect(list).toContainText("Help");
    // A menu command is shown in its menu (in its submenu), not run.
    const zoom = await page.getByLabel("Zoom percentage").inputValue();
    await box.fill("zoom in");
    await page.keyboard.press("Enter");
    const item = page
      .getByRole("menu", { name: "Zoom" })
      .getByRole("menuitem", { name: "Zoom in" });
    await expect(item).toHaveClass(/spotlight/);
    await expect(page.getByLabel("Zoom percentage")).toHaveValue(zoom);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // A tool button is pointed at, not pressed.
    await page.keyboard.press("Alt+q");
    await box.fill("rotate right");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Rotate right/ }).first()).toHaveClass(
      /spotlight/,
    );
    await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();
  });

  test("Help fits its window without a sideways scrollbar", async ({ page }) => {
    await page.keyboard.press("F1");
    const body = page.locator("dialog[open] .modal-body");
    await expect(page.getByTestId("help-page")).toBeVisible();
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test("the menu bar stays on screen in a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.keyboard.press("Alt+q");
    await page.getByRole("combobox", { name: /Search tools/ }).fill("print");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByTestId("top-bar-more").click();
    await page.keyboard.press("Escape");
    const file = page
      .getByRole("menubar", { name: "Menu bar" })
      .getByRole("menuitem", { name: "File", exact: true });
    await expect(file).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
  });

  test("F1 opens Help: one page per feature, with a filter", async ({ page }) => {
    await page.keyboard.press("F1");
    const dlg = page.getByRole("dialog", { name: "Help" });
    const topics = dlg.getByRole("navigation", { name: "Help topics" }).getByRole("listitem");
    expect(await topics.count()).toBeGreaterThanOrEqual(15);
    await dlg.getByLabel("Filter help topics").fill("redact");
    await topics.first().getByRole("button").click();
    await expect(dlg.getByTestId("help-page")).toContainText(/redact/i);
    await page.keyboard.press("Escape");
    await menu(page, "Help", "Help by feature", "Organizing pages");
    await expect(page.getByTestId("help-page")).toContainText(/Ctrl\+C|copy/i);
  });

  test("buttons show a tooltip with their shortcut", async ({ page }) => {
    await page.getByRole("button", { name: "Open (Ctrl+O)" }).hover();
    const tip = page.getByTestId("tooltip");
    await expect(tip).toContainText("Open");
    await expect(tip.locator("kbd")).toHaveText("Ctrl+O");
    // Every visible button has a name a tooltip or its own text can show.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button")]
        .filter((b) => b.offsetParent !== null)
        .filter(
          (b) =>
            !b.textContent?.trim() &&
            !b.getAttribute("aria-label") &&
            !b.getAttribute("title") &&
            !b.dataset.tip,
        )
        .map((b) => b.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });

  test("no tool is shown as coming in a later phase", async ({ page }) => {
    await expect(page.getByText(/coming in/i)).toHaveCount(0);
  });
});
