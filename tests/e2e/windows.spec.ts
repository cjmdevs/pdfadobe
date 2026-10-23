// Backlog B1: tabs move between windows without losing their edit history; the same file
// opened again switches to the window that has it; one quit prompt for every window.
// The browser has one window, so the other window is a stand-in (FakeWindows in
// src/platform/browser.ts): these tests cover this window's side. Real drags between
// windows are in the manual Windows check (docs/testing).
import { inspectPdf } from "../helpers/pdf-inspect";
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

interface Fake {
  queue: string[];
  moved: string[];
  focused: string[];
  closed: number;
  quits: number;
  adopt?: () => void;
  requestClose?: () => Promise<boolean>;
}

const tabs = (page: Page) => page.getByRole("tablist", { name: "Open documents" }).getByRole("tab");
const tab = (page: Page, name: string) => tabs(page).filter({ hasText: name });
const fake = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __PDFWB_FAKE_WINDOWS__: Fake }).__PDFWB_FAKE_WINDOWS__,
  );

async function bootWithWindows(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __PDFWB_FAKE_WINDOWS__: object }).__PDFWB_FAKE_WINDOWS__ = {};
  });
  await boot(page);
}

async function rotateFirstPage(page: Page) {
  await page.getByRole("button", { name: "Organize Pages", exact: true }).click();
  await page.getByTestId("grid-page").first().click();
  await page.getByTestId("tool-toolbar").getByRole("button", { name: "Rotate right" }).click();
  await idle(page);
}

/** Drags a tab by the mouse to (x, y) in page coordinates. */
async function dragTab(page: Page, name: string, x: number, y: number) {
  const box = await tab(page, name).boundingBox();
  if (!box) throw new Error(`no tab ${name}`);
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
}

test.describe("tabs and windows", () => {
  test("drag a tab along the tab bar to reorder it", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.wpA, P.wpB, P.wpC]);
    await expect(tabs(page)).toHaveCount(3);
    const c = await tab(page, "workpaper-c").boundingBox();
    await dragTab(page, "workpaper-a", c!.x + c!.width - 5, c!.y + c!.height / 2);
    await expect(tabs(page)).toHaveText([/workpaper-b/, /workpaper-c/, /workpaper-a/]);
  });

  test("a tab dragged out keeps its history and comes back with it", async ({ page }) => {
    await bootWithWindows(page);
    await openPaths(page, [P.wpA, P.wpB]);
    await tab(page, "workpaper-a").click();
    await waitForPainted(page, 0);
    await rotateFirstPage(page);
    await expect(tab(page, "workpaper-a")).toContainText("•");

    // Dropped outside the window: the tab leaves; its document stays in the store.
    const vp = page.viewportSize()!;
    await dragTab(page, "workpaper-a", vp.width - 5, vp.height + 40);
    await expect(tabs(page)).toHaveCount(1);
    const moved = (await fake(page)).moved;
    expect(moved).toHaveLength(1);

    // Opening the same file again switches to the window that has it.
    await openPaths(page, [P.wpA]);
    await expect.poll(async () => (await fake(page)).focused).toEqual(moved);
    await expect(tabs(page)).toHaveCount(1);

    // Moved back (as another window would): unsaved marker and undo come along.
    await page.evaluate((id) => {
      const f = (window as unknown as { __PDFWB_FAKE_WINDOWS__: Fake }).__PDFWB_FAKE_WINDOWS__;
      f.queue.push(id);
      f.adopt?.();
    }, moved[0]!);
    await expect(tab(page, "workpaper-a")).toContainText("•");
    await tab(page, "workpaper-a").click();
    await waitForPainted(page, 0);
    await expect(page.getByRole("button", { name: "Undo Rotate right (Ctrl+Z)" })).toBeEnabled();
    await page.keyboard.press("Control+z");
    await expect(tab(page, "workpaper-a")).not.toContainText("•");
  });

  test("right-click > Move to New Window; Ctrl+Q lists every window's unsaved files", async ({
    page,
    mockfs,
  }) => {
    await bootWithWindows(page);
    await openPaths(page, [P.wpA, P.wpB]);
    await tab(page, "workpaper-a").click();
    await waitForPainted(page, 0);
    await rotateFirstPage(page);

    await tab(page, "workpaper-a").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to New Window" }).click();
    await expect(tabs(page)).toHaveCount(1);

    // wpA is now in the other window, wpB here is unchanged: only wpA is listed.
    await page.keyboard.press("Control+q");
    await expect(page.getByTestId("quit-list")).toHaveText(P.wpA);
    await page.getByRole("button", { name: "Save and quit" }).click();
    await expect.poll(async () => (await fake(page)).quits).toBe(1);
    const saved = await inspectPdf(new Uint8Array(bytesAt(mockfs, P.wpA)));
    expect(saved.pageSizes[0]?.rotate).toBe(90);
  });

  test("closing the window asks about its unsaved files first", async ({ page }) => {
    await bootWithWindows(page);
    await openPaths(page, [P.wpA]);
    await waitForPainted(page, 0);
    expect(
      await page.evaluate(() =>
        (window as unknown as { __PDFWB_FAKE_WINDOWS__: Fake }).__PDFWB_FAKE_WINDOWS__
          .requestClose!(),
      ),
    ).toBe(true);

    await rotateFirstPage(page);
    const closes = page.evaluate(() =>
      (window as unknown as { __PDFWB_FAKE_WINDOWS__: Fake }).__PDFWB_FAKE_WINDOWS__
        .requestClose!(),
    );
    expect(await closes).toBe(false);
    await page.getByRole("button", { name: "Don’t save" }).click();
    await expect.poll(async () => (await fake(page)).closed).toBe(1);
  });
});
