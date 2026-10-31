// Phase 7: Export PDF (pages to PNG, text to .txt) and Create PDF from images.
import { join } from "node:path";
import {
  FIXTURES,
  P,
  boot,
  bytesAt,
  expect,
  openPaths,
  pages,
  test,
  waitForPainted,
} from "./fixtures";

test("Export PDF: chosen pages as PNG files, then the text", async ({ page, mockfs }) => {
  await boot(page);
  await openPaths(page, [P.nav]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const dlg = page.getByTestId("export-dialog");
  await dlg.getByRole("combobox", { name: "Resolution" }).selectOption("72");
  await dlg.getByLabel("Pages").fill("5-6");
  await dlg.getByRole("button", { name: "Export" }).click();
  await expect(page.locator(".toast", { hasText: "Saved 2 PNG file(s)" })).toBeVisible();
  expect(mockfs.writes.map((w) => w.path)).toEqual([
    "C:\\Corpus\\navigation_Page_5.png",
    "C:\\Corpus\\navigation_Page_6.png",
  ]);
  expect([...bytesAt(mockfs, "C:\\Corpus\\navigation_Page_6.png").subarray(1, 4)]).toEqual([
    0x50, 0x4e, 0x47,
  ]);

  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  await dlg.getByRole("radio", { name: "Plain text (.txt)" }).check();
  await dlg.getByRole("button", { name: "Export" }).click();
  await expect(page.locator(".toast", { hasText: "navigation.txt" })).toBeVisible();
  const text = bytesAt(mockfs, "C:\\Corpus\\navigation.txt").toString("utf8");
  expect(text.split("\f")).toHaveLength(8);
  expect(text).toContain("Schedule A");
});

test("Create PDF from images: one page per image, opened in a new tab", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Create PDF", exact: true }).click();
  const dlg = page.getByTestId("create-pdf-dialog");
  await dlg.getByRole("checkbox", { name: /Recognize text/ }).uncheck();
  const chooser = page.waitForEvent("filechooser");
  await dlg.getByRole("button", { name: "Add Images…" }).click();
  await (
    await chooser
  ).setFiles([join(FIXTURES, "scan-g4-3p.tif"), join(FIXTURES, "photo-rgb.jpg")]);
  // Name order: photo-rgb.jpg before scan-g4-3p.tif.
  await expect(dlg.locator("li").first()).toContainText("photo-rgb.jpg");
  await dlg.getByRole("button", { name: "Create PDF from 2 images" }).click();
  await expect(page.getByRole("tab", { name: /photo-rgb\.pdf/ })).toBeVisible();
  await waitForPainted(page, 0);
  await expect(pages(page)).toHaveCount(4);
});
