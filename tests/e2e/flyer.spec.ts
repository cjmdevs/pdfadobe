// Phase 4 stage 1: tickmarks from the Workpaper Tools toolbar. Placed until Esc, listed
// in the Stamp Summary, saved as /Stamp annotations (read back with qpdf), and found
// again after the file is reopened.
import { inspectAnnots } from "../helpers/annot-inspect";
import {
  P,
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  test,
  waitForPainted,
  type Page,
} from "./fixtures";

const tb = (page: Page, name: string) =>
  page.getByTestId("tool-toolbar").getByRole("button", { name, exact: true });

async function clickPage(page: Page, fx: number, fy: number) {
  const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test("place tickmarks until Esc, see them in the Stamp Summary, save and reopen", async ({
  page,
  mockfs,
}) => {
  await boot(page);
  await openPaths(page, [P.text]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Workpaper Tools", exact: true }).click();
  const summary = page.getByTestId("stamp-summary");
  await expect(summary).toContainText("Stamp Summary (0)");

  // Pick "Footed" from the library dropdown: it is armed and stays armed.
  await page.getByRole("button", { name: "Tickmark: choose" }).click();
  await page.getByRole("menuitemradio", { name: "Footed", exact: true }).click();
  await clickPage(page, 0.3, 0.2);
  await clickPage(page, 0.3, 0.25);
  await expect(summary).toContainText("Stamp Summary (2)");
  // Number key 1 switches to the first tickmark (Agrees to); Esc stops placing.
  await page.keyboard.press("1");
  await clickPage(page, 0.3, 0.3);
  await expect(summary).toContainText("Stamp Summary (3)");
  await page.keyboard.press("Escape");
  await expect(
    tb(page, "Place the active tickmark (click the page for each one, Esc stops)"),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(summary.getByRole("button", { name: /^Agrees to/ })).toHaveCount(1);

  // Recent lists them; Clear Recent Stamps empties it.
  await tb(page, "Recent tickmarks").click();
  await expect(page.getByRole("menuitemradio", { name: "Agrees to", exact: true })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Clear Recent Stamps" }).click();
  await tb(page, "Recent tickmarks").click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Legend of what is used.
  await tb(page, "Insert a legend of the tickmarks used in this document").click();
  await clickPage(page, 0.7, 0.2);
  await expect(summary).toContainText("Stamp Summary (4)");

  await page.keyboard.press("Control+s");
  await idle(page);
  const stamps = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
    (a) => a.subtype === "/Stamp",
  );
  expect(stamps.map((s) => s.subject).sort()).toEqual([
    "Tickmark legend",
    "Tickmark: Agrees to",
    "Tickmark: Footed",
    "Tickmark: Footed",
  ]);
  expect(stamps.every((s) => s.hasAppearance)).toBe(true);

  // A later session: close and open the saved file again.
  await page.keyboard.press("Control+w");
  await openPaths(page, [P.text]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Workpaper Tools", exact: true }).click();
  await expect(page.getByTestId("stamp-summary")).toContainText("Stamp Summary (4)");
});
