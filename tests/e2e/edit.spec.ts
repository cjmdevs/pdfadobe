// B3 Edit PDF in the reader: outlines and selection (U1), in-place text editing with
// commit on Escape / a click elsewhere / Ctrl+S, one undo step per edit, refusals, and
// Add Text (U2), the Format panel and font picker (U3). Saved files are read back with
// pdf.js and qpdf (no PDFium code).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pdfjsView } from "../helpers/leak-scan";
import { inspectFonts } from "../helpers/font-inspect";
import { tableDirectory, withPostScriptName } from "../../src/engine/edit/fonts/sfnt";
import {
  P,
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

const MEMO = "C:\\Corpus\\memo.pdf";
const EDIT_SAMPLES = join(import.meta.dirname, "..", "corpus", "edit");
const require = createRequire(import.meta.url);
const STD = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
const NOTO = join(
  import.meta.dirname,
  "..",
  "..",
  "node_modules",
  "@embedpdf",
  "fonts-latin",
  "fonts",
);

/** "Restricted Test": Noto Sans renamed, marked Restricted License (fsType 0x0002). */
function restrictedFont(): Buffer {
  const b = withPostScriptName(
    new Uint8Array(readFileSync(join(NOTO, "NotoSans-Regular.ttf"))),
    "RestrictedTest",
    "Restricted Test",
  );
  new DataView(b.buffer).setUint16(tableDirectory(b).get("OS/2")!.off + 8, 0x0002);
  return Buffer.from(b);
}

/**
 * Font folders for the browser build: Liberation Sans (regular, bold) and "Restricted
 * Test" as the firm's fonts, Noto Sans as an installed Windows font (all OFL-1.1).
 */
async function serveFonts(page: Page) {
  const files: Record<string, { source: string; bytes: Buffer }> = {
    "\\\\fileserver\\Fonts\\LiberationSans-Regular.ttf": {
      source: "firm",
      bytes: readFileSync(join(STD, "LiberationSans-Regular.ttf")),
    },
    "\\\\fileserver\\Fonts\\LiberationSans-Bold.ttf": {
      source: "firm",
      bytes: readFileSync(join(STD, "LiberationSans-Bold.ttf")),
    },
    "\\\\fileserver\\Fonts\\RestrictedTest.ttf": { source: "firm", bytes: restrictedFont() },
    "C:\\Windows\\Fonts\\NotoSans-Regular.ttf": {
      source: "windows",
      bytes: readFileSync(join(NOTO, "NotoSans-Regular.ttf")),
    },
  };
  await page.route("**/__mockfonts-list**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        firm: "online",
        files: Object.entries(files).map(([path, f]) => ({
          path,
          source: f.source,
          size: f.bytes.byteLength,
          mtime: 1,
        })),
      }),
    }),
  );
  await page.route("**/__mockfonts/**", (route) => {
    const tail = new URL(route.request().url()).pathname.split("/__mockfonts/")[1] ?? "";
    const f = files[decodeURIComponent(tail)];
    return f ? route.fulfill({ body: f.bytes }) : route.fulfill({ status: 404 });
  });
}

const box = (page: Page, start: string) =>
  page.locator(`[data-testid=edit-box][data-text^="${start}"]`);
const editor = (page: Page) => page.getByTestId("edit-editor");
const toolbarButton = (page: Page, name: string) =>
  page.getByTestId("tool-toolbar").getByRole("button", { name, exact: false });

