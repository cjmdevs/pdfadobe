// Phase 2: Combine Files (files + folder, reorder, page ranges, bookmark per file, form
// field renaming) and Split (bookmarks, page count). Outputs are checked with qpdf + pdf.js.
import { join } from "node:path";
import { inspectPdf, outlineLines } from "../helpers/pdf-inspect";
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
} from "./fixtures";

const ids = (texts: string[]) =>
  texts.map((t) => /Workpaper (\w) - page (\d)/.exec(t)?.slice(1).join("") ?? "img");

test.describe("combine files", () => {
  test("a folder plus a file, reordered, with page ranges and a bookmark per file", async ({
    page,
    mockfs,
  }) => {
    await boot(page);
    await page.getByRole("button", { name: "Combine Files…" }).click();
    const dlg = page.getByRole("dialog", { name: "Combine Files" });
    // The engagement folder has workpapers A, B, C and a 3-page TIFF scan (natural order).
    await queueChoices(page, { folders: [P.engagement] });
    await dlg.getByRole("button", { name: "Add folder…" }).click();
    const items = dlg.getByTestId("combine-item");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("scan-g4-3p.tif");
    await expect(items.nth(1)).toContainText("workpaper-a.pdf");

    // Another copy of workpaper B from a file picker.
    const chooser = page.waitForEvent("filechooser");
    await dlg.getByRole("button", { name: "Add files…" }).click();
    await (await chooser).setFiles(join(CORPUS, "workpaper-b.pdf"));
    await expect(items).toHaveCount(5);

    // Scan last (drag its row onto row 4, then one step with the button); only pages 1
    // and 3 of workpaper C; drop the extra B.
    await items.nth(0).locator(".combine-name").dragTo(items.nth(3));
    await expect(items.nth(3)).toContainText("scan-g4-3p.tif");
    await dlg.getByRole("button", { name: "Move scan-g4-3p.tif down" }).click();
    await dlg.getByLabel("Page range for workpaper-c.pdf").fill("1, 3");
    await dlg.getByRole("button", { name: "Remove workpaper-b.pdf" }).last().click();
    await expect(items).toHaveCount(4);
    await expect(dlg).toContainText("11 pages");
    await dlg.getByRole("button", { name: "Combine", exact: true }).click();

    await expect(page.getByRole("tab", { name: /Combined\.pdf/ })).toBeVisible();
    await waitForPainted(page, 0);
    await queueChoices(page, { savePaths: ["C:\\Clients\\Engagement\\Combined.pdf"] });
    await page.keyboard.press("Control+s");
    await expect.poll(() => mockfs.writes.length).toBe(1);

    const out = await inspectPdf(
      new Uint8Array(bytesAt(mockfs, "C:\\Clients\\Engagement\\Combined.pdf")),
    );
    expect(out.checkError).toBeNull();
    expect(out.pages).toBe(11);
    expect(ids(out.pageText)).toEqual([
      "A1",
      "A2",
      "A3",
      "B1",
      "B2",
      "B3",
      "C1",
      "C3",
      "img",
      "img",
      "img",
    ]);
    expect(outlineLines(out.outline)).toEqual([
      "workpaper-a@1",
      ".A Cover@1",
      "..A Detail@2",
      ".A Summary@3",
      "workpaper-b@4",
      ".B Cover@4",
      "..B Detail@5",
      ".B Summary@6",
      "workpaper-c@7",
      ".C Cover@7",
      ".C Summary@8",
      "scan-g4-3p@9",
    ]);
    // Same field names in three files: renamed, each with its own value.
    const client = out.fields.filter((f) => f.name.includes("client"));
    expect(client.map((f) => f.value)).toEqual([
      "Sample Client A",
      "Sample Client B",
      "Sample Client C",
    ]);
    expect(new Set(client.map((f) => f.name)).size).toBe(3);
    // Annotations survived (one sticky note per workpaper).
    expect(out.annotations.filter((a) => a.subtype === "Text").map((a) => a.page)).toEqual([
      1, 4, 7,
    ]);
  });
});

test.describe("split", () => {
  test("by top-level bookmarks into the document's folder, never overwriting", async ({
    page,
    mockfs,
  }) => {
    await boot(page);
    // A file whose top-level bookmarks are the three workpapers: combine them first.
    mockfs.entries["C:\\Clients\\Engagement\\binder.pdf"] = { file: "workpaper-a.pdf" };
    // An existing file with the first output's name must survive.
    mockfs.entries["C:\\Clients\\Engagement\\binder - A Cover.pdf"] = { file: "text-1p.pdf" };
    await openPaths(page, ["C:\\Clients\\Engagement\\binder.pdf"]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Organize pages" }).click();
    await page.getByRole("button", { name: "Split document…" }).click();
    const dlg = page.getByRole("dialog", { name: "Split document" });
    await expect(dlg.getByTestId("split-folder")).toHaveText(P.engagement);
    await dlg.getByLabel("Top-level bookmarks (named after each bookmark)").check();
    await dlg.getByRole("button", { name: "Split", exact: true }).click();
    await expect(dlg.getByTestId("split-results")).toBeVisible();
    await expect(dlg.getByTestId("split-results").locator("li")).toHaveText([
      "binder - A Cover (2).pdf",
      "binder - A Summary.pdf",
    ]);
    expect(mockfs.entries["C:\\Clients\\Engagement\\binder - A Cover.pdf"]).toEqual({
      file: "text-1p.pdf",
    });
    const first = await inspectPdf(
      new Uint8Array(bytesAt(mockfs, "C:\\Clients\\Engagement\\binder - A Cover (2).pdf")),
    );
    expect(ids(first.pageText)).toEqual(["A1", "A2"]);
    expect(outlineLines(first.outline)).toEqual(["A Cover@1", ".A Detail@2"]);
    expect(first.fields.find((f) => f.name === "client.name")?.value).toBe("Sample Client A");
    const second = await inspectPdf(
      new Uint8Array(bytesAt(mockfs, "C:\\Clients\\Engagement\\binder - A Summary.pdf")),
    );
    expect(ids(second.pageText)).toEqual(["A3"]);
  });

  test("by page count into a chosen folder", async ({ page, mockfs }) => {
    await boot(page);
    await openPaths(page, [P.long200]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Organize pages" }).click();
    await page.getByRole("button", { name: "Split document…" }).click();
    const dlg = page.getByRole("dialog", { name: "Split document" });
    await dlg.getByRole("textbox", { name: "Pages per file" }).fill("80");
    await queueChoices(page, { folders: ["D:\\Split"] });
    await dlg.getByRole("button", { name: "Output folder…" }).click();
    await expect(dlg.getByTestId("split-folder")).toHaveText("D:\\Split");
    await dlg.getByRole("button", { name: "Split", exact: true }).click();
    await expect(dlg.getByTestId("split-results").locator("li")).toHaveCount(3);
    const last = await inspectPdf(
      new Uint8Array(bytesAt(mockfs, "D:\\Split\\long-200p - Part 3.pdf")),
    );
    expect(last.pages).toBe(40);
    expect(last.pageText[0]).toContain("Page 161 of 200");
    await idle(page);
  });
});
