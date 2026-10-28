// Phase 6: filling forms in the viewer (EmbedPDF form plugin, our own text field).
// Every check reads the SAVED file with pdf.js, which shares no code with the app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import {
  CORPUS,
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  test,
  waitForPainted,
  type MockFs,
  type Page,
} from "./fixtures";

const FORM = "C:\\Corpus\\acroform.pdf";

async function savedValues(page: Page, mockfs: MockFs): Promise<Record<string, unknown>> {
  const writes = mockfs.writes.length;
  await page.keyboard.press("Control+s");
  await expect.poll(() => mockfs.writes.length, { timeout: 15_000 }).toBe(writes + 1);
  const task = getDocument({ data: new Uint8Array(bytesAt(mockfs, FORM)) });
  const pdf = await task.promise;
  const objs = (await pdf.getFieldObjects()) as Map<string, { value?: unknown }[]>;
  const out: Record<string, unknown> = {};
  for (const [k, list] of objs) out[k] = list.find((o) => o.value !== undefined)?.value;
  await task.destroy();
  return out;
}

/** Clicks a point given in PDF points on the 612x792 page (pdf-lib's bottom-left origin). */
async function clickAt(page: Page, x: number, y: number) {
  const pg = page.locator('[data-testid=viewport] [data-page-index="0"]');
  const box = (await pg.boundingBox())!;
  await page.mouse.click(box.x + (x / 612) * box.width, box.y + ((792 - y) / 792) * box.height);
}

const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

test.describe("Fill forms", () => {
  test.beforeEach(async ({ page, mockfs }) => {
    mockfs.entries[FORM] = { bytes: readFileSync(join(CORPUS, "acroform.pdf")) };
    await boot(page);
    await openPaths(page, [FORM]);
    await waitForPainted(page, 0);
    await idle(page);
  });

  test("every field type fills and saves", async ({ page, mockfs }) => {
    await expect(page.getByTestId("form-text-fill").first()).toBeAttached();
    await field(page, "taxpayer.name").click();
    await page.keyboard.type("Jane Sample");
    await page.getByRole("combobox", { name: "tax.year" }).selectOption("2024");
    await clickAt(page, 288, 628); // filing status: the 2nd button ("mfj")
    await clickAt(page, 208, 588); // signed 8879
    await field(page, "notes").click();
    await page.keyboard.type("Line one\nLine two");
    expect(await savedValues(page, mockfs)).toMatchObject({
      "taxpayer.name": "Jane Sample",
      "tax.year": "2024",
      "filing.status": "mfj",
      "signed.8879": "Yes",
      notes: expect.stringMatching(/^Line one\r\n?Line two$/),
    });
  });

  test("fast typing then Tab keeps every character", async ({ page, mockfs }) => {
    for (const value of ["Jane Sample", "Second Try 22", "x", "Fourth value!", "Last"]) {
      const name = field(page, "taxpayer.name");
      await name.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
      expect((await savedValues(page, mockfs))["taxpayer.name"]).toBe(value);
    }
  });

  test("Tab moves through the fields in order", async ({ page }) => {
    await field(page, "taxpayer.name").click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "tax.year" })).toBeFocused();
  });

  test("one undo step per field edit; Esc puts the value back", async ({ page, mockfs }) => {
    await field(page, "taxpayer.name").click();
    await page.keyboard.type("Alpha");
    await page.keyboard.press("Tab");
    await field(page, "notes").click();
    await page.keyboard.type("Beta");
    await page.keyboard.press("Escape");
    await expect(field(page, "notes")).toHaveValue("");
    await field(page, "notes").click();
    await page.keyboard.type("Gamma");
    await page.mouse.click(5, 300);
    await expect(field(page, "notes")).toHaveValue("Gamma");
    await page.keyboard.press("Control+z");
    await expect(field(page, "notes")).toHaveValue("");
    await expect(field(page, "taxpayer.name")).toHaveValue("Alpha");
    expect(await savedValues(page, mockfs)).toMatchObject({ "taxpayer.name": "Alpha", notes: "" });
  });

  test("Ctrl+S while still typing saves what was typed", async ({ page, mockfs }) => {
    await field(page, "taxpayer.name").click();
    await page.keyboard.type("Still typing");
    expect((await savedValues(page, mockfs))["taxpayer.name"]).toBe("Still typing");
  });
});

