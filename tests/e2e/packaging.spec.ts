// Phase 10a: first-run setup, update prompt, "Open in Acrobat" on errors, crash reports.
// The browser platform stands in for Windows: window.__PDFWB_APP__ says whether PDF
// Workbench is the default PDF program and what the update check finds.
import { P, boot, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

type AppMock = {
  isDefault?: boolean | null;
  opened?: number;
  update?: unknown;
  installed?: string;
};

async function mockApp(page: Page, app: AppMock, firstRun = false) {
  await page.addInitScript(
    ({ app, firstRun }) => {
      const w = window as unknown as { __PDFWB_APP__: unknown; __PDFWB_FIRSTRUN__: boolean };
      w.__PDFWB_APP__ = app;
      w.__PDFWB_FIRSTRUN__ = firstRun;
    },
    { app, firstRun },
  );
}

const appState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __PDFWB_APP__: AppMock }).__PDFWB_APP__);

const LIBRARY = "\\\\fileserver\\share\\PDF Workbench";

test.describe("first-run setup", () => {
  test("name, firm library and the default-app walkthrough; shown once", async ({
    page,
    mockfs,
  }) => {
    mockfs.entries[`${LIBRARY}\\layout.json`] = {
      bytes: Buffer.from(JSON.stringify({ version: 1, quickToolbar: ["view.zoomIn"] })),
    };
    await mockApp(page, { isDefault: false }, true);
    await boot(page);
    const dialog = page.getByRole("dialog", { name: "Set up PDF Workbench" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("first-run")).toHaveAttribute("data-step", "1");

    await dialog.getByLabel("Author name").fill("Pat Reviewer");
    await dialog.getByRole("button", { name: "Next" }).click();

    // A folder that can't be reached keeps you on the step and says so.
    await dialog.getByLabel("Firm library folder").fill("\\\\offline-server\\share");
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByTestId("library-note")).toContainText("can't be reached");
    await dialog.getByLabel("Firm library folder").fill(LIBRARY);
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByTestId("first-run")).toHaveAttribute("data-step", "3");

    // Windows decides the default: the app opens Settings and checks when you return.
    await expect(dialog.getByTestId("default-status")).toHaveAttribute("data-default", "false");
    await dialog.getByRole("button", { name: "Open Windows Settings" }).click();
    expect((await appState(page)).opened).toBe(1);
    await page.evaluate(() => {
      (window as unknown as { __PDFWB_APP__: AppMock }).__PDFWB_APP__.isDefault = true;
      window.dispatchEvent(new Event("focus"));
    });
    await expect(dialog.getByTestId("default-status")).toContainText("now open in PDF Workbench");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("pdf-workbench.settings") ?? "{}"),
    );
    expect(saved.firstRunDone).toBe(true);
    expect(saved.authorName).toBe("Pat Reviewer");
    expect(saved.firmLibraryPath).toBe(LIBRARY);
    expect(saved.firmLayoutPath).toBe(`${LIBRARY}\\layout.json`);
    expect(saved.firmFontsPath).toBe(`${LIBRARY}\\fonts`);

    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole("dialog", { name: "Set up PDF Workbench" })).toBeHidden();
  });

  test("Skip setup closes it for good", async ({ page }) => {
    await mockApp(page, {}, true);
    await boot(page);
    const dialog = page.getByRole("dialog", { name: "Set up PDF Workbench" });
    await dialog.getByRole("button", { name: "Skip setup" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
    await expect(dialog).toBeHidden();
  });

  test("Settings reopens the default-app step", async ({ page }) => {
    await mockApp(page, { isDefault: false });
    await boot(page);
    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    const about = page.getByTestId("about");
    await expect(about).toContainText("PDF files open in another program");
    await about.getByRole("button", { name: "Choose default PDF program…" }).click();
    const dialog = page.getByRole("dialog", { name: "Make PDF Workbench your PDF program" });
    await expect(dialog.getByTestId("first-run")).toHaveAttribute("data-step", "3");
  });
});

test.describe("updates", () => {
  const available = {
    kind: "available",
    info: { current: "0.1.0", version: "0.2.0", notes: "Fixes.", rollback: false },
  };

  test("an update found at start is offered; Install now starts it", async ({ page }) => {
    await mockApp(page, { update: available });
    await boot(page, { settings: { firstRunDone: true } });
    const dialog = page.getByRole("dialog", { name: "Update available" });
    await expect(dialog).toContainText("PDF Workbench 0.2.0 is ready (you have 0.1.0)");
    await expect(dialog).toContainText("Fixes.");
    await dialog.getByRole("button", { name: "Install now" }).click();
    await expect.poll(async () => (await appState(page)).installed).toBe("0.2.0");
  });

  test("Later waits a day; Settings can check any time", async ({ page }) => {
    await mockApp(page, { update: available });
    await boot(page, { settings: { firstRunDone: true } });
    await page
      .getByRole("dialog", { name: "Update available" })
      .getByRole("button", { name: "Later" })
      .click();
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole("dialog", { name: "Update available" })).toBeHidden();

    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByRole("dialog", { name: "Update available" })).toBeVisible();
  });

  test("a rollback says so", async ({ page }) => {
    await mockApp(page, {
      update: { ...available, info: { ...available.info, version: "0.0.9", rollback: true } },
    });
    await boot(page, { settings: { firstRunDone: true } });
    await expect(
      page.getByRole("dialog", { name: "The firm is going back a version" }),
    ).toContainText("go back to PDF Workbench 0.0.9");
  });

  test("refused or unreachable updates are reported in Settings, not offered", async ({ page }) => {
    await mockApp(page, { update: { kind: "bad", message: "the signature does not match" } });
    await boot(page, { settings: { firstRunDone: true } });
    await expect(page.getByRole("dialog", { name: "Update available" })).toBeHidden();
    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByTestId("update-status")).toContainText(
      "The update was refused: the signature does not match",
    );
  });
});

test.describe("Open in Acrobat on errors", () => {
  const acrobat = (page: Page) =>
    page.evaluate(() => (window as unknown as { __PDFWB_ACROBAT__?: string[] }).__PDFWB_ACROBAT__);

  test("the can't-open dialog offers it", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.locked]);
    const dialog = page.getByRole("dialog", { name: "Can't open file" });
    await dialog.getByTestId("open-in-acrobat").click();
    expect(await acrobat(page)).toEqual([P.locked]);
  });

  test("a damaged file offers it", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.corrupt]);
    await page.getByTestId("open-failure").getByTestId("open-in-acrobat").click();
    expect(await acrobat(page)).toEqual([P.corrupt]);
  });

  test("error messages about the open document offer it", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.noPrint]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Print (Ctrl+P)" }).click();
    const toast = page.getByRole("alert").filter({ hasText: "do not allow printing" });
    await toast.getByTestId("open-in-acrobat").click();
    expect(await acrobat(page)).toEqual([P.noPrint]);
    await toast.getByRole("button", { name: "Close" }).click();
    await expect(toast).toBeHidden();
  });
});

test.describe("crash reports", () => {
  test("an uncaught error is saved without its message", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("Taxpayer Jane 123-45-6789");
      });
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __PDFWB_CRASHES__?: string[] }).__PDFWB_CRASHES__?.length ?? 0,
        ),
      )
      .toBe(1);
    const text = await page.evaluate(
      () => (window as unknown as { __PDFWB_CRASHES__: string[] }).__PDFWB_CRASHES__[0],
    );
    expect(text).toContain("PDF Workbench crash report");
    expect(text).toContain("message withheld");
    expect(text).not.toContain("Jane");
    expect(text).not.toContain("6789");
  });
});
