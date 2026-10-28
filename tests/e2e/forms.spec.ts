// Phase 6: filling forms in the viewer (EmbedPDF form plugin, our own text field).
// Every check reads the SAVED file with pdf.js, which shares no code with the app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { parseFdf } from "../../src/engine/forms/data";
import {
  CORPUS,
  P,
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

test.describe("Prepare Form", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await idle(page);
    await page.getByRole("button", { name: "Prepare Form", exact: true }).click();
  });
  const panel = (page: Page) => page.getByTestId("prepare-panel");
  const save = async (page: Page, mockfs: MockFs) => {
    const writes = mockfs.writes.length;
    await page.keyboard.press("Control+s");
    await expect.poll(() => mockfs.writes.length, { timeout: 15_000 }).toBe(writes + 1);
    return new Uint8Array(bytesAt(mockfs, P.text));
  };
  async function fieldsIn(bytes: Uint8Array) {
    const task = getDocument({ data: bytes.slice() });
    const pdf = await task.promise;
    const objs = (await pdf.getFieldObjects()) as Map<
      string,
      { type: string; exportValues?: string; charLimit?: number; required?: boolean }[]
    > | null;
    const out = new Map([...(objs ?? [])].map(([k, v]) => [k, v.filter((x) => x.type)]));
    await task.destroy();
    return out;
  }
  const place = async (page: Page, label: string, x: number, y: number) => {
    await panel(page).getByRole("button", { name: label, exact: true }).click();
    await clickAt(page, x, y);
    await idle(page);
  };

  test("add a field of each kind; radio buttons share a group", async ({ page, mockfs }) => {
    await place(page, "Text", 400, 700);
    await place(page, "Check box", 400, 650);
    await place(page, "Radio button", 400, 600);
    await place(page, "Radio button", 440, 600);
    await place(page, "Dropdown", 400, 550);
    await place(page, "Date", 400, 500);
    await place(page, "Signature", 400, 440);
    const f = await fieldsIn(await save(page, mockfs));
    expect([...f.keys()].sort()).toEqual(
      ["Check Box1", "Date1", "Dropdown1", "Group1", "Signature1", "Text1"].sort(),
    );
    expect(f.get("Group1")?.map((w) => w.exportValues)).toEqual(["Choice1", "Choice2"]);
  });

  test("properties: rename, required, max length; Esc cancels placing", async ({
    page,
    mockfs,
  }) => {
    await place(page, "Text", 400, 700);
    await panel(page).getByRole("button", { name: "Check box", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(
      panel(page).getByRole("button", { name: "Check box", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    // Select the new field and set it up.
    await clickAt(page, 400, 700);
    const props = page.getByTestId("field-props");
    await expect(props).toBeVisible();
    const name = props.getByRole("textbox", { name: "Name" });
    await name.fill("client.name");
    await name.press("Enter");
    await props.getByRole("checkbox", { name: "Required" }).check();
    await props.getByRole("spinbutton", { name: "Max length" }).fill("12");
    await props.getByRole("button", { name: "Apply" }).click();
    await idle(page);
    const bytes = await save(page, mockfs);
    const f = await fieldsIn(bytes);
    expect([...f.keys()]).toEqual(["client.name"]);
    expect(f.get("client.name")?.[0]).toMatchObject({ charLimit: 12 });
    // Required is field flag bit 2 (pdf.js keeps it in the annotation data).
    const task = getDocument({ data: bytes.slice() });
    const annots = (await (await (await task.promise).getPage(1)).getAnnotations()) as {
      fieldName?: string;
      fieldFlags?: number;
    }[];
    await task.destroy();
    expect((annots.find((a) => a.fieldName === "client.name")?.fieldFlags ?? 0) & 2).toBe(2);
  });

  test("a deleted field leaves no trace in the saved file", async ({ page, mockfs }) => {
    await place(page, "Text", 400, 700);
    await place(page, "Check box", 400, 650);
    await clickAt(page, 400, 700);
    await expect(page.getByTestId("field-props")).toBeVisible();
    await page.keyboard.press("Delete");
    const bytes = await save(page, mockfs);
    expect([...(await fieldsIn(bytes)).keys()]).toEqual(["Check Box1"]);
    const qpdfLike = Buffer.from(bytes).toString("latin1");
    expect(qpdfLike).not.toContain("(Text1)");
  });

  test("signature fields show, can be selected and moved; a deleted field leaves nothing", async ({
    page,
    mockfs,
  }) => {
    await place(page, "Signature", 300, 600);
    await place(page, "Text", 400, 700);
    const sig = page.getByTestId("signature-box");
    await expect(sig).toBeVisible();
    await sig.click();
    await expect(page.getByTestId("field-props")).toBeVisible();
    const before = (await sig.boundingBox())!;
    await page.mouse.move(before.x + 20, before.y + 10);
    await page.mouse.down();
    await page.mouse.move(before.x + 80, before.y + 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await sig.boundingBox())!.x).toBeGreaterThan(before.x + 30);
    // Delete the text field: nothing of it stays drawn (fields are not baked into tiles).
    await clickAt(page, 400, 700);
    await expect(
      page.getByTestId("field-props").getByRole("textbox", { name: "Name" }),
    ).toHaveValue("Text1");
    await page.keyboard.press("Delete");
    const bytes = await save(page, mockfs);
    expect([...(await fieldsIn(bytes)).keys()]).toEqual(["Signature1"]);
    await page.getByRole("button", { name: "Close Prepare Form" }).click();
    await expect(page.locator(".form-widget")).toHaveCount(0);
    await expect(sig).toContainText("Sign in Acrobat");
  });

  test("a new field can be filled once Prepare Form is closed", async ({ page, mockfs }) => {
    await place(page, "Text", 400, 700);
    await page.getByRole("button", { name: "Close Prepare Form" }).click();
    await field(page, "Text1").click();
    await page.keyboard.type("Typed in a new field");
    await page.keyboard.press("Tab");
    const bytes = await save(page, mockfs);
    expect(await valuesOf(Buffer.from(bytes))).toMatchObject({ Text1: "Typed in a new field" });
  });
});

test("Detect fields on a flat form adds named fields in one undoable step", async ({
  page,
  mockfs,
}) => {
  const FLAT = String.raw`C:\Corpus\flat-form.pdf`;
  mockfs.entries[FLAT] = { bytes: readFileSync(join(CORPUS, "flat-form.pdf")) };
  await boot(page);
  await openPaths(page, [FLAT]);
  await waitForPainted(page, 0);
  await idle(page);
  await page.getByRole("button", { name: "Prepare Form", exact: true }).click();
  await page.getByTestId("prepare-panel").getByRole("button", { name: "Detect fields" }).click();
  await idle(page);
  await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toContainText(
    "Added 6 fields",
  );
  const writes = mockfs.writes.length;
  await page.keyboard.press("Control+s");
  await expect.poll(() => mockfs.writes.length, { timeout: 15_000 }).toBe(writes + 1);
  const task = getDocument({ data: new Uint8Array(bytesAt(mockfs, FLAT)) });
  const names = [
    ...(((await (await task.promise).getFieldObjects()) as Map<string, unknown>) ?? []),
  ].map(([k]) => k);
  await task.destroy();
  expect(names.sort()).toEqual(
    ["Client name", "Dependents", "Married", "Notes", "Preparer", "Tax year"].sort(),
  );
  // Fill mode wraps each field in .form-widget: 6 now, none after one undo.
  await page.getByRole("button", { name: "Close Prepare Form" }).click();
  await expect(page.locator(".form-widget")).toHaveCount(6);
  await page.keyboard.press("Control+z");
  await idle(page);
  await expect(page.locator(".form-widget")).toHaveCount(0);
});

test("an XFA-only form says it needs Acrobat and opens it there; hybrid forms do not", async ({
  page,
  mockfs,
}) => {
  const XFA = String.raw`C:\Corpus\xfa-only.pdf`;
  const IRS = String.raw`C:\Corpus\f1040.pdf`;
  mockfs.entries[XFA] = { bytes: readFileSync(join(CORPUS, "xfa-only.pdf")) };
  mockfs.entries[IRS] = { bytes: readFileSync(join(CORPUS, "..", "irs", "f1040.pdf")) };
  mockfs.entries[FORM] = { bytes: readFileSync(join(CORPUS, "acroform.pdf")) };
  await boot(page);
  await openPaths(page, [IRS]);
  await waitForPainted(page, 0);
  await idle(page);
  await openPaths(page, [FORM]);
  await waitForPainted(page, 0);
  await idle(page);
  await expect(page.getByTestId("xfa-notice")).toHaveCount(0);
  await openPaths(page, [XFA]);
  await waitForPainted(page, 0);
  const notice = page.getByTestId("xfa-notice");
  await expect(notice).toContainText("only works in Adobe Acrobat");
  await notice.getByRole("button", { name: "Open in Acrobat" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as { __PDFWB_ACROBAT__?: string[] }).__PDFWB_ACROBAT__))
    .toEqual([XFA]);
  // The hybrid 1040 tab shows no notice.
  await page.getByRole("tab", { name: /f1040/ }).click();
  await waitForPainted(page, 0);
  await expect(page.getByTestId("xfa-notice")).toHaveCount(0);
});

test("calculated fields update as inputs are typed; numbers show their format", async ({
  page,
  mockfs,
}) => {
  const CALC = String.raw`C:\Corpus\calc-form.pdf`;
  mockfs.entries[CALC] = { bytes: readFileSync(join(CORPUS, "calc-form.pdf")) };
  await boot(page);
  await openPaths(page, [CALC]);
  await waitForPainted(page, 0);
  await idle(page);
  await page.getByRole("button", { name: "Fill Forms", exact: true }).click();
  await expect(page.getByTestId("forms-acrobat-only")).toContainText("Custom");
  for (const [name, value] of [
    ["Wages", "1000"],
    ["Interest", "234.5"],
    ["Deduction", "3000"],
  ] as const) {
    await field(page, name).click();
    await page.keyboard.type(value);
    await page.keyboard.press("Tab");
  }
  await expect(field(page, "Wages")).toHaveValue("1,000.00");
  await expect(field(page, "Total")).toHaveValue("$1,234.50");
  await expect(field(page, "Net")).toHaveValue("($1,765.50)");
  const writes = mockfs.writes.length;
  await page.keyboard.press("Control+s");
  await expect.poll(() => mockfs.writes.length, { timeout: 15_000 }).toBe(writes + 1);
  // Saved like Acrobat: plain numbers in the values.
  expect(await valuesOf(bytesAt(mockfs, CALC))).toMatchObject({
    Wages: "1000",
    Total: "1234.5",
    Net: "-1765.5",
  });
});
