// Phase 7: Scan & OCR. Recognize Text makes the synthetic scan searchable (one undo
// step), and Recognize Text in a Folder writes <name>_OCR.pdf beside each original.
import {
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  queueChoices,
  test,
  waitForPainted,
} from "./fixtures";

const SCAN = "C:\\Scans\\scanned-image-only.pdf";
const SCAN2 = "C:\\Scans\\second scan.pdf";

test("Recognize Text makes a scan searchable; a second run leaves it alone", async ({
  page,
  mockfs,
}) => {
  mockfs.entries[SCAN] = { file: "scanned-image-only.pdf" };
  await boot(page);
  await openPaths(page, [SCAN]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Scan & OCR", exact: true }).click();
  const toolbar = page.getByTestId("tool-toolbar");
  for (const name of [
    "Insert",
    "Recognize Text",
    "Extract",
    "Rotate left",
    "Rotate right",
    "Delete",
  ])
    await expect(toolbar.getByText(new RegExp(`^${name}( ▾)?$`))).toBeVisible();

  const panel = page.getByTestId("scan-panel");
  await panel.getByRole("button", { name: "Recognize Text", exact: true }).click();
  await expect(panel.getByTestId("ocr-outcome")).toHaveText("Read 1 page.", { timeout: 60_000 });
  await idle(page);

  const find = async () => {
    await page.keyboard.press("Control+f");
    await page.getByLabel("Find text").fill("Engagement Memo");
    await page.getByLabel("Find text").press("Enter");
  };
  await find();
  await expect(page.getByTestId("search-summary")).toHaveText(/1 of 1 matches/);

  // Again: the page has text now, so it is skipped and nothing changes.
  await panel.getByRole("button", { name: "Recognize Text", exact: true }).click();
  await expect(panel.getByTestId("ocr-outcome")).toContainText("1 page already had text");
  expect(mockfs.writes).toEqual([]);
});

test("Recognize Text in a Folder writes _OCR files beside the originals", async ({
  page,
  mockfs,
}) => {
  mockfs.entries[SCAN] = { file: "scanned-image-only.pdf" };
  mockfs.entries[SCAN2] = { file: "scanned-image-only.pdf" };
  mockfs.entries["C:\\Scans\\has-text.pdf"] = { file: "text-1p.pdf" };
  await boot(page);
  await queueChoices(page, { folders: ["C:\\Scans"] });
  await openPaths(page, [SCAN]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Scan & OCR", exact: true }).click();
  await page
    .getByTestId("scan-panel")
    .getByRole("button", { name: /in a Folder/ })
    .click();

  const dialog = page.getByTestId("batch-ocr");
  await dialog.getByRole("button", { name: "Choose Folder…" }).click();
  await expect(dialog.locator("tr")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Recognize Text in 3 files" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Finished: 2 saved, 1 left alone, 0 failed/, {
    timeout: 90_000,
  });
  const written = mockfs.writes.map((w) => w.path).sort();
  expect(written).toEqual([
    "C:\\Scans\\scanned-image-only_OCR.pdf",
    "C:\\Scans\\second scan_OCR.pdf",
  ]);
  expect(bytesAt(mockfs, written[0]!).subarray(0, 4).toString()).toBe("%PDF");
});

test("Enhance menu straightens and turns pages upright", async ({ page, mockfs }) => {
  mockfs.entries[SCAN] = { file: "scanned-image-only.pdf" };
  await boot(page);
  await openPaths(page, [SCAN]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Scan & OCR", exact: true }).click();
  const menu = async (item: string) => {
    await page
      .getByTestId("tool-toolbar")
      .getByRole("button", { name: "Enhance scanned pages" })
      .click();
    await page.getByRole("menuitemradio", { name: item }).click();
  };
  // The synthetic scan is level and upright: nothing to change.
  await menu("Straighten All Pages");
  await expect(page.locator(".toast", { hasText: "No tilted pages found." })).toBeVisible();
  await menu("Turn Pages Upright");
  await expect(page.locator(".toast", { hasText: "already upright" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: "Undo (Ctrl+Z)" })).toBeDisabled();
});
