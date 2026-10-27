// Backlog B4: Acrobat-style workspace (docs/reference/acrobat-workspace.png): icon rail
// and panel, Tools pane, tool toolbar, customizable quick toolbar, firm default layout.
import { P, boot, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

const quick = (page: Page) => page.getByRole("group", { name: "Quick tools" }).getByRole("button");
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

  test("unbuilt tools are hidden unless asked for, then greyed with when they come", async ({
    page,
  }) => {
    await boot(page);
    const tools = page.getByRole("complementary", { name: "Tools pane" });
    await expect(tools.getByRole("button", { name: "Redact" })).toHaveCount(0);
    await tools.getByLabel("Show tools that are coming later").check();
    const redact = tools.getByRole("button", { name: "Redact" });
    await expect(redact).toBeDisabled();
    await expect(redact).toContainText("Coming in a later phase");
    await expect(tools.getByRole("button", { name: "Fill Forms" })).toBeDisabled();
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

  test("quick toolbar: remove, add, reorder; saved per user", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect(await quickNames(page)).toContain("Delete pages");
    await page.getByRole("button", { name: "Customize quick toolbar…" }).click();
    const dlg = page.getByRole("dialog", { name: "Customize quick toolbar" });
    await dlg.getByRole("button", { name: "Remove Delete pages" }).click();
    await dlg.getByRole("button", { name: "Add Duplicate pages" }).click();
    // Drag "Duplicate pages" (last) onto the first row.
    const pinned = dlg.getByTestId("pinned");
    await pinned.last().dragTo(pinned.first());
    await expect(pinned.first()).toContainText("Duplicate pages");
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    const names = await quickNames(page);
    expect(names[0]).toBe("Duplicate pages");
    expect(names).not.toContain("Delete pages");
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached();
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect((await quickNames(page))[0]).toBe("Duplicate pages");
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
    await page.getByRole("button", { name: "Customize quick toolbar…" }).click();
    const dlg = page.getByRole("dialog", { name: "Customize quick toolbar" });
    await dlg.getByLabel("Firm layout file").fill(LAYOUT);
    await dlg.getByRole("button", { name: "Load firm default" }).click();
    await expect(dlg.getByTestId("customize-note")).toContainText("Loaded the firm default (2");
    await dlg.getByRole("button", { name: "Use firm default" }).click();
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    expect(await quickNames(page)).toEqual(["Extract to new file", "Fit page (Ctrl+0)"]);

    // Next start: the share is offline. The cached copy still applies, with a notice.
    mockfs.entries[LAYOUT] = { error: "network", message: "The network path was not found." };
    await page.reload();
    await expect(page.getByText("using the last copy")).toBeVisible();
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect(await quickNames(page)).toEqual(["Extract to new file", "Fit page (Ctrl+0)"]);
  });

  test("save the current toolbar as the firm default file", async ({ page, mockfs }) => {
    await boot(page);
    await page.getByRole("button", { name: "Customize quick toolbar…" }).click();
    const dlg = page.getByRole("dialog", { name: "Customize quick toolbar" });
    await dlg.getByLabel("Firm layout file").fill(LAYOUT);
    await dlg.getByRole("button", { name: "Save this toolbar as the firm default" }).click();
    await expect(dlg.getByTestId("customize-note")).toContainText("Saved");
    const e = mockfs.entries[LAYOUT];
    expect(e && "bytes" in e && JSON.parse(e.bytes.toString()).version).toBe(1);
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
