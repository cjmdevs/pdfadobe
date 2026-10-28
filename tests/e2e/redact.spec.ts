// Phase 5: Redact in the app. Find the SSNs, draw boxes over the field and the image
// zone, review, Apply: a new "<name>_Redacted.pdf" holds no trace of the SSN and opens.
// Leaving one SSN unmarked makes the leak check refuse to write anything.
import { FAKE_SSN } from "../corpus/generate.mjs";
import { rawHits } from "../helpers/leak-scan";
import { P, boot, bytesAt, expect, openPaths, test, waitForPainted, type Page } from "./fixtures";

const tb = (page: Page, name: string) =>
  page.getByTestId("tool-toolbar").getByRole("button", { name, exact: true });

/** Drags on page 1 between two points given as fractions of the page. */
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 5 });
  await page.mouse.up();
}

async function openRedact(page: Page) {
  await boot(page);
  await openPaths(page, [P.ssn]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Redact", exact: true }).click();
  return page.getByTestId("redact-panel");
}

test("find, mark, review and apply: the new file holds no SSN", async ({ page, mockfs }) => {
  const panel = await openRedact(page);
  await panel.getByRole("button", { name: "Find", exact: true }).click();
  await expect(panel.getByTestId("redact-found")).toContainText("3 found");
  await panel.getByRole("button", { name: "Mark all 3" }).click();
  await expect(panel.getByTestId("redact-review").locator("li")).toHaveCount(3);

  // Boxes over the form field (200,560 160x22) and the image zone (60,400 200x70).
  await tb(page, "Mark an area: drag a box over what to remove").click();
  await drag(page, 0.32, 0.26, 0.6, 0.3);
  await drag(page, 0.09, 0.4, 0.43, 0.5);
  await page.keyboard.press("Escape");
  const review = panel.getByTestId("redact-review").locator("li");
  await expect(review).toHaveCount(5);
  await expect(page.getByTestId("redact-mark")).toHaveCount(5);

  await panel.getByRole("button", { name: "Accept all" }).click();
  await panel.getByTestId("redact-apply").click();
  await expect(page.locator(".toast", { hasText: "Redacted 5 mark(s)" })).toContainText(
    "into a new file",
  );
  const written = mockfs.writes.map((w) => w.path);
  expect(written).toEqual(["C:\\Corpus\\ssn-redaction_Redacted.pdf"]);
  expect(rawHits(bytesAt(mockfs, written[0]!), FAKE_SSN)).toEqual([]);
  // The original is untouched and the redacted file is open in a new tab.
  await expect(page.getByRole("tab", { name: /ssn-redaction_Redacted\.pdf/ })).toBeVisible();
});

test("an SSN left unmarked: nothing is written", async ({ page, mockfs }) => {
  const panel = await openRedact(page);
  await panel.getByRole("button", { name: "Find", exact: true }).click();
  await panel.getByRole("button", { name: "Mark all 3" }).click();
  // Reject the page-2 hit: the leak check must find that SSN and refuse.
  const review = panel.getByTestId("redact-review").locator("li");
  await review.filter({ hasText: "Page 2" }).getByRole("button", { name: "Reject" }).click();
  await panel.getByRole("button", { name: "Accept all" }).click();
  await panel.getByTestId("redact-apply").click();
  await expect(page.locator(".toast.error")).toContainText("Not saved");
  await expect(page.locator(".toast.error")).toContainText("page 2");
  await expect(page.locator(".toast.error")).not.toContainText(FAKE_SSN);
  expect(mockfs.writes).toEqual([]);
});
