// Phase 6: filling forms in the viewer (EmbedPDF form plugin, our own text field).
// Every check reads the SAVED file with pdf.js, which shares no code with the app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { parseFdf } from "../../src/engine/forms/data";
import {
  CORPUS,
  boot,
  bytesAt,
  expect,
  idle,
  openPaths,
  queueChoices,
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

async function valuesOf(bytes: Buffer): Promise<Record<string, unknown>> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const objs = (await pdf.getFieldObjects()) as Map<string, { value?: unknown }[]>;
  const out: Record<string, unknown> = {};
  for (const [k, list] of objs) out[k] = list.find((o) => o.value !== undefined)?.value;
  await task.destroy();
  return out;
}

async function chooseFile(page: Page, click: () => Promise<void>, name: string, text: string) {
  const chooser = page.waitForEvent("filechooser");
  await click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
}

test.describe("Form data", () => {
  test.beforeEach(async ({ page, mockfs }) => {
    mockfs.entries[FORM] = { bytes: readFileSync(join(CORPUS, "acroform.pdf")) };
    await boot(page);
    await openPaths(page, [FORM]);
    await waitForPainted(page, 0);
    await idle(page);
    await page.getByRole("button", { name: "Fill Forms", exact: true }).click();
  });
  const panel = (page: Page) => page.getByTestId("forms-panel");

  test("Export FDF writes the typed values next to the form", async ({ page, mockfs }) => {
    await field(page, "taxpayer.name").click();
    await page.keyboard.type("Jane Sample");
    await page.keyboard.press("Tab");
    await panel(page).getByRole("button", { name: "FDF", exact: true }).click();
    const out = String.raw`C:\Corpus\acroform data.fdf`;
    await expect.poll(() => mockfs.writes.map((w) => w.path)).toContain(out);
    const fdf = await parseFdf(new Uint8Array(bytesAt(mockfs, out)));
    expect(fdf).toMatchObject({ "taxpayer.name": "Jane Sample", "signed.8879": "Off" });
  });

  test("Import JSON fills the form in one undoable step and names what it skipped", async ({
    page,
  }) => {
    const json = JSON.stringify({
      fields: { "taxpayer.name": "From JSON", "tax.year": "2025", "no.such.field": "x" },
    });
    await chooseFile(
      page,
      () => panel(page).getByRole("button", { name: "Import data…" }).click(),
      "data.json",
      json,
    );
    await idle(page);
    await expect(field(page, "taxpayer.name")).toHaveValue("From JSON");
    await expect(page.getByRole("combobox", { name: "tax.year" })).toHaveValue("2025");
    await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toContainText(
      "match no field",
    );
    await page.keyboard.press("Control+z");
    await idle(page);
    await expect(field(page, "taxpayer.name")).toHaveValue("");
  });

  test("Fill from CSV writes one PDF per row; SSN columns cannot name files", async ({
    page,
    mockfs,
  }) => {
    const csv =
      "taxpayer.name,tax.year,signed.8879,ssn\r\n" +
      "Alpha One,2023,Yes,000-12-3456\r\n" +
      "Beta Two,2024,,000-12-3457\r\n" +
      '"Gamma, Three",2025,x,000-12-3458\r\n';
    await chooseFile(
      page,
      () => panel(page).getByRole("button", { name: "Choose CSV…" }).click(),
      "clients.csv",
      csv,
    );
    const box = page.getByTestId("forms-csv");
    await expect(box).toContainText("3 rows, 3 of 4 columns match");
    const select = box.getByRole("combobox");
    const ssn = select.locator("option", { hasText: "holds SSNs" });
    expect(await ssn.evaluate((o) => (o as HTMLOptionElement).disabled)).toBe(true);
    await select.selectOption("taxpayer.name");
    const dir = String.raw`C:\Out`;
    await queueChoices(page, { folders: [dir] });
    await box.getByRole("button", { name: "Fill 3 copies…" }).click();
    const made = () => mockfs.writes.filter((w) => w.path.startsWith(`${dir}\\`));
    await expect.poll(() => made().length).toBe(3);
    const paths = made().map((w) => w.path);
    expect(paths).toEqual(
      ["Alpha One", "Beta Two", "Gamma, Three"].map((n) => `${dir}\\acroform - ${n}.pdf`),
    );
    expect(await valuesOf(bytesAt(mockfs, paths[0]!))).toMatchObject({
      "taxpayer.name": "Alpha One",
      "tax.year": "2023",
      "signed.8879": "Yes",
    });
    expect(await valuesOf(bytesAt(mockfs, paths[1]!))).toMatchObject({
      "taxpayer.name": "Beta Two",
      "signed.8879": "Off",
    });
    expect(await valuesOf(bytesAt(mockfs, paths[2]!))).toMatchObject({
      "taxpayer.name": "Gamma, Three",
      "signed.8879": "Yes",
    });
    // The form in the tab is untouched.
    await expect(field(page, "taxpayer.name")).toHaveValue("");
  });
});

test("Flatten to new file: the typed value is page text, no fields, original unchanged", async ({
  page,
  mockfs,
}) => {
  mockfs.entries[FORM] = { bytes: readFileSync(join(CORPUS, "acroform.pdf")) };
  await boot(page);
  await openPaths(page, [FORM]);
  await waitForPainted(page, 0);
  await idle(page);
  await page.getByRole("button", { name: "Fill Forms", exact: true }).click();
  await field(page, "taxpayer.name").click();
  await page.keyboard.type("Jane Flat");
  await page.keyboard.press("Tab");
  await page.getByRole("combobox", { name: "tax.year" }).selectOption("2025");
  await page.locator('.form-widget[data-field="signed.8879"]').click();
  await page.locator('.form-widget[data-field="filing.status"]').nth(1).click();
  await page
    .getByTestId("forms-panel")
    .getByRole("button", { name: "Flatten to new file" })
    .click();
  const out = String.raw`C:\Corpus\acroform (flattened form).pdf`;
  await expect.poll(() => mockfs.writes.map((w) => w.path)).toContain(out);
  const flat = new Uint8Array(bytesAt(mockfs, out));
  const task = getDocument({ data: flat.slice() });
  const pdf = await task.promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items
    .map((i) => ("str" in i ? i.str : ""))
    .join(" ");
  expect(text).toContain("Jane Flat");
  expect(text).toContain("2025");
  expect((await pdf.getFieldObjects()) ?? {}).toEqual({});
  await task.destroy();
  // The flattened copy opens in its own tab; the form's own file was not written.
  await expect(page.getByRole("tab", { name: /flattened form/ })).toBeVisible();
  expect(mockfs.writes.filter((w) => w.path === FORM)).toEqual([]);
  await waitForPainted(page, 0);
  await page.screenshot({ path: join(CORPUS, "..", "out", "forms", "flattened-tab.png") });
});
