// B3 Edit PDF, step U1: the Edit tool outlines text boxes and images, hover and click
// select, Escape clears the selection and then closes the tool.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { P, boot, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

const MEMO = "C:\\Corpus\\memo.pdf";
const EDIT_SAMPLES = join(import.meta.dirname, "..", "corpus", "edit");

const box = (page: Page, start: string) =>
  page.locator(`[data-testid=edit-box][data-text^="${start}"]`);

async function openEdit(page: Page) {
  await openPaths(page, [MEMO]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
  await expect(page.getByTestId("tool-toolbar")).toHaveAttribute("aria-label", "Edit PDF");
  await expect(page.getByTestId("edit-layer")).toBeVisible();
}

async function center(page: Page, start: string) {
  const b = (await box(page, start).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as const;
}

test.describe("Edit PDF", () => {
  test.beforeEach(async ({ page, mockfs }) => {
    mockfs.entries[MEMO] = { bytes: readFileSync(join(EDIT_SAMPLES, "memo.pdf")) };
    await boot(page);
  });

  test("outlines every text box; Edit mode is on when the tool opens", async ({ page }) => {
    await openEdit(page);
    await expect(
      page.getByTestId("tool-toolbar").getByRole("button", { name: "Edit text and images" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The memo groups into 6 boxes: heading, the label column, the value column, two
    // body paragraphs, the bullet list.
    await expect(page.getByTestId("edit-box")).toHaveCount(6);
    await expect(box(page, "MEMORANDUM")).toBeVisible();
    await expect(page.getByTestId("edit-panel")).toContainText("Click text or an image");
  });

  test("hover highlights, click selects, empty page clears", async ({ page }) => {
    await openEdit(page);
    const [x, y] = await center(page, "We selected sales");
    await page.mouse.move(x, y);
    await expect(box(page, "We selected sales")).toHaveClass(/hover/);
    await page.mouse.click(x, y);
    await expect(box(page, "We selected sales")).toHaveClass(/selected/);
    await expect(page.getByTestId("edit-selection")).toContainText("Text box on page 1");
    await expect(page.getByTestId("edit-selection")).toContainText("We selected sales");

    // Another box takes the selection.
    const [x2, y2] = await center(page, "MEMORANDUM");
    await page.mouse.click(x2, y2);
    await expect(box(page, "MEMORANDUM")).toHaveClass(/selected/);
    await expect(box(page, "We selected sales")).not.toHaveClass(/selected/);

    // Empty page (right margin) clears it.
    const pageBox = (await page
      .locator('[data-testid=viewport] [data-page-index="0"]')
      .boundingBox())!;
    await page.mouse.click(pageBox.x + pageBox.width - 8, y);
    await expect(page.locator("[data-testid=edit-box].selected")).toHaveCount(0);
    await expect(page.getByTestId("edit-selection")).toHaveCount(0);
  });

  test("Escape clears the selection, then closes the tool", async ({ page }) => {
    await openEdit(page);
    const [x, y] = await center(page, "Two invoices dated");
    await page.mouse.click(x, y);
    await expect(box(page, "Two invoices dated")).toHaveClass(/selected/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid=edit-box].selected")).toHaveCount(0);
    await expect(page.getByTestId("edit-layer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
    await expect(page.getByTestId("tool-toolbar")).toHaveCount(0);
  });

  test("the Edit button turns outlines off and on; Comment tools take over", async ({ page }) => {
    await openEdit(page);
    const editBtn = page
      .getByTestId("tool-toolbar")
      .getByRole("button", { name: "Edit text and images" });
    await editBtn.click();
    await expect(editBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
    await editBtn.click();
    await expect(page.getByTestId("edit-layer")).toBeVisible();
    // Opening Comment closes Edit PDF and its outlines.
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
  });

  test("encrypted documents can't be edited", async ({ page }) => {
    await openPaths(page, [P.encrypted]);
    await page.getByLabel("Document password").fill("corpus-user");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
    await expect(
      page.getByTestId("tool-toolbar").getByRole("button", { name: "Edit text and images" }),
    ).toBeDisabled();
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
  });
});
