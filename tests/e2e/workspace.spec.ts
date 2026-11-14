// Backlog B4: Acrobat-style workspace (docs/reference/acrobat-workspace.png): icon rail
// and panel, Tools pane, tool toolbar, customizable quick toolbar, firm default layout.
import { P, boot, expect, menu, openPaths, test, waitForPainted, type Page } from "./fixtures";

/** Tool actions on the top bar (their slots are named "tool.action"). */
const quick = (page: Page) => page.locator('[data-testid=top-bar] [data-slot*="."] button.tool');
const quickNames = async (page: Page) =>
  (await quick(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map(
    (n) => n.replace(/: .*$/, ""),
  );
const LAYOUT = "\\\\localhost\\Share\\PDFWorkbench\\layout.json";

test.describe("workspace", () => {
  test("left rail opens and closes its panel; Tools pane searches and hides", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.nav]);
    await waitForPainted(page, 0);
    const pane = page.getByRole("complementary", { name: "Navigation pane" });
    await page.getByRole("tab", { name: "Bookmarks" }).click();
    await expect(pane.getByRole("heading", { name: "Bookmarks" })).toBeVisible();
    await page.getByRole("tab", { name: "Bookmarks" }).click(); // same icon closes
    await expect(pane).toHaveCount(0);
    await page.getByRole("tab", { name: "Attachments" }).click();
    await expect(pane.getByRole("heading", { name: "Attachments" })).toBeVisible();
    await pane.getByRole("button", { name: "Close pane (F4)" }).click();
    await expect(pane).toHaveCount(0);

    const tools = page.getByRole("complementary", { name: "Tools pane" });
    await tools.getByLabel("Search tools").fill("comb");
    await expect(tools.getByRole("button", { name: "Combine Files" })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Organize Pages" })).toHaveCount(0);
    await tools.getByRole("button", { name: "Hide tools pane" }).click();
    await expect(tools).toHaveCount(0);
    await page.getByRole("button", { name: "Tools pane" }).click();
    await expect(page.getByRole("complementary", { name: "Tools pane" })).toBeVisible();
  });

  test("no placeholders (B8): no coming-later tools or setting", async ({ page }) => {
    await boot(page);
    const tools = page.getByRole("complementary", { name: "Tools pane" });
    await expect(tools.getByRole("button", { name: "Protect", exact: true })).toHaveCount(1);
    await expect(tools.getByText(/coming later/i)).toHaveCount(0);
    await expect(tools.getByText(/Coming in/)).toHaveCount(0);
  });

  test("a tool opens its own toolbar above the page and closes again", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Organize Pages", exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "Organize Pages" });
    for (const name of ["Insert", "Extract", "Replace", "Split", "Rotate left", "Delete"]) {
      await expect(bar.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("organize")).toBeVisible();
    await bar.getByRole("button", { name: "Close Organize Pages" }).click();
    await expect(page.getByTestId("tool-toolbar")).toHaveCount(0);
    await expect(page.getByTestId("organize")).toHaveCount(0);
  });

  test("top bar: hide, add, reorder, move into a menu; saved per user (B8)", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect(await quickNames(page)).toContain("Delete pages");
    await menu(page, "Window", "Customize top bar…");
    const dlg = page.getByRole("dialog", { name: "Customize top bar" });
    const save = dlg.locator("button[type=submit]");
    await expect(save).toBeDisabled();
    const strip = dlg.getByRole("list", { name: "Top bar items" });
    const placeSel = dlg.getByLabel("Put the picked item in");
    // Hide a tool action.
    await strip.getByRole("button", { name: "Delete pages", exact: true }).click();
    await placeSel.selectOption("hidden");
    await expect(strip.getByRole("button", { name: "Delete pages", exact: true })).toHaveCount(0);
    // Add one, drag it to the front, move it right and back, a divider after it.
    await dlg.getByRole("button", { name: "Organize Pages" }).click();
    await dlg.getByRole("button", { name: "Duplicate pages", exact: true }).click();
    await dlg.getByRole("button", { name: "Add Duplicate pages" }).click();
    const pinned = dlg.getByTestId("pinned");
    const dup = strip.getByRole("button", { name: "Duplicate pages" });
    await dup.dragTo(pinned.first(), { targetPosition: { x: 2, y: 10 } });
    await expect(pinned.first().getByRole("button")).toHaveAccessibleName("Duplicate pages");
    await expect(dup).toHaveAttribute("aria-pressed", "true");
    await dlg.getByRole("button", { name: "Move right" }).click();
    await expect(pinned.nth(1).getByRole("button")).toHaveAccessibleName("Duplicate pages");
    await dlg.getByRole("button", { name: "Move left" }).click();
    await dlg.getByRole("button", { name: "Add divider" }).click();
    await expect(pinned.nth(1).getByRole("button")).toHaveAccessibleName("Divider");
    // A built-in item into a menu, another one hidden.
    await dlg.getByLabel("Where Hand tool goes").selectOption("file");
    await strip.getByRole("button", { name: "Print", exact: true }).click();
    await placeSel.selectOption("hidden");
    await save.click();
    const names = await quickNames(page);
    expect(names[0]).toBe("Duplicate pages");
    expect(names).not.toContain("Delete pages");
    await expect(page.getByRole("button", { name: "Print (Ctrl+P)" })).toHaveCount(0);
    await menu(page, "File");
    await expect(page.getByRole("menu", { name: "File" })).toContainText("Hand tool");
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached();
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect((await quickNames(page))[0]).toBe("Duplicate pages");
    // Reset to default brings everything back.
    await menu(page, "Window", "Reset top bar");
    await expect(page.getByRole("button", { name: "Print (Ctrl+P)" })).toBeVisible();
    expect(await quickNames(page)).toContain("Delete pages");
  });

  test("a narrow window moves what does not fit into the » menu (B8)", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    await page.setViewportSize({ width: 900, height: 720 });
    const more = page.getByTestId("top-bar-more");
    await expect(more).toBeVisible();
    // Tools go first; the file buttons stay.
    await expect(page.getByRole("button", { name: "Open (Ctrl+O)" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Delete pages/ })).toHaveCount(0);
    await more.click();
    await page
      .getByRole("menu", { name: "More tools" })
      .getByRole("menuitem", { name: "Delete pages" })
      .click();
    await expect(page.getByRole("dialog", { name: "Delete pages" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(more).toHaveCount(0);
  });

  test("firm default layout loads from the share; the last copy is used when offline", async ({
    page,
    mockfs,
  }) => {
    mockfs.entries[LAYOUT] = {
      bytes: Buffer.from(
        JSON.stringify({ version: 1, quickToolbar: ["organize.extract", "view.fitPage"] }),
      ),
    };
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    await menu(page, "Window", "Customize top bar…");
    const dlg = page.getByRole("dialog", { name: "Customize top bar" });
    await dlg.getByText("Firm default", { exact: true }).click();
    await dlg.getByLabel("Firm layout file").fill(LAYOUT);
    await dlg.getByRole("button", { name: "Load firm default" }).click();
    await expect(dlg.getByTestId("customize-note")).toContainText("Loaded the firm default");
    await dlg.getByRole("button", { name: "Reset to default" }).click();
    await dlg.locator("button[type=submit]").click();
    expect(await quickNames(page)).toEqual(["Extract to new file", "Fit page (Ctrl+0)"]);

    // Next start: the share is offline. The cached copy still applies, with a notice.
    mockfs.entries[LAYOUT] = { error: "network", message: "The network path was not found." };
    await page.reload();
    await expect(page.getByText("using the last copy")).toBeVisible();
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect(await quickNames(page)).toEqual(["Extract to new file", "Fit page (Ctrl+0)"]);
  });

  test("save the current top bar as the firm default file", async ({ page, mockfs }) => {
    await boot(page);
    await menu(page, "Window", "Customize top bar…");
    const dlg = page.getByRole("dialog", { name: "Customize top bar" });
    await dlg.getByText("Firm default", { exact: true }).click();
    await dlg.getByLabel("Firm layout file").fill(LAYOUT);
    await dlg.getByRole("button", { name: "Save this top bar as the firm default" }).click();
    await expect(dlg.getByTestId("customize-note")).toContainText("Saved");
    const e = mockfs.entries[LAYOUT];
    const json = e && "bytes" in e ? JSON.parse(e.bytes.toString()) : null;
    // Version 1 (older copies still read the quick tools), plus the whole top bar.
    expect(json.version).toBe(1);
    expect(json.quickToolbar).toContain("organize.delete");
    expect(json.topBar.bar).toContain("bar:open");
  });

  test("quick-toolbar Delete asks first; the bookmark toolbar matches the reference", async ({
    page,
  }) => {
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Delete pages: page 1" }).click();
    const ask = page.getByRole("dialog", { name: "Delete pages" });
    await expect(ask).toContainText("Delete page 1?");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("page-count")).toHaveText("/ 3");

    await page.getByRole("tab", { name: "Bookmarks" }).click();
    const bm = page.getByRole("toolbar", { name: "Bookmarks" });
    for (const name of [
      "Bookmark options",
      "Delete bookmark (Del)",
      "New bookmark (current view)",
      "New bookmark from selected text",
    ]) {
      await expect(bm.getByRole("button", { name })).toBeVisible();
    }
    await bm.getByRole("button", { name: "New bookmark from selected text" }).click();
    await expect(page.getByText("Select text on the page first")).toBeVisible();
  });
});