/** acroform.pdf with the name and the 8879 checkbox marked required. */
async function requiredForm(): Promise<Buffer> {
  const pdf = await PDFDocument.load(readFileSync(join(CORPUS, "acroform.pdf")));
  const form = pdf.getForm();
  form.getTextField("taxpayer.name").enableRequired();
  form.getCheckBox("signed.8879").enableRequired();
  return Buffer.from(await pdf.save());
}

test.describe("Fill Forms tool", () => {
  test.beforeEach(async ({ page, mockfs }) => {
    mockfs.entries[FORM] = { bytes: await requiredForm() };
    await boot(page);
    await openPaths(page, [FORM]);
    await waitForPainted(page, 0);
    await idle(page);
    await page.getByRole("button", { name: "Fill Forms", exact: true }).click();
  });
  const panel = (page: Page) => page.getByTestId("forms-panel");

  test("Highlight tints fields and outlines required ones; the button turns it off", async ({
    page,
  }) => {
    await expect(page.getByTestId("viewport")).toHaveClass(/forms-highlight/);
    await expect(
      page.locator('.form-widget[data-required][data-field="taxpayer.name"]'),
    ).toHaveCount(1);
    await page
      .getByTestId("tool-toolbar")
      .getByRole("button", { name: /^Highlight fields/ })
      .click();
    await expect(page.getByTestId("viewport")).not.toHaveClass(/forms-highlight/);
  });

  test("Check required lists empty required fields and goes to one", async ({ page }) => {
    await panel(page).getByRole("button", { name: "Check required fields" }).click();
    const result = page.getByTestId("forms-required");
    await expect(result).toContainText("2 required fields are empty");
    await result.getByRole("button", { name: "taxpayer.name" }).click();
    await expect(field(page, "taxpayer.name")).toBeFocused();
    await page.keyboard.type("Jane Sample");
    await page.keyboard.press("Tab");
    await page.locator('.form-widget[data-field="signed.8879"]').click();
    await expect(result).toContainText("All required fields are filled.");
  });

  test("Clear selected empties only the picked fields, one undo step", async ({ page, mockfs }) => {
    await field(page, "taxpayer.name").click();
    await page.keyboard.type("Jane Sample");
    await field(page, "notes").click();
    await page.keyboard.type("Keep me");
    await page.keyboard.press("Tab");
    await panel(page).getByRole("checkbox", { name: "Pick taxpayer.name" }).check();
    await panel(page).getByRole("button", { name: "Clear 1 selected" }).click();
    await idle(page);
    await expect(field(page, "taxpayer.name")).toHaveValue("");
    await expect(field(page, "notes")).toHaveValue("Keep me");
    await page.keyboard.press("Control+z");
    await idle(page);
    await expect(field(page, "taxpayer.name")).toHaveValue("Jane Sample");
    expect(await savedValues(page, mockfs)).toMatchObject({
      "taxpayer.name": "Jane Sample",
      notes: "Keep me",
    });
  });

  test("Reset form asks, then empties every field", async ({ page, mockfs }) => {
    await field(page, "taxpayer.name").click();
    await page.keyboard.type("Jane Sample");
    await page.getByRole("combobox", { name: "tax.year" }).selectOption("2024");
    await page.locator('.form-widget[data-field="signed.8879"]').click();
    await panel(page).getByRole("button", { name: "Reset form" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
    await idle(page);
    expect(await savedValues(page, mockfs)).toMatchObject({
      "taxpayer.name": "",
      "tax.year": null,
      "signed.8879": "Off",
    });
  });
});
