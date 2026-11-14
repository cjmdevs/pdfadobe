// B8: thumbnail panel mouse actions, page clipboard (copy / cut / paste across tabs),
// right-click page menu, drag feedback, Page properties, previous / next view.
import { inspectPdf } from "../helpers/pdf-inspect";
import {
  P,
  boot,
  bytesAt,
  currentPageNumber,
  expect,
  idle,
  openPaths,
  queueChoices,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

const thumb = (page: Page, n: number) =>
  page.getByTestId("thumbs").getByRole("option", { name: `Page ${n}`, exact: true });
const thumbs = (page: Page) => page.getByTestId("thumbs").getByTestId("thumb");
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open documents" });
const ids = (texts: string[]) =>
  texts.map((t) => /Workpaper (\w) - page (\d)/.exec(t)?.slice(1).join("") ?? "?");
const menuItem = (page: Page, name: string | RegExp) =>
  page.getByRole("menu", { name: "Page menu" }).getByRole("menuitem", { name });

async function open(page: Page, path: string) {
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
  await expect(thumbs(page).first()).toBeVisible();
}

async function saveAsPages(page: Page, mockfs: { entries: Record<string, unknown> }, to: string) {
  await queueChoices(page, { savePaths: [to] });
  await page.keyboard.press("Control+Shift+S");
  await expect.poll(() => mockfs.entries[to] !== undefined).toBe(true);
  return ids((await inspectPdf(new Uint8Array(bytesAt(mockfs as never, to)))).pageText);
}

test.describe("pages panel and page clipboard (B8)", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("click, Ctrl+click and Shift+click select pages", async ({ page }) => {
    await open(page, P.wpA);
    await thumb(page, 1).click();
    await thumb(page, 3).click({ modifiers: ["Shift"] });
    for (const n of [1, 2, 3])
      await expect(thumb(page, n)).toHaveAttribute("aria-selected", "true");
    await thumb(page, 2).click({ modifiers: ["Control"] });
    await expect(thumb(page, 2)).toHaveAttribute("aria-selected", "false");
    await expect(thumb(page, 3)).toHaveAttribute("aria-selected", "true");
  });

  test("right-click shows the page menu; Page properties shows the size", async ({ page }) => {
    await open(page, P.wpA);
    await thumb(page, 2).click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Page menu" })).toBeInViewport({ ratio: 1 });
    await expect(thumb(page, 2)).toHaveAttribute("aria-selected", "true");
    for (const name of [
      "Cut",
      "Copy",
      /^Paste before/,
      /^Paste after/,
      "Insert",
      "Delete page 2",
      "Extract to new file",
      "Replace…",
      "Rotate",
      "Page properties…",
    ])
      await expect(menuItem(page, name)).toBeVisible();
    await expect(menuItem(page, /^Paste after/)).toBeDisabled();
    await menuItem(page, "Page properties…").click();
    const props = page.getByTestId("page-properties");
    await expect(props).toContainText("2 of 3");
    await expect(props).toContainText("8.50 in × 11.00 in (Letter)");
    await expect(props).toContainText("Portrait");
  });

  test("copy in one tab and paste in another with Ctrl+C / Ctrl+V; Ctrl+Z undoes", async ({
    page,
    mockfs,
  }) => {
    await open(page, P.wpA);
    await thumb(page, 2).click();
    await page.keyboard.press("Control+c");
    await expect(page.getByText("Copied 1 page.")).toBeVisible();
    await open(page, P.wpB);
    await expect(tabs(page).getByRole("tab", { selected: true })).toContainText("workpaper-b");
    await thumb(page, 1).click();
    await page.keyboard.press("Control+v");
    await idle(page);
    await expect(thumbs(page)).toHaveCount(4);
    expect(await saveAsPages(page, mockfs, "C:\\Out\\b-pasted.pdf")).toEqual([
      "B1",
      "A2",
      "B2",
      "B3",
    ]);
    await page.keyboard.press("Control+z");
    await expect(thumbs(page)).toHaveCount(3);
  });

  test("cut from the menu removes pages; Paste before puts them back first", async ({
    page,
    mockfs,
  }) => {
    await open(page, P.wpA);
    await thumb(page, 3).click({ button: "right" });
    await menuItem(page, "Cut").click();
    await idle(page);
    await expect(thumbs(page)).toHaveCount(2);
    await thumb(page, 1).click({ button: "right" });
    await menuItem(page, /^Paste before \(1 page\)/).click();
    await idle(page);
    await expect(thumbs(page)).toHaveCount(3);
    expect(await saveAsPages(page, mockfs, "C:\\Out\\a-cut.pdf")).toEqual(["A3", "A1", "A2"]);
  });

  test("Delete key removes the selected pages; cutting every page is refused", async ({ page }) => {
    await open(page, P.wpA);
    await thumb(page, 1).click();
    await thumb(page, 2).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    await idle(page);
    await expect(thumbs(page)).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(thumbs(page)).toHaveCount(3);
    await thumb(page, 1).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+x");
    await expect(page.getByText(/cannot cut every page/)).toBeVisible();
    await expect(thumbs(page)).toHaveCount(3);
  });

  test("dragging shows a see-through preview and an insertion line, then moves", async ({
    page,
    mockfs,
  }) => {
    await open(page, P.wpA);
    const from = await thumb(page, 3).boundingBox();
    const to = await thumb(page, 1).boundingBox();
    if (!from || !to) throw new Error("no thumbnails");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 10, { steps: 8 });
    await expect(page.getByTestId("drag-ghost")).toBeVisible();
    expect(
      await page.getByTestId("drag-ghost").evaluate((el) => Number(getComputedStyle(el).opacity)),
    ).toBeLessThan(1);
    await expect(thumb(page, 1)).toHaveClass(/drop-before/);
    await page.mouse.up();
    await idle(page);
    await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
    expect(await saveAsPages(page, mockfs, "C:\\Out\\a-dragged.pdf")).toEqual(["A3", "A1", "A2"]);
  });

  test("Organize view has the same right-click menu and clipboard keys", async ({ page }) => {
    await open(page, P.wpA);
    await page.getByRole("button", { name: "Organize Pages", exact: true }).click();
    const grid = page.getByTestId("grid-page");
    await grid.nth(0).click({ button: "right" });
    await expect(menuItem(page, "Copy")).toBeVisible();
    await menuItem(page, "Copy").click();
    await expect(page.getByText("Copied 1 page.")).toBeVisible();
    await grid.nth(2).click();
    await page.keyboard.press("Control+v");
    await idle(page);
    await expect(grid).toHaveCount(4);
  });
});

test.describe("previous / next view (B8)", () => {
  test("Alt+Left / Alt+Right and the mouse back / forward buttons", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.nav]);
    await waitForPainted(page, 0);
    const box = page.getByLabel("Page number");
    await box.fill("5");
    await box.press("Enter");
    await expect.poll(() => currentPageNumber(page)).toBe(5);
    await page.waitForTimeout(600);
    await page.getByTestId("viewport").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(() => currentPageNumber(page)).toBe(1);
    await page.waitForTimeout(600);
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(() => currentPageNumber(page)).toBe(5);
    await page.waitForTimeout(600);
    const mouse = (button: number) =>
      page.evaluate((b) => {
        window.dispatchEvent(new MouseEvent("mousedown", { button: b, bubbles: true }));
        window.dispatchEvent(new MouseEvent("mouseup", { button: b, bubbles: true }));
      }, button);
    await mouse(3);
    await expect.poll(() => currentPageNumber(page)).toBe(1);
    await page.waitForTimeout(600);
    await mouse(4);
    await expect.poll(() => currentPageNumber(page)).toBe(5);
  });
});
