// Document properties dialog; printing (browser fallback path + permission check).
// Native Windows printing (print dialog + PDFium to the printer) is covered by Rust unit
// tests for page placement and by the manual Windows check in docs/progress.md.
import { P, boot, expect, openPaths, test, waitForPainted } from "./fixtures";

test.describe("document properties", () => {
  test("shows title, author, page size, PDF version and security", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.nav]);
    await waitForPainted(page, 0);
    await page.keyboard.press("Control+d");
    const dlg = page.getByRole("dialog", { name: "Document Properties" });
    await expect(dlg).toBeVisible();
    const field = (k: string) => dlg.locator(`dd[data-field="${k}"]`);
    await expect(field("File")).toHaveText(P.nav);
    await expect(field("Title")).toHaveText("Synthetic navigation fixture");
    await expect(field("Author")).toHaveText("PDF Workbench test corpus");
    await expect(field("Subject")).toHaveText("Outline, attachments, mixed page sizes");
    await expect(field("PDF version")).toHaveText("1.7");
    await expect(field("Page count")).toHaveText("8");
    await expect(field("Page size")).toHaveText("8.50 x 11.00 in (Letter) (page 1)");
    await expect(field("Security method")).toHaveText("No security");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);

    // Page size follows the current page: page 3 is Legal.
    await page.getByLabel("Page number").fill("3");
    await page.getByLabel("Page number").press("Enter");
    await page.getByRole("button", { name: "Document properties (Ctrl+D)" }).click();
    await expect(field("Page size")).toHaveText("8.50 x 14.00 in (Legal) (page 3)");
  });

  test("shows password security and restrictions", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.noPrint]);
    await waitForPainted(page, 0);
    await page.keyboard.press("Control+d");
    const dlg = page.getByRole("dialog", { name: "Document Properties" });
    await expect(dlg.locator('dd[data-field="Security method"]')).toHaveText("Password security");
    await expect(dlg.getByTestId("security")).toContainText("PrintingNot allowed");
    await expect(dlg.getByTestId("security")).toContainText("Content copyingNot allowed");
  });
});

test.describe("print", () => {
  test("outside the Windows app, Ctrl+P hands a print-ready PDF to the WebView print path", async ({
    page,
  }) => {
    await boot(page);
    await openPaths(page, [P.nav]);
    await waitForPainted(page, 0);
    // Keep a print dialog from opening in the test browser. Best effort: with Chromium's
    // PDF viewer (Windows) the frame's print() may not be reachable, which is fine here.
    await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!;
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        get() {
          const w = desc.get!.call(this) as Window | null;
          try {
            if (w) w.print = () => undefined;
          } catch {
            // cross-origin viewer frame
          }
          return w;
        },
      });
    });
    await page.keyboard.press("Control+p");
    // The print frame receives a print-ready PDF (annotations flattened by the engine).
    const frame = page.locator('iframe[src^="blob:"]');
    await expect(frame).toBeAttached({ timeout: 15_000 });
    const src = await frame.first().getAttribute("src");
    const head = await page.evaluate(async (u) => {
      const b = new Uint8Array(await (await fetch(u!)).arrayBuffer());
      return String.fromCharCode(...b.slice(0, 5));
    }, src);
    expect(head).toBe("%PDF-");
  });

  test("printing is refused when the document's security forbids it", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.noPrint]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Print (Ctrl+P)" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "do not allow printing" }),
    ).toBeVisible();
  });
});
