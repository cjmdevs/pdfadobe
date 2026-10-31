// Phase 7: Header & Footer and Watermark from the Edit PDF toolbar, Background and Bates
// from its More menu. Each is one undo step on the open file; Remove takes it out;
// Bates across two files writes _Bates copies with the numbers running on.
import { join } from "node:path";
import {
  CORPUS,
  P,
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  queueChoices,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

const editBar = (page: Page) => page.getByTestId("tool-toolbar");

async function openEdit(page: Page, path: string) {
  await boot(page);
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
}

/** Opens a toolbar button's menu (its arrow) and picks `item`. */
async function menu(page: Page, button: string, item: string) {
  await editBar(page)
    .getByRole("button", { name: `${button}: choose` })
    .click();
  await page.getByRole("menuitemradio", { name: item }).click();
}

/** More > `sub` > `item`. */
async function more(page: Page, sub: string, item: string) {
  await editBar(page).getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: sub }).hover();
  await page.getByRole("menuitemradio", { name: item }).click();
}

async function find(page: Page, text: string) {
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find text").fill(text);
  await page.getByLabel("Find text").press("Enter");
}

test("header & footer: page numbers added, searchable, removed", async ({ page }) => {
  await openEdit(page, P.nav);
  await menu(page, "Header & Footer", "Add…");
  const dlg = page.getByTestId("header-footer-dialog");
  await expect(dlg.getByTestId("decorate-preview")).toHaveText("First page: Page 1 of 8");
  await dlg.getByLabel("Left header").click();
  await dlg.getByRole("button", { name: "File Name" }).click();
  await dlg.getByRole("button", { name: "Apply" }).click();
  await idle(page);
  await find(page, "Page 6 of 8");
  await expect(page.getByTestId("search-summary")).toHaveText(/1 of 1 matches/);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeEnabled();

  await page.keyboard.press("Escape");
  await menu(page, "Header & Footer", "Remove");
  await idle(page);
  await find(page, "Page 6 of 8");
  await expect(page.getByTestId("search-summary")).toHaveText(/No matches|0 matches/);
});

test("watermark and background from the Edit toolbar", async ({ page }) => {
  await openEdit(page, P.text);
  await menu(page, "Watermark", "Add…");
  const wm = page.getByTestId("watermark-dialog");
  await wm.getByLabel("Watermark text").fill("CONFIDENTIAL");
  await wm.getByRole("button", { name: "Apply" }).click();
  await idle(page);
  await find(page, "CONFIDENTIAL");
  await expect(page.getByTestId("search-summary")).toHaveText(/1 of 1 matches/);

  await page.keyboard.press("Escape");
  await more(page, "Background", "Add…");
  await page.getByTestId("background-dialog").getByRole("button", { name: "Apply" }).click();
  await idle(page);
  // Two undo steps: background, then watermark.
  await page.keyboard.press("Control+z");
  await idle(page);
  await page.keyboard.press("Control+z");
  await idle(page);
  await find(page, "CONFIDENTIAL");
  await expect(page.getByTestId("search-summary")).toHaveText(/No matches|0 matches/);
});

test("Bates numbering across two files writes _Bates copies", async ({ page, mockfs }) => {
  await openEdit(page, P.nav);
  await queueChoices(page, { savePaths: ["C:\\Out\\workpaper-b_Bates.pdf"] });
  await more(page, "Bates Numbering", "Add…");
  const dlg = page.getByTestId("bates-dialog");
  await dlg.getByLabel("Prefix").fill("MGR");
  const chooser = page.waitForEvent("filechooser");
  await dlg.getByRole("button", { name: "Add Files…" }).click();
  await (await chooser).setFiles(join(CORPUS, "workpaper-b.pdf"));
  await expect(dlg.locator(".bates-files li")).toHaveCount(2);
  await expect(dlg.getByTestId("decorate-preview")).toHaveText("First page: MGR000001");
  await dlg.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".toast", { hasText: "Bates numbered 2 files" })).toContainText(
    "MGR000001 to MGR000011",
  );
  const written = mockfs.writes.map((w) => w.path);
  expect(written).toEqual(["C:\\Corpus\\navigation_Bates.pdf", "C:\\Out\\workpaper-b_Bates.pdf"]);
  expect(bytesAt(mockfs, written[0]!).subarray(0, 4).toString()).toBe("%PDF");
});
