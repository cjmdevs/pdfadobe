// Phase 2: Organize Pages view, undo/redo, Save (.bak), insert/extract/duplicate,
// unsaved-changes prompt. Saved files are checked with qpdf + pdf.js in the test process.
import { join } from "node:path";
import { inspectPdf, outlineLines } from "../helpers/pdf-inspect";
import {
  CORPUS,
  FIXTURES,
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

const grid = (page: Page) => page.getByTestId("grid-page");
const activeTab = (page: Page) =>
  page.getByRole("tablist", { name: "Open documents" }).getByRole("tab", { selected: true });
const ids = (texts: string[]) =>
  texts.map((t) => /Workpaper (\w) - page (\d)/.exec(t)?.slice(1).join("") ?? "?");

async function openOrganize(page: Page, path: string) {
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Organize pages" }).click();
  await expect(page.getByTestId("organize")).toBeVisible();
}

test.describe("organize pages", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("rotate, undo, redo, then Save keeps a .bak and writes a valid PDF", async ({
    page,
    mockfs,
  }) => {
    await openOrganize(page, P.wpA);
    await expect(grid(page)).toHaveCount(3);
    await grid(page).nth(2).click();
    await page.getByRole("button", { name: "Rotate right" }).click();
    await idle(page);
    await expect(activeTab(page)).toContainText("•");
    await expect(page.getByRole("button", { name: "Undo Rotate right (Ctrl+Z)" })).toBeEnabled();

    await page.keyboard.press("Control+z");
    await expect(page.getByRole("button", { name: "Redo Rotate right (Ctrl+Y)" })).toBeEnabled();
    await expect(activeTab(page)).not.toContainText("•");
    await page.keyboard.press("Control+y");
    await expect(activeTab(page)).toContainText("•");

    await page.keyboard.press("Control+s");
    await expect(activeTab(page)).not.toContainText("•");
    expect(mockfs.writes).toEqual([{ path: P.wpA, mode: "save" }]);
    expect(mockfs.entries[`${P.wpA}.bak`]).toEqual({ file: "workpaper-a.pdf" });

    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.wpA)));
    expect(saved.checkError).toBeNull();
    expect(saved.pageSizes.map((s) => s.rotate)).toEqual([0, 0, 90]);
    expect(saved.fields.find((f) => f.name === "client.name")?.value).toBe("Sample Client A");
    expect(outlineLines(saved.outline)).toEqual(["A Cover@1", ".A Detail@2", "A Summary@3"]);
  });

  test("drag a page to a new position; bookmarks follow; Save As to a new file", async ({
    page,
    mockfs,
  }) => {
    await openOrganize(page, P.wpA);
    // Drop page 3 on the left half of page 1 = before page 1.
    await grid(page)
      .nth(2)
      .dragTo(grid(page).nth(0), { targetPosition: { x: 10, y: 60 } });
    await idle(page);
    const target = "C:\\Clients\\Engagement\\workpaper-a reordered.pdf";
    await queueChoices(page, { savePaths: [target] });
    await page.keyboard.press("Control+Shift+S");
    await expect(activeTab(page)).toContainText("workpaper-a reordered");
    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, target)));
    expect(ids(saved.pageText)).toEqual(["A3", "A1", "A2"]);
    expect(outlineLines(saved.outline)).toEqual(["A Cover@2", ".A Detail@3", "A Summary@1"]);
    // The original is untouched.
    expect(mockfs.entries[P.wpA]).toEqual({ file: "workpaper-a.pdf" });
  });

  test("multi-select with Shift+click, Delete key, Ctrl+Z restores", async ({ page }) => {
    await openOrganize(page, P.wpA);
    await grid(page).nth(0).click();
    await grid(page)
      .nth(1)
      .click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("selection-count")).toHaveText("2 of 3 selected");
    await page.keyboard.press("Delete");
    await idle(page);
    await expect(grid(page)).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect(grid(page)).toHaveCount(3);
  });

  test("duplicate, extract to a new tab, insert a blank page", async ({ page, mockfs }) => {
    await openOrganize(page, P.wpA);
    await grid(page).nth(1).click();
    await page.getByRole("button", { name: "Duplicate" }).click();
    await idle(page);
    await expect(grid(page)).toHaveCount(4);

    await grid(page).nth(0).click();
    await page.getByRole("button", { name: "Extract to new file" }).click();
    await expect(page.getByRole("tab", { name: /workpaper-a \(pages 1\)\.pdf/ })).toBeVisible();
    await expect(activeTab(page)).toContainText("•");
    await queueChoices(page, { savePaths: ["C:\\Out\\extracted.pdf"] });
    await page.keyboard.press("Control+s");
    await expect(activeTab(page)).not.toContainText("•");
    const ex = await inspectPdf(new Uint8Array(bytesAt(mockfs, "C:\\Out\\extracted.pdf")));
    expect(ids(ex.pageText)).toEqual(["A1"]);
    expect(ex.fields.map((f) => f.value)).toEqual(["Sample Client A"]);

    // Back on the original tab, which stays in Organize view.
    await page.getByRole("tab", { name: /workpaper-a\.pdf/ }).click();
    await expect(page.getByTestId("organize")).toBeVisible();
    await page.getByRole("button", { name: "Insert blank page…" }).click();
    const dlg = page.getByRole("dialog", { name: "Insert blank pages" });
    await dlg.getByLabel("Location").selectOption("first");
    await dlg.getByLabel("Number of pages").fill("2");
    await dlg.getByRole("button", { name: "Insert" }).click();
    await idle(page);
    await expect(grid(page)).toHaveCount(6);
  });

  test("insert pages from another PDF and from a multi-page TIFF scan", async ({
    page,
    mockfs,
  }) => {
    await openOrganize(page, P.wpA);
    await grid(page).nth(0).click();
    await page.getByRole("button", { name: "Insert from file…" }).click();
    const dlg = page.getByRole("dialog", { name: "Insert pages" });
    const chooser = page.waitForEvent("filechooser");
    await dlg.getByRole("button", { name: "Choose file…" }).click();
    await (await chooser).setFiles(join(CORPUS, "workpaper-b.pdf"));
    await expect(dlg.getByTestId("source-file")).toHaveText("workpaper-b.pdf (3 pages)");
    await dlg.getByLabel("Pages to insert").fill("1");
    await dlg.getByRole("button", { name: "Insert" }).click();
    await idle(page);
    await expect(grid(page)).toHaveCount(4);

    await page.getByRole("button", { name: "Insert from file…" }).click();
    const dlg2 = page.getByRole("dialog", { name: "Insert pages" });
    const chooser2 = page.waitForEvent("filechooser");
    await dlg2.getByRole("button", { name: "Choose file…" }).click();
    await (await chooser2).setFiles(join(FIXTURES, "scan-g4-3p.tif"));
    await expect(dlg2.getByTestId("source-file")).toHaveText("scan-g4-3p.tif (3 pages)");
    await dlg2.getByLabel("Location").selectOption("last");
    await dlg2.getByRole("button", { name: "Insert" }).click();
    await idle(page);
    await expect(grid(page)).toHaveCount(7);

    await page.keyboard.press("Control+s");
    await expect(activeTab(page)).not.toContainText("•");
    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.wpA)));
    expect(saved.checkError).toBeNull();
    expect(ids(saved.pageText).slice(0, 4)).toEqual(["A1", "B1", "A2", "A3"]);
    expect(saved.pageSizes.slice(4).every((s) => Math.round(s.width) === 612)).toBe(true);
    // B's field came along with its own value and a non-clashing name.
    const client = saved.fields.filter((f) => f.name.includes("client"));
    expect(client.map((f) => f.value)).toEqual(["Sample Client A", "Sample Client B"]);
    expect(new Set(client.map((f) => f.name)).size).toBe(2);
  });

  test("crop a page range, set page size for selected pages, replace a page", async ({
    page,
    mockfs,
  }) => {
    await openOrganize(page, P.wpA);
    await page.getByRole("button", { name: "Crop pages…" }).click();
    const crop = page.getByRole("dialog", { name: "Crop pages" });
    await crop.getByLabel("Top margin").fill("1");
    await crop.getByLabel("Left margin").fill("0.5");
    await crop.getByLabel("Page range").fill("2-3");
    await crop.getByRole("button", { name: "Crop" }).click();
    await idle(page);

    await grid(page).nth(0).click();
    await page.getByRole("button", { name: "Page size…" }).click();
    const size = page.getByRole("dialog", { name: "Set page size" });
    await size.getByLabel("Page size").selectOption("legal");
    await expect(size.getByRole("radio", { name: /This page \(1\)/ })).toBeChecked();
    await size.getByRole("button", { name: "Apply" }).click();
    await idle(page);

    await grid(page).nth(1).click();
    await page.getByRole("button", { name: "Replace pages…" }).click();
    const rep = page.getByRole("dialog", { name: "Replace pages" });
    await expect(rep.getByLabel("Pages to replace")).toHaveValue("2");
    const chooser = page.waitForEvent("filechooser");
    await rep.getByRole("button", { name: "Choose file…" }).click();
    await (await chooser).setFiles(join(CORPUS, "workpaper-c.pdf"));
    await rep.getByLabel("Replacement pages").fill("2");
    await rep.getByRole("button", { name: "Replace" }).click();
    await idle(page);

    await page.keyboard.press("Control+s");
    await expect(activeTab(page)).not.toContainText("•");
    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.wpA)));
    expect(saved.checkError).toBeNull();
    expect(ids(saved.pageText)).toEqual(["A1", "C2", "A3"]);
    expect(saved.pageSizes[0]).toMatchObject({ width: 612, height: 1008 });
    // Page 3 kept the crop (0.5 in left, 1 in top off Letter).
    expect(saved.pageSizes[2]).toMatchObject({ width: 612 - 36, height: 792 - 72 });
    // The replacement brought its own crop-free page and C's checkbox (renamed).
    expect(saved.pageSizes[1]).toMatchObject({ width: 612, height: 792 });
    expect(saved.fields.some((f) => f.page === 2 && f.name.startsWith("tie+"))).toBe(true);
    // The Detail bookmark pointed at page 2 and now points at its replacement.
    expect(outlineLines(saved.outline)).toEqual(["A Cover@1", ".A Detail@2", "A Summary@3"]);
  });

  test("changing pages of a signed PDF asks first (signature would break)", async ({ page }) => {
    await openOrganize(page, P.signed);
    await grid(page).nth(0).click();
    await page.getByRole("button", { name: "Rotate right" }).click();
    const ask = page.getByRole("dialog", { name: "Digitally signed document" });
    await expect(ask).toContainText("digitally signed (1 signature)");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Undo (Ctrl+Z)" })).toBeDisabled();
    // Agreeing once covers the rest of the session for this tab.
    await page.getByRole("button", { name: "Rotate right" }).click();
    await ask.getByRole("button", { name: "Change anyway" }).click();
    await idle(page);
    await page.getByRole("button", { name: "Rotate left" }).click();
    await idle(page);
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo Rotate left (Ctrl+Z)" })).toBeEnabled();
  });

  test("toolbar rotate turns only the current page, is saved, and survives a later delete", async ({
    page,
    mockfs,
  }) => {
    // Owner report: rotate affected every page and was lost after deleting a page.
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    await page.getByLabel("Page number").fill("2");
    await page.getByLabel("Page number").press("Enter");
    await page.getByRole("button", { name: "Rotate page 2 right" }).click();
    await idle(page);
    await page.getByRole("button", { name: "Organize pages" }).click();
    await grid(page).nth(0).click();
    await page.getByRole("button", { name: "Delete (Del)" }).click();
    await idle(page);
    await page.keyboard.press("Control+s");
    await expect(activeTab(page)).not.toContainText("•");
    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.wpA)));
    expect(ids(saved.pageText)).toEqual(["A2", "A3"]);
    expect(saved.pageSizes.map((s) => s.rotate)).toEqual([90, 0]);
  });

  test("toolbar rotate on a signed PDF asks first", async ({ page }) => {
    await openPaths(page, [P.signed]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Rotate page 1 right" }).click();
    await expect(page.getByRole("dialog", { name: "Digitally signed document" })).toBeVisible();
  });

  test("rotating several selected pages twice turns all of them twice (owner report)", async ({
    page,
    mockfs,
  }) => {
    await openOrganize(page, P.wpA);
    await grid(page).nth(0).click();
    await grid(page)
      .nth(2)
      .click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Rotate right", exact: true }).click();
    await idle(page);
    // The selection survives the edit.
    await expect(page.getByTestId("selection-count")).toHaveText("3 of 3 selected");
    await page.getByRole("button", { name: "Rotate right", exact: true }).click();
    await idle(page);
    await page.keyboard.press("Control+s");
    await expect(activeTab(page)).not.toContainText("•");
    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.wpA)));
    expect(saved.pageSizes.map((s) => s.rotate)).toEqual([180, 180, 180]);
  });

  test("closing with unsaved changes asks first", async ({ page }) => {
    await openOrganize(page, P.wpA);
    await grid(page).nth(0).click();
    await page.getByRole("button", { name: "Rotate left" }).click();
    await idle(page);
    await page.keyboard.press("Control+w");
    const dlg = page.getByRole("dialog", { name: "Unsaved changes" });
    await expect(dlg).toContainText("workpaper-a.pdf");
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("tab", { name: /workpaper-a/ })).toBeVisible();
    await page.keyboard.press("Control+w");
    await page
      .getByRole("dialog", { name: "Unsaved changes" })
      .getByRole("button", { name: "Don’t save" })
      .click();
    await expect(page.getByRole("tab", { name: /workpaper-a/ })).toHaveCount(0);
  });

  test("double-click a page opens it in the reader", async ({ page }) => {
    await openOrganize(page, P.long200);
    await grid(page).nth(4).dblclick();
    await expect(page.getByTestId("organize")).toHaveCount(0);
    await expect
      .poll(async () => Number(await page.getByLabel("Page number").inputValue()))
      .toBe(5);
  });
});
