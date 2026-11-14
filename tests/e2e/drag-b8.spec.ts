// B8: drag feedback on the page: X/Y W/H readout, snap guides to page edges and other
// objects, Alt turns snapping off; see-through previews in lists.
import { P, boot, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

const tb = (page: Page, name: string) =>
  page.getByTestId("tool-toolbar").getByRole("button", { name, exact: true });

async function pageBox(page: Page) {
  return (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
}

/** Presses at one fraction of page 1 and moves to another, without releasing. */
async function pressAndMove(page: Page, from: [number, number], to: [number, number]) {
  const b = await pageBox(page);
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 6 });
}

test.describe("drag feedback (B8)", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("a redaction box shows its size and snaps to the page edge; Alt turns it off", async ({
    page,
  }) => {
    await openPaths(page, [P.ssn]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Redact", exact: true }).click();
    await tb(page, "Mark an area: drag a box over what to remove").click();
    const b = await pageBox(page);

    await pressAndMove(page, [0.004, 0.2], [0.3, 0.3]);
    const readout = page.getByTestId("box-readout");
    await expect(readout).toContainText("X 0.00 in");
    await expect(readout).toContainText("W ");
    await expect(page.getByTestId("snap-guide").first()).toBeAttached();
    await page.mouse.up();
    await expect(readout).toHaveCount(0);
    const first = (await page.getByTestId("redact-mark").last().boundingBox())!;
    expect(Math.abs(first.x - b.x)).toBeLessThan(2.5);

    await page.keyboard.down("Alt");
    await pressAndMove(page, [0.004, 0.5], [0.3, 0.6]);
    await expect(readout).not.toContainText("X 0.00 in");
    await page.mouse.up();
    await page.keyboard.up("Alt");
    const second = (await page.getByTestId("redact-mark").last().boundingBox())!;
    expect(second.x - b.x).toBeGreaterThan(1);
  });

  test("moving a comment shows X/Y and snaps it to the page edge", async ({ page }) => {
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await tb(page, "Rectangle").click();
    const b = await pageBox(page);
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.6, { steps: 6 });
    await page.mouse.up();
    await tb(page, "Rectangle").click();
    // The new rectangle is selected: drag it by its middle so its left edge nears 0.
    await pressAndMove(page, [0.35, 0.55], [0.155, 0.55]);
    const readout = page.getByTestId("box-readout");
    await expect(readout).toBeVisible();
    await expect(readout).toContainText("X 0.00 in");
    await page.mouse.up();
    await expect(readout).toHaveCount(0);
  });

  test("dragging a tab shows a see-through preview of it", async ({ page }) => {
    await openPaths(page, [P.wpA, P.wpB]);
    await waitForPainted(page, 0);
    const tabs = page.getByRole("tablist", { name: "Open documents" }).getByRole("tab");
    const a = (await tabs.filter({ hasText: "workpaper-a" }).boundingBox())!;
    await page.mouse.move(a.x + 20, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + a.height / 2, { steps: 6 });
    await expect(page.getByTestId("drag-ghost")).toContainText("workpaper-a");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
  });
});
