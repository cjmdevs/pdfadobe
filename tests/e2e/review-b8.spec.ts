// Fixes from the B8 code review: a top bar button that opens its tool keeps what it
// started, the Hand tool lets go, right-click menus give focus back, two-up paging is not
// a jump, the top bar re-fits, Add divider, the Snap distance box.
import { P, boot, expect, openPaths, pages, test, waitForPainted, type Page } from "./fixtures";

async function open(page: Page, path: string) {
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
}

test.describe("B8 review fixes", () => {
  test("Redact > Draw box on the top bar opens Redact and stays armed", async ({ page }) => {
    await boot(page, {
      settings: { topBar: { bar: ["bar:open", "redact.drawBox", "bar:spacer"], menus: {} } },
    });
    await open(page, P.wpA);
    await page
      .getByTestId("top-bar")
      .getByRole("button", { name: /^Mark an area/ })
      .click();
    await expect(page.getByTestId("tool-toolbar")).toBeVisible();
    const box = (await pages(page).first().boundingBox())!;
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 140, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId("redact-mark")).toHaveCount(1);
  });
});
