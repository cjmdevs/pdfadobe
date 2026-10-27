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

test("sign-off stamp, connector that follows a moved tickmark, note", async ({ page, mockfs }) => {
  await boot(page);
  await openPaths(page, [P.text]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Workpaper Tools", exact: true }).click();
  const summary = page.getByTestId("stamp-summary");

  // Two tickmarks to connect.
  await page.getByRole("button", { name: "Tickmark: choose" }).click();
  await page.getByRole("menuitemradio", { name: "Footed", exact: true }).click();
  await clickPage(page, 0.25, 0.2);
  await clickPage(page, 0.6, 0.35);
  await page.keyboard.press("Escape");

  // Connector from one to the other: attached at both ends.
  await page.getByRole("button", { name: "Connector: choose" }).click();
  await page.getByRole("menuitemradio", { name: "Dashed arrow" }).click();
  await clickPage(page, 0.25, 0.2);
  await expect(page.getByTestId("connector-ghost")).toBeVisible();
  await clickPage(page, 0.6, 0.35);
  await page.keyboard.press("Escape");
  await expect(summary).toContainText("Stamp Summary (3)");

  // Prepared by: asks for the W/P reference first.
  await page.getByRole("button", { name: "Sign-off: choose" }).click();
  await page.getByRole("menuitemradio", { name: "Prepared by" }).click();
  await page.getByLabel("W/P reference").fill("A-1");
  await page.getByRole("button", { name: "Place", exact: true }).click();
  await clickPage(page, 0.5, 0.55);
  await page.keyboard.press("Escape");
  await expect(summary.getByRole("button", { name: /^Prepared by/ })).toHaveCount(1);

  // A workpaper note.
  await tb(page, "Workpaper note (drag a box, type; Esc ends)").click();
  const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.65, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.type("Agreed to bank confirmation.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await summary.getByRole("tab", { name: /Notes/ }).click();
  await expect(page.getByTestId("notes-list")).toContainText("Agreed to bank confirmation.");

  await page.keyboard.press("Control+s");
  await idle(page);
  const raw = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text)));
  const line = raw.find((a) => a.subtype === "/Line")!;
  expect(line.subject).toBe("Connector");
  expect(line.hasAppearance).toBe(true);
  expect(raw.find((a) => a.subject === "Prepared by")?.contents).toMatch(/W\/P ref: A-1/);
  expect(raw.find((a) => a.subtype === "/FreeText")?.contents).toBe("Agreed to bank confirmation.");
  const before = line.dict["/L"];

  // Move the lower tickmark (the connector's end): the connector follows. Its centre on
  // screen comes from the saved rect (PDF space, Letter page).
  const tick = raw
    .filter((a) => a.subject === "Tickmark: Footed")
    .sort((p, q) => (p.rect[1] ?? 0) - (q.rect[1] ?? 0))[0]!;
  const now = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
  const k = now.width / 612;
  const at = {
    x: now.x + (((tick.rect[0] ?? 0) + (tick.rect[2] ?? 0)) / 2) * k,
    y: now.y + (792 - ((tick.rect[1] ?? 0) + (tick.rect[3] ?? 0)) / 2) * k,
  };
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 80, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Control+s");
  await idle(page);
  const saved2 = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text)));
  // The tickmark moved...
  expect(saved2.map((a) => a.rect)).not.toContainEqual(tick.rect);
  const after = saved2.find((a) => a.subtype === "/Line")!;
  expect(after.dict["/L"]).not.toEqual(before);
});

test("a connector across two pages: a marker and a link on each page", async ({ page, mockfs }) => {
  await boot(page);
  await openPaths(page, [P.wpA]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Workpaper Tools", exact: true }).click();
  await tb(page, "Draw a connector (click the start, then the end; Esc stops)").click();
  await clickPage(page, 0.3, 0.3);
  // The end on page 2.
  await page.mouse.wheel(0, 700);
  const second = page.locator('[data-testid=viewport] [data-page-index="1"]');
  await expect(second).toBeInViewport({ ratio: 0.3 });
  const p2 = (await second.boundingBox())!;
  await page.mouse.move(p2.x + p2.width * 0.5, p2.y + 80);
  await page.mouse.click(p2.x + p2.width * 0.5, p2.y + 80);
  await page.keyboard.press("Escape");
  const summary = page.getByTestId("stamp-summary");
  await expect(summary.getByRole("button", { name: /^Connector to page 2/ })).toHaveCount(1);
  await expect(summary.getByRole("button", { name: /^Connector from page 1/ })).toHaveCount(1);

  // Selecting one end offers the jump to the other.
  await summary.getByRole("button", { name: /^Connector from page 1/ }).click();
  await page.getByRole("button", { name: "Go to the other end (page 1)" }).click();

  await page.keyboard.press("Control+s");
  await idle(page);
  const raw = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.wpA)));
  const links = raw.filter((a) => a.subtype === "/Link");
  expect(links.map((l) => l.page).sort()).toEqual([0, 1]);
  expect(raw.filter((a) => a.subtype === "/Stamp" && a.hasAppearance)).toHaveLength(2);
});
