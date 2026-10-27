// B3 Edit PDF in the reader: outlines and selection (U1), in-place text editing with
// commit on Escape / a click elsewhere / Ctrl+S, one undo step per edit, refusals, and
// Add Text (U2). Saved files are read back with pdf.js (no PDFium code).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pdfjsView } from "../helpers/leak-scan";
import {
  P,
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  test,
  waitForPainted,
  type MockFs,
  type Page,
} from "./fixtures";

const MEMO = "C:\\Corpus\\memo.pdf";
const EDIT_SAMPLES = join(import.meta.dirname, "..", "corpus", "edit");

const box = (page: Page, start: string) =>
  page.locator(`[data-testid=edit-box][data-text^="${start}"]`);
const editor = (page: Page) => page.getByTestId("edit-editor");
const toolbarButton = (page: Page, name: string) =>
  page.getByTestId("tool-toolbar").getByRole("button", { name, exact: false });

async function openEdit(page: Page) {
  await openPaths(page, [MEMO]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
  await expect(page.getByTestId("tool-toolbar")).toHaveAttribute("aria-label", "Edit PDF");
  await expect(box(page, "MEMORANDUM")).toBeVisible();
}

async function center(page: Page, start: string) {
  const b = (await box(page, start).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as const;
}

/** Waits for an edit to finish and the reloaded tab to show its outlines again. */
async function settled(page: Page) {
  await idle(page);
  await expect(page.getByTestId("edit-layer")).toBeVisible();
}

async function pageBox(page: Page) {
  return (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
}

/** Ctrl+S, then the saved file's text as pdf.js reads it. */
async function savedText(page: Page, mockfs: MockFs) {
  const writes = mockfs.writes.length;
  await page.keyboard.press("Control+s");
  await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
  const view = await pdfjsView(new Uint8Array(bytesAt(mockfs, MEMO)));
  return view.pageText[0] ?? "";
}

test.describe("Edit PDF", () => {
  test.beforeEach(async ({ page, mockfs }) => {
    mockfs.entries[MEMO] = { bytes: readFileSync(join(EDIT_SAMPLES, "memo.pdf")) };
    await boot(page);
  });

  test("outlines every text box; Edit mode is on when the tool opens", async ({ page }) => {
    await openEdit(page);
    await expect(toolbarButton(page, "Edit text and images")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The memo groups into 6 boxes: heading, the label column, the value column, two
    // body paragraphs, the bullet list.
    await expect(page.getByTestId("edit-box")).toHaveCount(6);
    await expect(page.getByTestId("edit-panel")).toContainText("Click text to edit it");
  });

  test("hover highlights; a click opens the editor; Escape leaves it, then the tool", async ({
    page,
  }) => {
    await openEdit(page);
    const [x, y] = await center(page, "We selected sales");
    await page.mouse.move(x, y);
    await expect(box(page, "We selected sales")).toHaveClass(/hover/);
    await page.mouse.click(x, y);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue(/^We selected sales invoices/);
    await expect(page.getByTestId("edit-selection")).toContainText("Text box on page 1");

    // Unchanged text: Escape just closes the editor (no edit, no reload).
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    await expect(box(page, "We selected sales")).toHaveClass(/selected/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid=edit-box].selected")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
    await expect(page.getByTestId("tool-toolbar")).toHaveCount(0);
  });

  test("edit, Escape commits, one undo step, Ctrl+S saves the new text", async ({
    page,
    mockfs,
  }) => {
    await openEdit(page);
    const [x, y] = await center(page, "Two invoices dated");
    await page.mouse.click(x, y);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Reviewed with the controller.");
    await page.keyboard.press("Escape");
    await settled(page);
    // The reloaded page shows the exact PDF result, and the edited box is selected.
    await expect(box(page, "Two invoices dated")).toHaveClass(/selected/);
    expect(await savedText(page, mockfs)).toContain("Reviewed with the controller.");

    // One undo step brings the old text back.
    await page.keyboard.press("Control+z");
    await settled(page);
    expect(await savedText(page, mockfs)).not.toContain("Reviewed with the controller.");
    await page.keyboard.press("Control+y");
    await settled(page);
    expect(await savedText(page, mockfs)).toContain("Reviewed with the controller.");
  });

  test("a click elsewhere commits; Ctrl+S while typing saves the typed text", async ({
    page,
    mockfs,
  }) => {
    await openEdit(page);
    let [x, y] = await center(page, "MEMORANDUM");
    await page.mouse.click(x, y);
    // Letters the heading's embedded bold subset has (the memo embeds subsets).
    await page.keyboard.press("End");
    await page.keyboard.type(" DRAFT");
    const pb = await pageBox(page);
    await page.mouse.click(pb.x + pb.width - 10, y);
    await settled(page);
    await expect(box(page, "MEMORANDUM DRAFT")).toBeVisible();

    [x, y] = await center(page, "We selected sales");
    await page.mouse.click(x, y);
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" See AJE-07.");
    const writes = mockfs.writes.length;
    await page.keyboard.press("Control+s");
    await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
    const text = (await pdfjsView(new Uint8Array(bytesAt(mockfs, MEMO)))).pageText[0] ?? "";
    expect(text).toContain("See AJE-07.");
    expect(text).toContain("MEMORANDUM DRAFT");
  });

  test("letters the font can't show are refused and nothing changes", async ({ page }) => {
    await openEdit(page);
    const [x, y] = await center(page, "MEMORANDUM");
    await page.mouse.click(x, y);
    await page.keyboard.press("End");
    await page.keyboard.type(" \u4e2d");
    await page.keyboard.press("Escape");
    await expect(page.locator(".toast.error")).toContainText("Edit text failed");
    await expect(page.locator(".toast.error")).toContainText("\u4e2d");
    await settled(page);
    await expect(box(page, "MEMORANDUM")).toHaveAttribute("data-text", "MEMORANDUM");
  });

  test("Add Text: a click places a line, a drag sets the wrap width", async ({ page, mockfs }) => {
    await openEdit(page);
    await toolbarButton(page, "Add text").click();
    await expect(toolbarButton(page, "Add text")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-hint")).toContainText("Click on the page");

    // Empty page below the memo, inside the visible part of the page (the page box is
    // taller than the viewport at fit-width).
    const pb = await pageBox(page);
    await page.mouse.click(pb.x + pb.width * 0.15, pb.y + pb.height * 0.5);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("Reviewed: AB 02/10/2025");
    await page.keyboard.press("Escape");
    await settled(page);
    await expect(box(page, "Reviewed: AB 02/10/2025")).toBeVisible();
    await expect(toolbarButton(page, "Add text")).toHaveAttribute("aria-pressed", "false");

    // Drag: the new text wraps at the dragged width.
    await toolbarButton(page, "Add text").click();
    const y = pb.y + pb.height * 0.56;
    await page.mouse.move(pb.x + pb.width * 0.15, y);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width * 0.35, y + 10, { steps: 4 });
    await page.mouse.up();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("Agreed to the invoice and traced to the general ledger.");
    await page.keyboard.press("Escape");
    await settled(page);
    const added = box(page, "Agreed to the invoice");
    await expect(added).toBeVisible();
    const b = (await added.boundingBox())!;
    expect(b.width).toBeLessThan(pb.width * 0.25);
    expect(b.height).toBeGreaterThan(20); // more than one line

    const text = (await savedText(page, mockfs)).replace(/\s+/g, "");
    expect(text).toContain("Reviewed:AB02/10/2025");
    expect(text).toContain("Agreedtotheinvoiceandtracedtothegeneralledger.");
  });

  test("Escape cancels Add Text before placing", async ({ page }) => {
    await openEdit(page);
    await toolbarButton(page, "Add text").click();
    await page.keyboard.press("Escape");
    await expect(toolbarButton(page, "Add text")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edit-layer")).toBeVisible();
  });

  test("the Edit button turns outlines off and on; Comment tools take over", async ({ page }) => {
    await openEdit(page);
    const editBtn = toolbarButton(page, "Edit text and images");
    await editBtn.click();
    await expect(editBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
    await editBtn.click();
    await expect(page.getByTestId("edit-layer")).toBeVisible();
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
  });

  test("encrypted documents can't be edited", async ({ page }) => {
    await openPaths(page, [P.encrypted]);
    await page.getByLabel("Document password").fill("corpus-user");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
    await expect(toolbarButton(page, "Edit text and images")).toBeDisabled();
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
  });
});
