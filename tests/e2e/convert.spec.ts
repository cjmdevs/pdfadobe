// Phase 7: Export PDF (pages to PNG, text to .txt) and Create PDF from images.
// B5: Export to Word (stand-in Word) and Excel; Create PDF from Office files, folders and
// mixed combines, written beside the originals.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import {
  FIXTURES,
  P,
  boot,
  bytesAt,
  expect,
  openPaths,
  pages,
  queueChoices,
  test,
  waitForPainted,
  dialogWith,
} from "./fixtures";

test("Export PDF: chosen pages as PNG files, then the text", async ({ page, mockfs }) => {
  await boot(page);
  await openPaths(page, [P.nav]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const dlg = dialogWith(page, "export-dialog");
  await dlg.getByRole("combobox", { name: "Resolution" }).selectOption("72");
  await dlg.getByLabel("Pages").fill("5-6");
  await dlg.getByRole("button", { name: "Export" }).click();
  await expect(page.locator(".toast", { hasText: "Saved 2 PNG files" })).toBeVisible();
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

test("Export PDF to Word and Excel, beside the source", async ({ page, mockfs }) => {
  mockfs.office.apps.word = true;
  await boot(page);
  await openPaths(page, [P.footing]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const dlg = dialogWith(page, "export-dialog");
  await dlg.getByRole("radio", { name: "Word document (.docx)" }).check();
  await expect(dlg.getByRole("note")).toContainText("layouts");
  await dlg.getByRole("button", { name: "Export" }).click();
  await expect(page.locator(".toast", { hasText: "footing.docx" })).toBeVisible();
  expect([...bytesAt(mockfs, "C:\\Corpus\\footing.docx").subarray(0, 2)]).toEqual([0x50, 0x4b]);

  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  await dlg.getByRole("radio", { name: "Excel workbook (.xlsx)" }).check();
  await dlg.getByRole("button", { name: "Export" }).click();
  await expect(page.locator(".toast", { hasText: "footing.xlsx" })).toBeVisible();
  const files = unzipSync(new Uint8Array(bytesAt(mockfs, "C:\\Corpus\\footing.xlsx")));
  expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain("<v>8700.25</v>");
});

test("Export to Word is offered only with desktop Word", async ({ page }) => {
  await boot(page);
  await openPaths(page, [P.text]);
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const dlg = dialogWith(page, "export-dialog");
  await expect(dlg.getByText("(needs Microsoft Word)")).toBeVisible();
  await expect(dlg.getByRole("radio", { name: /Word document/ })).toBeDisabled();
});

const ENG = "C:\\Clients\\Engagement";

test("Create PDF: a folder of Office files and scans, one PDF each beside the originals", async ({
  page,
  mockfs,
}) => {
  mockfs.office.apps = { word: true, excel: true, powerpoint: false };
  mockfs.entries[`${ENG}\\Letter.docx`] = { file: "text-1p.pdf" };
  mockfs.entries[`${ENG}\\TB.xlsx`] = { file: "footing.pdf" };
  mockfs.entries[`${ENG}\\~$Letter.docx`] = { file: "text-1p.pdf" };
  await boot(page);
  await page.getByRole("button", { name: "Create PDF", exact: true }).click();
  const dlg = dialogWith(page, "create-pdf-dialog");
  await queueChoices(page, { folders: [ENG] });
  await dlg.getByRole("button", { name: "Add folder…" }).click();
  await expect(dlg.getByRole("list", { name: "Files" })).toContainText("TB.xlsx");
  await expect(dlg.getByRole("list", { name: "Files" })).not.toContainText("~$");
  await expect(dlg.getByText("PDFs in the list are only used when combining.")).toBeVisible();
  await expect(dlg.getByText(/Microsoft Print to PDF/)).toBeVisible();
  await dlg.getByRole("checkbox", { name: /Recognize text/ }).uncheck();
  // The workpaper PDFs are skipped: two Office files and one scan.
  await dlg.getByRole("button", { name: "Create 3 PDFs" }).click();
  await expect(page.locator(".toast", { hasText: "Created 3 PDFs" })).toBeVisible();
  expect(mockfs.writes.map((w) => w.path).sort()).toEqual(
    [`${ENG}\\Letter.pdf`, `${ENG}\\scan-g4-3p.pdf`, `${ENG}\\TB.pdf`].sort(),
  );
  expect(mockfs.office.converted.sort()).toEqual([`${ENG}\\Letter.docx`, `${ENG}\\TB.xlsx`]);
});

test("Create PDF waits for Office it does not have", async ({ page, mockfs }) => {
  mockfs.entries[`${ENG}\\Deck.pptx`] = { file: "text-1p.pdf" };
  await boot(page);
  await page.getByRole("button", { name: "Create PDF", exact: true }).click();
  const dlg = dialogWith(page, "create-pdf-dialog");
  await queueChoices(page, { paths: [[`${ENG}\\Deck.pptx`]] });
  await dlg.getByRole("button", { name: "Add files…" }).click();
  await expect(dlg.getByText("(needs Microsoft PowerPoint)")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Create 1 PDF" })).toBeDisabled();
});

test("Create PDF: Office, PDF and scan combined in the chosen order", async ({ page, mockfs }) => {
  mockfs.office.apps.word = true;
  mockfs.entries[`${ENG}\\Letter.docx`] = { file: "text-1p.pdf" };
  mockfs.entries[`${ENG}\\photo-rgb.jpg`] = {
    bytes: readFileSync(join(FIXTURES, "photo-rgb.jpg")),
  };
  await boot(page);
  await page.getByRole("button", { name: "Create PDF", exact: true }).click();
  const dlg = dialogWith(page, "create-pdf-dialog");
  await queueChoices(page, {
    paths: [[`${ENG}\\photo-rgb.jpg`, P.scanTif, `${ENG}\\Letter.docx`]],
  });
  await dlg.getByRole("button", { name: "Add files…" }).click();
  await dlg.getByRole("radio", { name: /One combined PDF/ }).check();
  await dlg.getByRole("checkbox", { name: /Recognize text/ }).uncheck();
  // Name order is Letter, photo, scan; put the scan before the photo.
  await expect(dlg.locator("li").first()).toContainText("Letter.docx");
  await dlg.getByRole("button", { name: "Move scan-g4-3p.tif up" }).click();
  await expect(dlg.locator("li").nth(1)).toContainText("scan-g4-3p.tif");
  await dlg.getByRole("button", { name: "Combine 3 files into one PDF" }).click();
  await expect(page.getByRole("tab", { name: /Combined\.pdf/ })).toBeVisible();
  await waitForPainted(page, 0);
  // 1 Letter page + 3 TIFF pages + 1 photo page.
  await expect(pages(page)).toHaveCount(5);
  expect(mockfs.writes.map((w) => w.path)).toEqual([`${ENG}\\Combined.pdf`]);
});
