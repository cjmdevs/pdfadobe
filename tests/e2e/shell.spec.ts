// App shell: tabs, drag-and-drop, recent files, "Open with" from Explorer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS, P, boot, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("app shell", () => {
  test("starts on the start page with no documents", async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId("start-page")).toBeVisible();
    await expect(page.getByText("No recent files.")).toBeVisible();
    await expect(page).toHaveTitle("PDF Workbench");
  });

  test("Explorer 'Open with' at launch opens the file in a tab", async ({ page }) => {
    await boot(page, { launch: [P.nav] });
    await expect(page.getByRole("tab", { name: /navigation\.pdf/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitForPainted(page, 0);
    await expect(page).toHaveTitle("navigation.pdf - PDF Workbench");
  });

  test("opens many documents as tabs; switch and close with Acrobat keys", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text, P.nav, P.long200]);
    const tabs = page.getByRole("tab", { name: /\.pdf/ });
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole("tab", { name: /long-200p/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByRole("tab", { name: /text-1p/ }).click();
    await expect(page.getByRole("tab", { name: /text-1p/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("page-count")).toHaveText("/ 1");

    await page.keyboard.press("Control+Tab");
    await expect(page.getByRole("tab", { name: /navigation/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Control+Shift+Tab");
    await expect(page.getByRole("tab", { name: /text-1p/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("Control+w");
    await expect(tabs).toHaveCount(2);
    await page.keyboard.press("Control+F4");
    await expect(tabs).toHaveCount(1);
    await page.getByRole("button", { name: /Close long-200p|Close navigation/ }).click();
    await expect(page.getByTestId("start-page")).toBeVisible();
  });

  test("opening an already-open file switches to its tab instead of duplicating it", async ({
    page,
  }) => {
    await boot(page);
    await openPaths(page, [P.text, P.nav]);
    await expect(page.getByRole("tab", { name: /\.pdf/ })).toHaveCount(2);
    // Same file, different case and slashes: still the same Windows file.
    await openPaths(page, ["c:/corpus/TEXT-1P.pdf".replace(/\//g, "\\")]);
    await expect(page.getByRole("tab", { name: /\.pdf/ })).toHaveCount(2);
  });

  test("a second launch ('Open with' while running) adds a tab", async ({ page }) => {
    await boot(page, { launch: [P.text] });
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await openPaths(page, [P.nav]);
    await expect(page.getByRole("tab", { name: /navigation/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("drag and drop a PDF onto the window opens it", async ({ page }) => {
    await boot(page);
    const bytes = [...readFileSync(join(CORPUS, "navigation.pdf"))];
    const dt = await page.evaluateHandle((data) => {
      const t = new DataTransfer();
      t.items.add(new File([new Uint8Array(data)], "dropped.pdf", { type: "application/pdf" }));
      return t;
    }, bytes);
    await page.dispatchEvent(".app", "dragover", { dataTransfer: dt });
    await expect(page.getByText("Drop PDF files to open them")).toBeVisible();
    await page.dispatchEvent(".app", "drop", { dataTransfer: dt });
    await expect(page.getByRole("tab", { name: /dropped\.pdf/ })).toBeVisible();
    await waitForPainted(page, 0);
  });

  test("recent files list remembers opened paths and reopens them", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
    await openPaths(page, [P.long500]);
    await expect(page.getByRole("tab", { name: /long-500p/ })).toBeVisible();
    await page.keyboard.press("Control+Shift+W"); // close all
    await expect(page.getByTestId("start-page")).toBeVisible();

    const recent = page.getByRole("list", { name: "Recent files" }).getByRole("listitem");
    await expect(recent).toHaveCount(2);
    // Most recent first; UNC path shown in full.
    await expect(recent.nth(0)).toContainText("long-500p.pdf");
    await expect(recent.nth(0)).toContainText("\\\\fileserver\\share\\Corpus\\long-500p.pdf");
    await recent
      .nth(1)
      .getByRole("button", { name: /^text-1p/ })
      .click();
    await expect(page.getByRole("tab", { name: /text-1p/ })).toBeVisible();
  });
});
