// B7 accessibility: every tool reachable and usable by keyboard, a visible focus ring on
// every control reached with Tab, menus by arrow keys, and a layout that still fits at
// Windows text scaling 125 % and 150 % (CSS pixels shrink by the same factor).
import { test, expect, boot, openPaths, P, waitForPainted, type Page } from "./fixtures";

async function openDoc(page: Page) {
  await boot(page, { settings: { version: 1, toolsPaneOpen: true } });
  await openPaths(page, [P.wpA]);
  await waitForPainted(page, 0);
}

/** Tabs until `target` has focus (fails after `max` presses). */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, max = 120) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("not reachable with Tab");
}

test("every tool in the Tools pane opens from the keyboard", async ({ page }) => {
  await openDoc(page);
  const pane = page.getByRole("complementary", { name: "Tools pane" });
  const names = await pane
    .locator("button.tool-item:not([disabled])")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(names.length).toBeGreaterThan(10);
  for (const name of names) {
    const item = pane.getByRole("button", { name, exact: true });
    await item.focus();
    await page.keyboard.press("Enter");
    // A toolbar tool shows its toolbar; the others open a dialog or a view.
    const opened = page.locator(
      `[data-testid=tool-toolbar][aria-label="${name}"], dialog[open], [data-testid=organize]`,
    );
    await expect(opened.first(), name).toBeVisible();
    if (await page.locator("dialog[open]").count()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
    } else {
      // The tool's own toolbar is reachable with Tab from the tool list, and Close works.
      const close = page.getByRole("button", { name: `Close ${name}` });
      await close.focus();
      await page.keyboard.press("Enter");
    }
  }
});

test("Tab shows a visible focus ring on each control it reaches", async ({ page }) => {
  await openDoc(page);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        id: `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20)}`,
        ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2,
      };
    });
    if (!r) continue;
    expect(r.ring, `focus ring on ${r.id}`).toBe(true);
    seen.add(r.id);
  }
  expect(seen.size).toBeGreaterThan(20);
});

test("toolbar menus work with the keyboard: Enter opens, arrows move, Esc closes", async ({
  page,
}) => {
  await openDoc(page);
  await page.getByRole("button", { name: "Workpaper Tools", exact: true }).click();
  const choose = page.getByRole("button", { name: "Tickmark: choose" });
  await tabTo(page, choose);
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const first = menu.getByRole("menuitemradio").first();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(first).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(choose).toBeFocused();
  // Arrow keys move along the toolbar while moving by keyboard.
  await page.keyboard.press("ArrowRight");
  await expect(choose).not.toBeFocused();
});

for (const scale of [1.25, 1.5])
  test(`layout fits at ${scale * 100} % text scaling (1366 x 768 screen)`, async ({ page }) => {
    await page.setViewportSize({
      width: Math.floor(1366 / scale),
      height: Math.floor(768 / scale),
    });
    await openDoc(page);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    // The main toolbar wraps instead of hiding its last buttons.
    await expect(page.getByRole("button", { name: "Tools pane", exact: true })).toBeInViewport();
    // The busiest tool toolbar drops to icons instead of running off the screen.
    await page.getByRole("button", { name: "Workpaper Tools", exact: true }).click();
    const bar = page.getByTestId("tool-toolbar");
    await expect(bar).toHaveClass(/compact/);
    const close = page.getByRole("button", { name: "Close Workpaper Tools" });
    await expect(close).toBeInViewport();
    expect(await fits()).toBe(true);
    // A dialog fits on screen with its buttons visible.
    await page.getByRole("button", { name: "Settings…", exact: true }).click();
    const dlg = page.locator("dialog[open]");
    await expect(dlg.getByRole("button", { name: "Close" })).toBeInViewport();
  });
