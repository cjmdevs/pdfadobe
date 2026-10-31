// Phase 7: Reduce File Size. The Email preset makes the synthetic scan smaller; the
// result is saved as <name>_Optimized.pdf beside the original and opened.
import { boot, bytesAt, expect, openPaths, test, waitForPainted } from "./fixtures";

const SCAN = "C:\\Scans\\scanned-image-only.pdf";
const OUT = "C:\\Scans\\scanned-image-only_Optimized.pdf";

test("Email preset: before/after sizes, saved as a new file", async ({ page, mockfs }) => {
  mockfs.entries[SCAN] = { file: "scanned-image-only.pdf" };
  await boot(page);
  await openPaths(page, [SCAN]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Optimize PDF", exact: true }).click();
  const dialog = page.getByTestId("optimize");
  await dialog.getByRole("radio", { name: /Email/ }).check();
  await dialog.getByRole("button", { name: "Reduce File Size" }).click();
  const result = dialog.getByTestId("optimize-result");
  await expect(result).toContainText("% smaller", { timeout: 60_000 });
  await expect(result).toContainText("Images made smaller: 1 (1 at a lower resolution)");
  await dialog.getByRole("button", { name: "Save as scanned-image-only_Optimized.pdf" }).click();
  await expect(page.getByRole("tab", { name: /scanned-image-only_Optimized\.pdf/ })).toBeVisible();
  expect(mockfs.writes.map((w) => w.path)).toEqual([OUT]);
  expect(bytesAt(mockfs, OUT).length).toBeLessThan(bytesAt(mockfs, SCAN).length);
});
