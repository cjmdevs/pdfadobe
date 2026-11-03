// B7 UI audit: screenshots of every screen and state, light and dark, at the two screen
// sizes the firm uses. Not part of the normal suite: runs only with UI_SHOTS=<folder>
// (`npm run ui:shots -- docs/ui/audit`). Synthetic corpus files only.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, boot, openPaths, P, waitForPainted, idle, type Page } from "./fixtures";

const OUT = process.env.UI_SHOTS;
const SIZES = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1366", width: 1366, height: 768 },
] as const;
const THEMES = ["light", "dark"] as const;

test.skip(!OUT, "set UI_SHOTS to a folder to capture the B7 audit screenshots");
test.describe.configure({ mode: "parallel" });

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

for (const size of SIZES)
  for (const theme of THEMES) {
    const dir = () => {
      const d = join(OUT!, `${size.name}-${theme}`);
      mkdirSync(d, { recursive: true });
      return d;
    };
    const shot = async (page: Page, name: string) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(dir(), `${name}.png`) });
    };
    const start = async (page: Page, launch: string[] = []) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await boot(page, { launch, settings: { version: 1, theme, toolsPaneOpen: true } });
    };

    test.describe(`${size.name} ${theme}`, () => {
      test.setTimeout(600_000);

      test("shell and states", async ({ page }) => {
        await start(page);
        await shot(page, "01-start-empty");
        await page.keyboard.press("Control+Shift+/").catch(() => {});

        await openPaths(page, [P.locked]);
        await page.waitForTimeout(800);
        await shot(page, "02-error-locked");
        await openPaths(page, [P.offline]);
        await page.waitForTimeout(800);
        await shot(page, "03-error-network");
        await openPaths(page, [P.corrupt]);
        await page.waitForTimeout(800);
        await shot(page, "04-error-corrupt");
        await openPaths(page, [P.encrypted]);
        await page.waitForTimeout(800);
        await shot(page, "05-password-prompt");
        await page.keyboard.press("Escape");

        await openPaths(page, [P.long500]);
        await page.waitForTimeout(150);
        await shot(page, "06-loading");
        await openPaths(page, [P.nav]);
        await waitForPainted(page, 0);
        await shot(page, "07-viewer");

        for (const tab of ["Outline", "Attachments", "Thumbnails"]) {
          const b = page.getByRole("tab", { name: tab });
          if (await b.count()) {
            await b.first().click();
            await shot(page, `08-sidebar-${slug(tab)}`);
          }
        }
        await page.keyboard.press("Control+f");
        await shot(page, "09-search");
        await page.keyboard.press("Escape");

        for (const label of [
          "Settings",
          "Customize",
          "Keyboard shortcuts",
          "Document properties",
        ]) {
          const b = page.getByRole("button", { name: label, exact: false });
          if (!(await b.count())) continue;
          await b.first().click();
          await shot(page, `10-dialog-${slug(label)}`);
          await page.keyboard.press("Escape");
        }
      });

      test("tools", async ({ page }) => {
        await start(page, [P.wpA]);
        await waitForPainted(page, 0);
        const pane = page.getByRole("complementary", { name: "Tools pane" });
        await expect(pane).toBeVisible();
        const names = await pane
          .locator("button.tool-item:not([disabled])")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
        // Closes dialogs, menus and popovers: Cancel/Close first (some dialogs ignore Esc).
        const closeAll = async () => {
          for (let k = 0; k < 4; k++) {
            const open = page.locator("dialog[open], [role=dialog]").last();
            if (!(await open.count())) break;
            const btn = open.getByRole("button", { name: /^(Cancel|Close)$/ }).first();
            if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {});
            else await page.keyboard.press("Escape");
            await page.waitForTimeout(150);
          }
          await page.keyboard.press("Escape");
        };
        const failed: string[] = [];
        let n = 0;
        for (const name of names) {
          n++;
          const id = `${String(n).padStart(2, "0")}-${slug(name)}`;
          try {
            await closeAll();
            await pane.getByRole("button", { name, exact: true }).click({ timeout: 5000 });
            await page.waitForTimeout(500);
            await shot(page, `20-tool-${id}`);
            // Each toolbar button that opens a dialog ("…") or a menu.
            const bar = page.getByTestId("tool-toolbar");
            if (!(await bar.count())) continue;
            const buttons = await bar.locator("button:not([disabled])").evaluateAll((els) =>
              els.map((e, i) => ({
                i,
                label: e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent,
                menu: e.getAttribute("aria-haspopup") !== null,
              })),
            );
            for (const b of buttons) {
              if (!b.label || !(b.menu || /…$/.test(b.label))) continue;
              try {
                await bar.locator("button:not([disabled])").nth(b.i).click({ timeout: 5000 });
                await page.waitForTimeout(400);
                await shot(page, `20-tool-${id}--${slug(b.label)}`);
              } catch {
                failed.push(`${name} / ${b.label}`);
              }
              await closeAll();
            }
          } catch {
            failed.push(name);
          } finally {
            await closeAll();
            if (await page.getByTestId("organize").count()) await idle(page).catch(() => {});
          }
        }
        if (failed.length)
          console.log(`not captured (${size.name} ${theme}): ${failed.join("; ")}`);
      });
    });
  }
