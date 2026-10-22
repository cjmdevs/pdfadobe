// Phase 2: bookmark editor and bookmark-driven page operations (navigation.pdf:
// Cover p1 | Part I - Sizes p2 (Legal p3, A4 p4 > Landscape p5) | Part II - Schedules p7
// (Schedule B p8)). Results are checked in the saved file with qpdf + pdf.js.
import { inspectPdf, outlineLines } from "../helpers/pdf-inspect";
import {
  P,
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  queueChoices,
  test,
  waitForPainted,
  type MockFs,
  type Page,
} from "./fixtures";

const OUT = "C:\\Out\\navigation-edited.pdf";
const row = (page: Page, title: string) =>
  page
    .getByTestId("bookmark")
    .filter({ has: page.getByRole("button", { name: title, exact: true }) });

async function saveAndInspect(page: Page, mockfs: MockFs) {
  await queueChoices(page, { savePaths: [OUT] });
  await page.keyboard.press("Control+Shift+S");
  await expect.poll(() => mockfs.writes.some((w) => w.path === OUT)).toBe(true);
  return inspectPdf(new Uint8Array(bytesAt(mockfs, OUT)));
}

test.describe("bookmark editor", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.nav]);
    await waitForPainted(page, 0);
    await page.getByRole("tab", { name: "Bookmarks" }).click();
    await expect(row(page, "Cover")).toBeVisible();
  });

  test("dragging a bookmark moves its pages and child bookmarks", async ({ page, mockfs }) => {
    const before = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.nav)));
    // Drop "Part II" on the top edge of "Part I" = before it.
    await row(page, "Part II - Schedules").dragTo(row(page, "Part I - Sizes"), {
      targetPosition: { x: 40, y: 1 },
    });
    await idle(page);
    await expect(row(page, "Part II - Schedules")).toHaveAttribute("data-path", "1");
    const saved = await saveAndInspect(page, mockfs);
    expect(saved.checkError).toBeNull();
    expect(saved.pages).toBe(8);
    expect(outlineLines(saved.outline)).toEqual([
      "Cover@1",
      "Part II - Schedules@2",
      ".Schedule B@3",
      "Part I - Sizes@4",
      ".Legal page@5",
      ".A4 page@6",
      "..Landscape page@7",
    ]);
    // Old pages 7-8 (the schedules) now follow the cover.
    expect(saved.pageText.slice(0, 3)).toEqual([
      before.pageText[0],
      before.pageText[6],
      before.pageText[7],
    ]);
  });

  test("with page moving off, dragging only nests the bookmark", async ({ page, mockfs }) => {
    await page.getByLabel("Dragging a bookmark moves its pages").uncheck();
    // Drop "Cover" in the middle of "Part II" = as its child.
    await row(page, "Cover").dragTo(row(page, "Part II - Schedules"), {
      targetPosition: { x: 40, y: 10 },
    });
    await idle(page);
    const saved = await saveAndInspect(page, mockfs);
    expect(outlineLines(saved.outline)).toEqual([
      "Part I - Sizes@2",
      ".Legal page@3",
      ".A4 page@4",
      "..Landscape page@5",
      "Part II - Schedules@7",
      ".Schedule B@8",
      ".Cover@1",
    ]);
  });

  test("delete a bookmark together with its pages; undo restores", async ({ page, mockfs }) => {
    await row(page, "Part I - Sizes").getByRole("button").last().click();
    await page.getByRole("button", { name: "Delete bookmark and its pages…" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete bookmark and pages" });
    await expect(confirm).toContainText("5 page(s) (pages 2-6)");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await idle(page);
    await expect(row(page, "Part I - Sizes")).toHaveCount(0);
    await expect(page.getByLabel("Page number")).toBeVisible();
    const saved = await saveAndInspect(page, mockfs);
    expect(saved.pages).toBe(3); // pages 2-6 went with the bookmark
    expect(outlineLines(saved.outline)).toEqual([
      "Cover@1",
      "Part II - Schedules@2",
      ".Schedule B@3",
    ]);
    await page.keyboard.press("Control+z");
    await expect(row(page, "Part I - Sizes")).toBeVisible();
  });

  test("extract a bookmark's pages to a new tab", async ({ page }) => {
    await row(page, "Part II - Schedules").getByRole("button").last().click();
    await page.getByRole("button", { name: "Extract bookmark's pages to new file" }).click();
    await expect(
      page.getByRole("tab", { name: /navigation - Part II - Schedules\.pdf/ }),
    ).toBeVisible();
    await expect(page.locator("#page-input, [aria-label='Page number']").first()).toBeVisible();
    await expect(row(page, "Part II - Schedules")).toHaveAttribute("data-path", "0");
    await expect(row(page, "Schedule B")).toBeVisible();
  });

  test("rename with F2, add from current view, set destination, bookmark every page", async ({
    page,
    mockfs,
  }) => {
    await row(page, "Cover").getByRole("button", { name: "Cover", exact: true }).click();
    await page.keyboard.press("F2");
    await page.getByLabel("Bookmark name").fill("Engagement letter");
    await page.keyboard.press("Enter");
    await idle(page);
    await expect(row(page, "Engagement letter")).toBeVisible();

    // New bookmark from the current view, inserted after the selected one.
    await page.getByLabel("Page number").fill("5");
    await page.getByLabel("Page number").press("Enter");
    await waitForPainted(page, 4);
    await page.getByRole("button", { name: /^New bookmark/ }).click();
    await idle(page);
    await expect(row(page, "Untitled")).toHaveAttribute("data-path", "1");

    // Point "Engagement letter" at page 3: select it (jumps to page 1), go to 3, set.
    await row(page, "Engagement letter").getByRole("button", { name: "Engagement letter" }).click();
    await page.getByLabel("Page number").fill("3");
    await page.getByLabel("Page number").press("Enter");
    await waitForPainted(page, 2);
    await page.getByRole("button", { name: "Set destination to current view" }).click();
    await idle(page);

    const saved = await saveAndInspect(page, mockfs);
    expect(outlineLines(saved.outline).slice(0, 2)).toEqual(["Engagement letter@3", "Untitled@5"]);

    await page.getByRole("button", { name: "More bookmark options" }).click();
    await page.getByRole("menuitem", { name: "Bookmark every page" }).click();
    await page
      .getByRole("dialog", { name: "Bookmark every page" })
      .getByRole("button", { name: "Replace" })
      .click();
    await idle(page);
    await expect(page.getByTestId("bookmark")).toHaveCount(8);
    await expect(row(page, "Page 8")).toBeVisible();
  });
});
