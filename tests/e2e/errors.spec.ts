// Locked, unreachable, missing, password-protected and corrupt files.
import { P, boot, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("file errors", () => {
  test("a file locked by another program gets a clear message and Try again", async ({
    page,
    mockfs,
  }) => {
    await boot(page);
    await openPaths(page, [P.locked]);
    const dialog = page.getByRole("dialog", { name: "Can't open file" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("open-error-message")).toHaveAttribute("data-kind", "locked");
    await expect(dialog).toContainText("open in another program");
    await expect(dialog).toContainText(P.locked);

    // The other program lets go; Try again succeeds.
    mockfs.entries[P.locked] = { file: "text-1p.pdf" };
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("tab", { name: /locked-by-excel/ })).toBeVisible();
  });

  test("an unreachable network share says so", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.offline]);
    const dialog = page.getByRole("dialog", { name: "Can't open file" });
    await expect(dialog.getByTestId("open-error-message")).toHaveAttribute("data-kind", "network");
    await expect(dialog).toContainText("network location could not be reached");
    await expect(dialog).toContainText("\\\\offline-server\\share\\return.pdf");
  });

  test("a moved file can be removed from recent files", async ({ page }) => {
    await boot(page, { settings: { recent: [P.missing, P.text] } });
    await page.getByRole("button", { name: /^moved-away\.pdf/ }).click();
    const dialog = page.getByRole("dialog", { name: "Can't open file" });
    await expect(dialog).toContainText("not found");
    await dialog.getByRole("button", { name: "Remove from recent files" }).click();
    await expect(
      page.getByRole("list", { name: "Recent files" }).getByRole("listitem"),
    ).toHaveCount(1);
  });

  test("a corrupt file offers qpdf repair into a NEW file", async ({ page, mockfs }) => {
    await boot(page);
    await openPaths(page, [P.damaged]);
    // damaged-xref.pdf opens in PDFium (it rebuilds the xref), so force the failure path
    // with the truly corrupt file, then repair a path qpdf can fix.
    await openPaths(page, [P.corrupt]);
    const failure = page.getByTestId("open-failure");
    await expect(failure).toContainText("Can't open corrupt.pdf");
    await expect(failure).toContainText("The original is not changed");

    // corrupt.pdf is beyond repair: qpdf's reason is shown, nothing is written.
    await failure.getByRole("button", { name: "Repair a copy…" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "qpdf could not repair" }),
    ).toBeVisible();
    expect(mockfs.repaired.size).toBe(0);

    // Make the same path repairable: the copy lands next to the original with a new name.
    mockfs.entries[P.corrupt] = { file: "damaged-xref.pdf" };
    await failure.getByRole("button", { name: "Repair a copy…" }).click();
    const target = "C:\\Corpus\\corrupt (repaired).pdf";
    await expect(page.getByRole("tab", { name: /corrupt \(repaired\)\.pdf/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mockfs.repaired.get(target)).toBe(P.corrupt);
    await waitForPainted(page, 0);
  });

  test("password-protected files prompt for the password", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.encrypted]);
    const pw = page.getByLabel("Document password");
    await expect(pw).toBeVisible();
    await pw.fill("wrong");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByText("That password is not correct.")).toBeVisible();
    await page.getByLabel("Document password").fill("corpus-user");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await waitForPainted(page, 0);
  });
});