async function openEdit(page: Page) {
  await openPaths(page, [MEMO]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
  await expect(page.getByTestId("tool-toolbar")).toHaveAttribute("aria-label", "Edit PDF");
  await expect(box(page, "MEMORANDUM")).toBeVisible();
}

async function center(page: Page, start: string) {
  const b = (await box(page, start).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as const;
}

/** Waits for an edit to finish and the reloaded tab to show its outlines again. */
async function settled(page: Page) {
  await idle(page);
  await expect(page.getByTestId("edit-layer")).toBeVisible();
}

async function pageBox(page: Page) {
  return (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
}

/** Ctrl+S, then the saved file's text as pdf.js reads it. */
async function savedText(page: Page, mockfs: MockFs) {
  const writes = mockfs.writes.length;
  await page.keyboard.press("Control+s");
  await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
  const view = await pdfjsView(new Uint8Array(bytesAt(mockfs, MEMO)));
  return view.pageText[0] ?? "";
}

test.describe("Edit PDF", () => {
  test.beforeEach(async ({ page, mockfs }) => {
    mockfs.entries[MEMO] = { bytes: readFileSync(join(EDIT_SAMPLES, "memo.pdf")) };
    await serveFonts(page);
    await boot(page);
  });

  test("outlines every text box; Edit mode is on when the tool opens", async ({ page }) => {
    await openEdit(page);
    await expect(toolbarButton(page, "Edit text and images")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The memo groups into 6 boxes: heading, the label column, the value column, two
    // body paragraphs, the bullet list.
    await expect(page.getByTestId("edit-box")).toHaveCount(6);
    await expect(page.getByTestId("edit-panel")).toContainText("Click text to edit it");
  });

  test("hover highlights; a click opens the editor; Escape leaves it, then the tool", async ({
    page,
  }) => {
    await openEdit(page);
    const [x, y] = await center(page, "We selected sales");
    await page.mouse.move(x, y);
    await expect(box(page, "We selected sales")).toHaveClass(/hover/);
    await page.mouse.click(x, y);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue(/^We selected sales invoices/);
    await expect(page.getByTestId("edit-selection")).toContainText("Text box on page 1");

    // Unchanged text: Escape just closes the editor (no edit, no reload).
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    await expect(box(page, "We selected sales")).toHaveClass(/selected/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid=edit-box].selected")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
    await expect(page.getByTestId("tool-toolbar")).toHaveCount(0);
  });

  test("edit, Escape commits, one undo step, Ctrl+S saves the new text", async ({
    page,
    mockfs,
  }) => {
    await openEdit(page);
    const [x, y] = await center(page, "Two invoices dated");
    await page.mouse.click(x, y);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Reviewed with the controller.");
    await page.keyboard.press("Escape");
    await settled(page);
    // The reloaded page shows the exact PDF result, and the edited box is selected.
    await expect(box(page, "Two invoices dated")).toHaveClass(/selected/);
    expect(await savedText(page, mockfs)).toContain("Reviewed with the controller.");

    // One undo step brings the old text back.
    await page.keyboard.press("Control+z");
    await settled(page);
    expect(await savedText(page, mockfs)).not.toContain("Reviewed with the controller.");
    await page.keyboard.press("Control+y");
    await settled(page);
    expect(await savedText(page, mockfs)).toContain("Reviewed with the controller.");
  });

  test("a click elsewhere commits; Ctrl+S while typing saves the typed text", async ({
    page,
    mockfs,
  }) => {
    await openEdit(page);
    let [x, y] = await center(page, "MEMORANDUM");
    await page.mouse.click(x, y);
    // Letters the heading's embedded bold subset has (the memo embeds subsets).
    await page.keyboard.press("End");
    await page.keyboard.type(" DRAFT");
    const pb = await pageBox(page);
    await page.mouse.click(pb.x + pb.width - 10, y);
    await settled(page);
    await expect(box(page, "MEMORANDUM DRAFT")).toBeVisible();

    [x, y] = await center(page, "We selected sales");
    await page.mouse.click(x, y);
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" See AJE-07.");
    const writes = mockfs.writes.length;
    await page.keyboard.press("Control+s");
    await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
    const text = (await pdfjsView(new Uint8Array(bytesAt(mockfs, MEMO)))).pageText[0] ?? "";
    expect(text).toContain("See AJE-07.");
    expect(text).toContain("MEMORANDUM DRAFT");
  });

  test("letters the font can't show are refused and nothing changes", async ({ page }) => {
    await openEdit(page);
    const [x, y] = await center(page, "MEMORANDUM");
    await page.mouse.click(x, y);
    await page.keyboard.press("End");
    await page.keyboard.type(" \u4e2d");
    await page.keyboard.press("Escape");
    await expect(page.locator(".toast.error")).toContainText("Edit text failed");
    await expect(page.locator(".toast.error")).toContainText("\u4e2d");
    await settled(page);
    await expect(box(page, "MEMORANDUM")).toHaveAttribute("data-text", "MEMORANDUM");
  });

  test("Add Text: a click places a line, a drag sets the wrap width", async ({ page, mockfs }) => {
    await openEdit(page);
    await toolbarButton(page, "Add text").click();
    await expect(toolbarButton(page, "Add text")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-target")).toContainText("New text: click on the page");

    // Empty page below the memo, inside the visible part of the page (the page box is
    // taller than the viewport at fit-width).
    const pb = await pageBox(page);
    await page.mouse.click(pb.x + pb.width * 0.15, pb.y + pb.height * 0.5);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("Reviewed: AB 02/10/2025");
    await page.keyboard.press("Escape");
    await settled(page);
    await expect(box(page, "Reviewed: AB 02/10/2025")).toBeVisible();
    await expect(toolbarButton(page, "Add text")).toHaveAttribute("aria-pressed", "false");

    // Drag: the new text wraps at the dragged width.
    await toolbarButton(page, "Add text").click();
    const y = pb.y + pb.height * 0.56;
    await page.mouse.move(pb.x + pb.width * 0.15, y);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width * 0.35, y + 10, { steps: 4 });
    await page.mouse.up();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("Agreed to the invoice and traced to the general ledger.");
    await page.keyboard.press("Escape");
    await settled(page);
    const added = box(page, "Agreed to the invoice");
    await expect(added).toBeVisible();
    const b = (await added.boundingBox())!;
    expect(b.width).toBeLessThan(pb.width * 0.25);
    expect(b.height).toBeGreaterThan(20); // more than one line

    const text = (await savedText(page, mockfs)).replace(/\s+/g, "");
    expect(text).toContain("Reviewed:AB02/10/2025");
    expect(text).toContain("Agreedtotheinvoiceandtracedtothegeneralledger.");
  });

  test("Escape cancels Add Text before placing", async ({ page }) => {
    await openEdit(page);
    await toolbarButton(page, "Add text").click();
    await page.keyboard.press("Escape");
    await expect(toolbarButton(page, "Add text")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edit-layer")).toBeVisible();
  });

  test("the Edit button turns outlines off and on; Comment tools take over", async ({ page }) => {
    await openEdit(page);
    const editBtn = toolbarButton(page, "Edit text and images");
    await editBtn.click();
    await expect(editBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
    await editBtn.click();
    await expect(page.getByTestId("edit-layer")).toBeVisible();
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
  });

  test("encrypted documents can't be edited", async ({ page }) => {
    await openPaths(page, [P.encrypted]);
    await page.getByLabel("Document password").fill("corpus-user");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Edit PDF", exact: true }).click();
    await expect(toolbarButton(page, "Edit text and images")).toBeDisabled();
    await expect(page.getByTestId("edit-layer")).toHaveCount(0);
  });

  test.describe("Format panel", () => {
    const panel = (page: Page) => page.getByTestId("edit-panel");

    /** Clicks a box (opens the editor) and Escape: the box stays selected. */
    async function select(page: Page, start: string) {
      const [x, y] = await center(page, start);
      await page.mouse.click(x, y);
      await expect(editor(page)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(box(page, start)).toHaveClass(/selected/);
      await expect(panel(page)).toContainText("Changes apply now");
    }

    async function saveFonts(page: Page, mockfs: MockFs) {
      const writes = mockfs.writes.length;
      await page.keyboard.press("Control+s");
      await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
      return inspectFonts(new Uint8Array(bytesAt(mockfs, MEMO)));
    }

    test("lists fonts in sections: this document, standard, firm, Windows", async ({ page }) => {
      await openEdit(page);
      await select(page, "We selected sales");
      const font = panel(page).getByLabel("Font", { exact: true });
      await expect(font).toBeEnabled();
      const groups = await font
        .locator("optgroup")
        .evaluateAll((els) =>
          els.map((g) => [
            g.getAttribute("label"),
            [...g.querySelectorAll("option")].map((o) => o.textContent),
          ]),
        );
      expect(groups).toEqual([
        ["In this document", ["Liberation Sans"]],
        ["Standard PDF fonts (not embedded)", ["Helvetica", "Times", "Courier"]],
        ["Firm", ["Liberation Sans", "Restricted Test"]],
        ["Windows", ["Noto Sans"]],
      ]);
      // The selected box's own font and size are shown.
      await expect(font).toHaveValue("document:liberationsans");
      await expect(panel(page).getByLabel("Font size")).toHaveValue("11");
    });

    test("size and alignment apply to the selected box, one undo step each", async ({ page }) => {
      await openEdit(page);
      await select(page, "We selected sales");
      await panel(page).getByLabel("Font size").fill("13");
      await panel(page).getByLabel("Font size").press("Enter");
      await settled(page);
      await expect(box(page, "We selected sales")).toHaveClass(/selected/);
      await expect(panel(page).getByLabel("Font size")).toHaveValue("13");

      await panel(page).getByRole("button", { name: "Center" }).click();
      await settled(page);
      await expect(panel(page).getByLabel("Font size")).toHaveValue("13");

      // Two undo steps: back to 11 pt.
      await page.keyboard.press("Control+z");
      await settled(page);
      await page.keyboard.press("Control+z");
      await settled(page);
      await select(page, "We selected sales");
      await expect(panel(page).getByLabel("Font size")).toHaveValue("11");
    });

    test("Bold uses the real bold face from the firm folder, embedded as a subset", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      await select(page, "We selected sales");
      await panel(page).getByRole("button", { name: "Bold" }).click();
      await settled(page);
      await expect(panel(page).getByRole("button", { name: "Bold" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const fonts = await saveFonts(page, mockfs);
      expect(
        fonts.some(
          (f) => /^\/[A-Z]{6}\+LiberationSans-Bold$/.test(f.base) && f.subtype === "/Type0",
        ),
      ).toBe(true);
    });

    test("a restricted font is refused with the license warning; nothing changes", async ({
      page,
    }) => {
      await openEdit(page);
      await select(page, "We selected sales");
      await panel(page)
        .getByLabel("Font", { exact: true })
        .selectOption({ label: "Restricted Test" });
      await expect(panel(page).getByRole("alert")).toContainText(
        "This font's license does not allow embedding.",
      );
      await expect(page.getByTestId("busy")).toHaveCount(0);
      await expect(panel(page).getByLabel("Font", { exact: true })).toHaveValue(
        "document:liberationsans",
      );
    });

    test("an installed Windows font applies, embedded as a subset", async ({ page, mockfs }) => {
      await openEdit(page);
      await select(page, "Two invoices dated");
      await panel(page).getByLabel("Font", { exact: true }).selectOption({ label: "Noto Sans" });
      await settled(page);
      const fonts = await saveFonts(page, mockfs);
      expect(fonts.some((f) => /^\/[A-Z]{6}\+NotoSans/.test(f.base) && f.embedded)).toBe(true);
    });

    test("while typing, the editor shows the new size; it is written on commit", async ({
      page,
    }) => {
      await openEdit(page);
      const [x, y] = await center(page, "Two invoices dated");
      await page.mouse.click(x, y);
      await expect(editor(page)).toBeFocused();
      const size = () => editor(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const before = await size();
      await panel(page).getByLabel("Font size").fill("16");
      await panel(page).getByLabel("Font size").press("Enter");
      await expect(editor(page)).toBeVisible();
      await expect.poll(size).toBeGreaterThan(before * 1.3);
      await editor(page).focus();
      await page.keyboard.press("Escape");
      await settled(page);
      await select(page, "Two invoices dated");
      await expect(panel(page).getByLabel("Font size")).toHaveValue("16");
    });

    test("Add Text uses the panel's font: Times, not embedded", async ({ page, mockfs }) => {
      await openEdit(page);
      await toolbarButton(page, "Add text").click();
      await expect(panel(page)).toContainText("New text");
      await panel(page).getByLabel("Font", { exact: true }).selectOption({ label: "Times" });
      await panel(page).getByLabel("Font size").fill("12");
      await panel(page).getByLabel("Font size").press("Enter");
      const pb = await pageBox(page);
      await page.mouse.click(pb.x + pb.width * 0.15, pb.y + pb.height * 0.5);
      await expect(editor(page)).toBeFocused();
      await page.keyboard.type("Prepared by AB");
      await page.keyboard.press("Escape");
      await settled(page);
      await expect(box(page, "Prepared by AB")).toBeVisible();
      const fonts = await saveFonts(page, mockfs);
      expect(fonts).toContainEqual(
        expect.objectContaining({ base: "/Times-Roman", embedded: false }),
      );
    });
  });
});
