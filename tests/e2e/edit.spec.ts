// B3 Edit PDF in the reader: outlines and selection (U1), in-place text editing with
// commit on Escape / a click elsewhere / Ctrl+S, one undo step per edit, refusals, and
// Add Text (U2), the Format panel and font picker (U3), images (U4), overflow and box
// width (U5). Saved files are read back with
// pdf.js and qpdf (no PDFium code).
import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
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
    await expect(editor(page)).toHaveText(/^We selected sales invoices/);
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
      // The text's own size (each run is a span in the rich editor).
      const size = () =>
        editor(page)
          .locator("span")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
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

  test.describe("images", () => {
    const JPEG_PATH = join(import.meta.dirname, "..", "corpus", "fixtures", "photo-rgb.jpg");
    const JPEG = readFileSync(JPEG_PATH);
    const frame = (page: Page) => page.getByTestId("edit-image-frame");

    /** A small opaque PNG (8 x 8, blue). */
    function png(): Buffer {
      const w = 8;
      const raw = new Uint8Array((w * 3 + 1) * w);
      for (let y = 0; y < w; y++)
        for (let x = 0; x < w; x++) raw.set([30, 60, 200], y * (w * 3 + 1) + 1 + x * 3);
      const table = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      });
      const crc = (b: Uint8Array) => {
        let c = 0xffffffff;
        for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
      const chunk = (type: string, data: Uint8Array) => {
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0);
        out.write(type, 4, "latin1");
        out.set(data, 8);
        out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
        return out;
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(w, 4);
      ihdr.set([8, 2, 0, 0, 0], 8);
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlibSync(raw)),
        chunk("IEND", new Uint8Array(0)),
      ]);
    }

    async function pick(
      page: Page,
      name: string,
      buffer: Buffer,
      mimeType: string,
      click: () => Promise<void>,
    ) {
      const chooser = page.waitForEvent("filechooser");
      await click();
      await (await chooser).setFiles({ name, mimeType, buffer });
    }

    /** Add Image with the JPEG, placed by a click in the empty part of the page. */
    async function addJpeg(page: Page) {
      await pick(page, "photo.jpg", JPEG, "image/jpeg", () =>
        toolbarButton(page, "Add image").click(),
      );
      await expect(toolbarButton(page, "Add image")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("edit-panel")).toContainText("Click on the page to place");
      const pb = await pageBox(page);
      await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5);
      await expect(page.getByTestId("edit-image-ghost")).toBeVisible();
      await page.mouse.click(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5);
      await settled(page);
      await expect(page.getByTestId("edit-image")).toHaveCount(1);
      await expect(frame(page)).toBeVisible();
    }

    const savedHasJpeg = async (page: Page, mockfs: MockFs) => {
      const writes = mockfs.writes.length;
      await page.keyboard.press("Control+s");
      await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
      return bytesAt(mockfs, MEMO).indexOf(JPEG) >= 0;
    };

    async function centre(page: Page) {
      const b = (await page.getByTestId("edit-image").boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2] as const;
    }

    test("Add Image places a JPEG, selected, stored byte-for-byte as JPEG", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      await addJpeg(page);
      await expect(page.getByTestId("edit-panel")).toContainText("Image on page 1");
      expect(await savedHasJpeg(page, mockfs)).toBe(true);
    });

    test("drag moves it; a corner resizes it in proportion; still the same JPEG", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      await addJpeg(page);
      const before = (await page.getByTestId("edit-image").boundingBox())!;
      const [x, y] = await centre(page);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 30, { steps: 5 });
      await expect(frame(page)).toHaveClass(/dragging/);
      await page.mouse.up();
      await settled(page);
      const moved = (await page.getByTestId("edit-image").boundingBox())!;
      expect(moved.x - before.x).toBeCloseTo(40, -1);
      expect(moved.y - before.y).toBeCloseTo(30, -1);
      await expect(frame(page)).toBeVisible(); // still selected

      const se = (await page.locator("[data-handle=se]").boundingBox())!;
      await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
      await page.mouse.down();
      await page.mouse.move(se.x + 60, se.y + 5, { steps: 5 });
      await page.mouse.up();
      await settled(page);
      const big = (await page.getByTestId("edit-image").boundingBox())!;
      expect(big.width).toBeGreaterThan(moved.width + 40);
      expect(big.width / big.height).toBeCloseTo(moved.width / moved.height, 1);
      // Top-left corner stayed put.
      expect(big.x).toBeCloseTo(moved.x, -1);
      expect(big.y).toBeCloseTo(moved.y, -1);
      expect(await savedHasJpeg(page, mockfs)).toBe(true);
    });

    test("rotate from the panel and with the handle (Shift snaps to 15°)", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      await page.getByTestId("edit-panel").getByRole("button", { name: "Rotate left" }).click();
      await settled(page);
      await expect(frame(page)).toHaveAttribute("style", /rotate\(-90deg\)/);

      const [cx, cy] = await centre(page);
      const r = (await page.locator("[data-handle=rotate]").boundingBox())!;
      await page.keyboard.down("Shift");
      const hx = r.x + r.width / 2;
      const hy = r.y + r.height / 2;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      // Turn the handle about 40° around the centre: Shift snaps it to a 15° step.
      const a = (40 * Math.PI) / 180;
      const [vx, vy] = [hx - cx, hy - cy];
      await page.mouse.move(
        cx + vx * Math.cos(a) - vy * Math.sin(a),
        cy + vx * Math.sin(a) + vy * Math.cos(a),
        { steps: 6 },
      );
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await settled(page);
      const style = (await frame(page).getAttribute("style")) ?? "";
      const deg = Number(/rotate\((-?[\d.]+)deg\)/.exec(style)?.[1]);
      expect(Math.abs(deg % 15)).toBeLessThan(0.01);
      expect(deg).not.toBe(-90);
    });

    test("Replace puts a PNG in the same place; Delete removes it; Ctrl+Z brings it back", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      await addJpeg(page);
      const before = (await page.getByTestId("edit-image").boundingBox())!;
      await pick(page, "blue.png", png(), "image/png", () =>
        page.getByTestId("edit-panel").getByRole("button", { name: "Replace image…" }).click(),
      );
      await settled(page);
      const after = (await page.getByTestId("edit-image").boundingBox())!;
      // A square picture fits inside the old box, centred.
      expect(after.width).toBeCloseTo(Math.min(before.width, before.height), -1);
      expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, -1);
      expect(await savedHasJpeg(page, mockfs)).toBe(false);

      await expect(frame(page)).toBeVisible();
      await page.keyboard.press("Delete");
      await settled(page);
      await expect(page.getByTestId("edit-image")).toHaveCount(0);
      await page.keyboard.press("Control+z");
      await settled(page);
      await expect(page.getByTestId("edit-image")).toHaveCount(1);
    });

    test("Delete removes a selected text box's text", async ({ page }) => {
      await openEdit(page);
      const [x, y] = await center(page, "Two invoices dated");
      await page.mouse.click(x, y);
      await page.keyboard.press("Escape");
      await expect(box(page, "Two invoices dated")).toHaveClass(/selected/);
      await page.keyboard.press("Delete");
      await settled(page);
      await expect(box(page, "Two invoices dated")).toHaveCount(0);
      await expect(box(page, "We selected sales")).toBeVisible();
    });

    test("Escape cancels placing a picked image", async ({ page }) => {
      await openEdit(page);
      await pick(page, "photo.jpg", JPEG, "image/jpeg", () =>
        toolbarButton(page, "Add image").click(),
      );
      await expect(toolbarButton(page, "Add image")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(toolbarButton(page, "Add image")).toHaveAttribute("aria-pressed", "false");
      const pb = await pageBox(page);
      await page.mouse.click(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5);
      await expect(page.getByTestId("edit-image")).toHaveCount(0);
    });
    // B3 stage 2 step 4: the Objects panel.
    const undoLabel = (page: Page) =>
      page.getByRole("button", { name: /^Undo / }).getAttribute("aria-label");
    const objects = (page: Page) => page.getByTestId("edit-objects");

    test("flip, arrange: each one undo step", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      await objects(page).getByRole("button", { name: "Flip horizontal" }).click();
      await settled(page);
      await expect.poll(() => undoLabel(page)).toContain("Flip image");
      await objects(page).getByLabel("Arrange").selectOption("back");
      await settled(page);
      await expect.poll(() => undoLabel(page)).toContain("Arrange");
      // Text boxes have no flip; their arrange works.
      await expect(objects(page).getByRole("button", { name: "Flip horizontal" })).toBeEnabled();
    });

    test("crop: drag a handle, apply; the image is smaller and stays put", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      const before = (await frame(page).boundingBox())!;
      await objects(page).getByTestId("edit-crop-start").click();
      await expect(page.getByTestId("edit-crop")).toBeVisible();
      const h = (await page.locator(".edit-handle.crop.w").boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.getByTestId("crop-apply").click();
      await settled(page);
      const after = (await frame(page).boundingBox())!;
      expect(after.width).toBeCloseTo(before.width - 40, -1);
      expect(after.x).toBeCloseTo(before.x + 40, -1);
      expect(after.y).toBeCloseTo(before.y, 0);
    });

    test("Escape cancels a crop", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      await objects(page).getByTestId("edit-crop-start").click();
      await expect(page.getByTestId("edit-crop")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("edit-crop")).toHaveCount(0);
      await expect(frame(page)).toBeVisible();
    });

    test("Edit Using hands the picture over and takes each save back", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      await objects(page).getByLabel("Edit Using").selectOption("paint");
      await expect(page.getByTestId("edit-using-status")).toContainText("Open in Paint");
      const sent = await page.evaluate(() => {
        const w = window as unknown as { __PDFWB_EXTEDIT__?: { ext: string; app: string }[] };
        return w.__PDFWB_EXTEDIT__?.map((e) => [e.ext, e.app]);
      });
      expect(sent).toEqual([["jpg", "paint"]]);
      // "Paint" saves a PNG.
      const saved = [...png()];
      await page.evaluate((b) => {
        const w = window as unknown as { __PDFWB_EXTEDIT__: { reply: Uint8Array | null }[] };
        w.__PDFWB_EXTEDIT__[0]!.reply = new Uint8Array(b);
      }, saved);
      await expect.poll(() => undoLabel(page), { timeout: 10000 }).toContain("Edit image");
      await page.getByTestId("edit-using-status").getByRole("button", { name: "Stop" }).click();
      await expect(page.getByTestId("edit-using-status")).toHaveCount(0);
      const ended = await page.evaluate(() => {
        const w = window as unknown as { __PDFWB_EXTEDIT__: { ended: boolean }[] };
        return w.__PDFWB_EXTEDIT__[0]!.ended;
      });
      expect(ended).toBe(true);
    });

    test("Ctrl+click a text box and the image, then align their left edges", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      const [x, y] = await center(page, "Two invoices dated");
      await page.keyboard.down("Control");
      await page.mouse.click(x, y);
      await page.keyboard.up("Control");
      await expect(page.getByTestId("edit-selection")).toContainText("2 objects selected");
      const textLeft = (await box(page, "Two invoices dated").boundingBox())!.x;
      await objects(page).getByLabel("Align objects").selectOption("left");
      await settled(page);
      // The box's outline has a point of air around its text; the image's has none.
      const scale = (await pageBox(page)).width / 612;
      const img = (await page.getByTestId("edit-image").boundingBox())!;
      expect(Math.abs(img.x - (textLeft + scale))).toBeLessThan(1.5);
    });

    test("W and H fields resize, keeping proportions while locked", async ({ page }) => {
      await openEdit(page);
      await addJpeg(page);
      await settled(page);
      const before = (await frame(page).boundingBox())!;
      const fields = page.getByTestId("edit-image-fields");
      await expect(fields).toBeVisible();
      await expect(page.getByTestId("edit-lock-aspect")).toBeChecked();
      await fields.getByLabel("Width").fill("1");
      await fields.getByLabel("Width").press("Enter");
      await settled(page);
      const after = (await frame(page).boundingBox())!;
      expect(await fields.getByLabel("Width").inputValue()).toBe("1");
      // Proportions kept: the height shrank by the same factor.
      expect(after.height / after.width).toBeCloseTo(before.height / before.width, 1);
    });
  });

  test.describe("overflow and box width", () => {
    test("an edit that runs into text below is flagged on the box and in the panel", async ({
      page,
    }) => {
      await openEdit(page);
      const [x, y] = await center(page, "Two invoices dated");
      await page.mouse.click(x, y);
      await page.keyboard.press("Control+End");
      await page.keyboard.type(
        " The client also agreed to review every credit memo issued in the first week of January before the year-end close.",
      );
      await page.keyboard.press("Escape");
      await settled(page);
      // Never pushed down: the list below stays where it was, and the clash is shown.
      await expect(box(page, "Two invoices dated")).toHaveClass(/overflow/);
      await expect(page.getByTestId("overflow-note")).toContainText(
        'runs into the text "• Proposed adjustment',
      );
      await expect(page.locator(".toast")).toContainText("Drag the box's edges");
    });

    test("the right-edge handle re-wraps the text at a new width (one undo step)", async ({
      page,
    }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await page.keyboard.press("Escape");
      const before = (await box(page, "We selected sales").boundingBox())!;
      const h = (await page.getByTestId("edit-width-handle").boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x - 180, h.y + h.height / 2, { steps: 6 });
      await expect(page.getByTestId("edit-width-preview")).toBeVisible();
      await page.mouse.up();
      await settled(page);
      const after = (await box(page, "We selected sales").boundingBox())!;
      expect(after.width).toBeLessThan(before.width - 150);
      expect(after.height).toBeGreaterThan(before.height + 10);
      expect(after.x).toBeCloseTo(before.x, -1);

      await page.keyboard.press("Control+z");
      await settled(page);
      const undone = (await box(page, "We selected sales").boundingBox())!;
      expect(undone.width).toBeCloseTo(before.width, -1);
    });
  });

  // B3 stage 2 step 2: move (drag, arrow keys), frame handles, X/Y/W/H, auto-fit, push.
  test.describe("box controls", () => {
    const left = async (page: Page, start: string) => (await box(page, start).boundingBox())!.x;

    test("dragging a box moves it as it is (one undo step); a click still edits", async ({
      page,
    }) => {
      await openEdit(page);
      // Relative to the page (the view may scroll a little while dragging).
      const rel = async () => {
        const b = (await box(page, "We selected sales").boundingBox())!;
        const p = await pageBox(page);
        return { x: b.x - p.x, y: b.y - p.y, width: b.width };
      };
      const before = await rel();
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 60, { steps: 8 });
      await page.mouse.up();
      await settled(page);
      await expect(editor(page)).toHaveCount(0);
      const after = await rel();
      expect(after.x - before.x).toBeCloseTo(40, -1);
      expect(after.y - before.y).toBeCloseTo(60, -1);
      expect(after.width).toBeCloseTo(before.width, 0);
      await page.keyboard.press("Control+z");
      await settled(page);
      expect((await rel()).x).toBeCloseTo(before.x, 0);
    });

    test("arrow keys nudge the selected box (Shift: 10 points)", async ({ page }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await page.keyboard.press("Escape");
      const before = await left(page, "We selected sales");
      const pb = await pageBox(page);
      const scale = pb.width / 612;
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("ArrowRight");
      await settled(page);
      await expect.poll(() => left(page, "We selected sales")).toBeGreaterThan(before + 15 * scale);
      expect(await left(page, "We selected sales")).toBeCloseTo(before + 21 * scale, 0);
    });

    test("the left handle re-wraps from the left; the X field moves the box", async ({ page }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await page.keyboard.press("Escape");
      const before = (await box(page, "We selected sales").boundingBox())!;
      const h = (await page.locator("[data-testid=edit-frame-handle][data-edge=w]").boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + 120, h.y + h.height / 2, { steps: 6 });
      await page.mouse.up();
      await settled(page);
      const after = (await box(page, "We selected sales").boundingBox())!;
      expect(after.x).toBeGreaterThan(before.x + 100);
      expect(after.height).toBeGreaterThan(before.height + 5);

      const fields = page.getByTestId("edit-box-fields");
      await fields.getByLabel("X position").fill("1");
      await fields.getByLabel("X position").press("Enter");
      await settled(page);
      await expect(page.getByTestId("edit-box-fields").getByLabel("X position")).toHaveValue("1");
    });

    test("the bottom handle fixes the height; text taller than the box is flagged", async ({
      page,
    }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("edit-autofit")).toBeChecked();
      const h = (await page.locator("[data-testid=edit-frame-handle][data-edge=s]").boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2, h.y - 20, { steps: 4 });
      await page.mouse.up();
      await expect(page.getByTestId("edit-autofit")).not.toBeChecked();
      await expect(page.getByTestId("overfull-note")).toBeVisible();
      await expect(box(page, "We selected sales")).toHaveClass(/overflow/);
      await page.getByTestId("edit-autofit").check();
      await expect(page.getByTestId("overfull-note")).toHaveCount(0);
    });

    test("with push on, growing text moves the list below down instead of clashing", async ({
      page,
    }) => {
      await openEdit(page);
      const list = (await box(page, "• Proposed adjustment").boundingBox())!;
      const [x, y] = await center(page, "Two invoices dated");
      await page.mouse.click(x, y);
      await page.getByTestId("edit-push").check();
      await editor(page).focus();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(
        " The client also agreed to review every credit memo issued in the first week of January before the year-end close.",
      );
      await page.keyboard.press("Escape");
      await settled(page);
      await expect(box(page, "Two invoices dated")).not.toHaveClass(/overflow/);
      const moved = (await box(page, "• Proposed adjustment").boundingBox())!;
      expect(moved.y).toBeGreaterThan(list.y + 5);
      await page.getByTestId("edit-push").uncheck();
    });
  });

  // B3 stage 2 step 3: formatting part of a paragraph, lists, indents, spacing.
  test.describe("formatting", () => {
    const panel = (page: Page) => page.getByTestId("edit-panel");

    /** Selects `word` inside the open editor. */
    async function pick(page: Page, word: string) {
      await editor(page).evaluate((el, w) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.textContent?.indexOf(w) ?? -1;
          if (at < 0) continue;
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + w.length);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(r);
          return;
        }
      }, word);
    }
    const spanOf = (page: Page, word: string) =>
      editor(page).locator("span", { hasText: word }).first();

    test("bold and a bigger size on one word only; it stays after the edit", async ({ page }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await expect(editor(page)).toBeFocused();
      await pick(page, "invoices");
      await panel(page).getByRole("button", { name: "Bold", exact: true }).click();
      await panel(page).getByLabel("Font size").fill("14");
      await panel(page).getByLabel("Font size").press("Enter");
      await expect(spanOf(page, "invoices")).toHaveCSS("font-weight", "700");
      await expect(spanOf(page, "selected")).not.toHaveCSS("font-weight", "700");
      await editor(page).focus();
      await page.keyboard.press("Escape");
      await settled(page);
      // Open again: the word is still its own bold run.
      const [x2, y2] = await center(page, "We selected sales");
      await page.mouse.click(x2, y2);
      await expect(spanOf(page, "invoices")).toHaveCSS("font-weight", "700");
      await expect(spanOf(page, "We selected")).not.toHaveCSS("font-weight", "700");
    });

    test("a numbered list from the panel, numbered on the page", async ({ page }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await expect(editor(page)).toBeFocused();
      await panel(page).getByRole("button", { name: "Numbered list" }).click();
      await expect(editor(page).locator(".rp").first()).toHaveAttribute("data-marker", "1.");
      await editor(page).focus();
      await page.keyboard.press("Escape");
      await settled(page);
      await expect(box(page, "1. We selected sales")).toHaveCount(1);
    });

    test("selected box: increase indent moves it right; character spacing widens it", async ({
      page,
    }) => {
      await openEdit(page);
      const [x, y] = await center(page, "Two invoices dated");
      await page.mouse.click(x, y);
      await page.keyboard.press("Escape");
      const before = (await box(page, "Two invoices dated").boundingBox())!;
      const scale = (await pageBox(page)).width / 612;
      await panel(page).getByRole("button", { name: "Increase indent" }).click();
      await settled(page);
      const moved = (await box(page, "Two invoices dated").boundingBox())!;
      expect(moved.x - before.x).toBeCloseTo(18 * scale, -1);

      await panel(page).getByLabel("Character spacing").fill("200");
      await panel(page).getByLabel("Character spacing").press("Enter");
      await settled(page);
      const wide = (await box(page, "Two invoices dated").boundingBox())!;
      expect(wide.height).toBeGreaterThan(moved.height + 5);
      await expect(panel(page).getByLabel("Character spacing")).toHaveValue("200");
    });
  });

  // B3 stage 2: Join / Split (kept in the file as marked content) and the outlines toggle.
  // B3 stage 2 step 5: the Edit toolbar's Link, Crop Pages and Phase 7 slots.
  test.describe("toolbar: links, crop pages", () => {
    /** The saved file's links on page 1, as pdf.js reads them. */
    async function savedLinks(page: Page, mockfs: MockFs) {
      const writes = mockfs.writes.length;
      await page.keyboard.press("Control+s");
      await expect.poll(() => mockfs.writes.length).toBe(writes + 1);
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({ data: new Uint8Array(bytesAt(mockfs, MEMO)), verbosity: 0 });
      const doc = await task.promise;
      const annots = (await (await doc.getPage(1)).getAnnotations()) as {
        subtype: string;
        url?: string;
        dest?: unknown;
      }[];
      await task.destroy();
      return annots.filter((a) => a.subtype === "Link").map((a) => a.url ?? "page");
    }

    test("Link: drag to add a web link, click it to change it, remove it", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      await toolbarButton(page, "Link").first().click();
      await expect(page.getByTestId("edit-panel")).toContainText("Drag a rectangle");
      // Over the memo's body text (the Link tool doesn't edit text): surely in view.
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 120, y + 30, { steps: 5 });
      await page.mouse.up();
      await expect(page.getByTestId("edit-link-new")).toBeVisible();
      await page.getByLabel("Web address").fill("example.com/firm");
      await page.getByTestId("link-save").click();
      await settled(page);
      await expect(page.getByTestId("edit-link")).toHaveCount(1);
      expect(await savedLinks(page, mockfs)).toEqual(["https://example.com/firm"]);

      // Click it: change it to go to page 1, with a visible rectangle.
      const l = (await page.getByTestId("edit-link").boundingBox())!;
      await page.mouse.click(l.x + l.width / 2, l.y + l.height / 2);
      await expect(page.getByLabel("Web address")).toHaveValue("https://example.com/firm");
      await page.getByText("Go to a page in this document").click();
      await page.getByTestId("link-visible").check();
      await page.getByTestId("link-save").click();
      await settled(page);
      expect(await savedLinks(page, mockfs)).toEqual(["page"]);

      const l2 = (await page.getByTestId("edit-link").boundingBox())!;
      await page.mouse.click(l2.x + l2.width / 2, l2.y + l2.height / 2);
      await page.getByTestId("link-remove").click();
      await settled(page);
      await expect(page.getByTestId("edit-link")).toHaveCount(0);
      expect(await savedLinks(page, mockfs)).toEqual([]);
    });

    test("unsafe link addresses are refused; Esc leaves the Link tool", async ({ page }) => {
      await openEdit(page);
      await toolbarButton(page, "Link").first().click();
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 100, y + 30, { steps: 4 });
      await page.mouse.up();
      await page.getByLabel("Web address").fill("javascript:alert(1)");
      await page.getByTestId("link-save").click();
      await expect(page.locator(".toast")).toContainText("web addresses");
      await expect(page.getByTestId("edit-link")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("link-form")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("edit-panel")).toContainText("Click text to edit it");
    });

    test("Crop Pages opens the crop dialog; Phase 7 buttons stay hidden", async ({ page }) => {
      await openEdit(page);
      await toolbarButton(page, "Crop pages").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toolbarButton(page, "Header & Footer")).toHaveCount(0);
      await expect(toolbarButton(page, "Watermark")).toHaveCount(0);
    });
  });

  test.describe("join, split, bounding boxes", () => {
    test("Ctrl+click picks boxes; Join makes one paragraph (one undo step)", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      const [x1, y1] = await center(page, "We selected sales");
      const [x2, y2] = await center(page, "Two invoices dated");
      // (page.mouse.click has no modifiers option: hold Control on the keyboard.)
      await page.keyboard.down("Control");
      await page.mouse.click(x1, y1);
      await expect(editor(page)).toHaveCount(0);
      await page.mouse.click(x2, y2);
      await page.keyboard.up("Control");
      await expect(page.locator("[data-testid=edit-box].selected")).toHaveCount(2);
      await expect(page.getByTestId("edit-selection")).toContainText("2 text boxes selected");
      await page.getByTestId("edit-join").click();
      await settled(page);
      await expect(box(page, "Two invoices dated")).toHaveCount(0);
      expect(await savedText(page, mockfs)).toMatch(/correct period\.\s*Two invoices dated/);

      await page.keyboard.press("Control+z");
      await settled(page);
      await expect(box(page, "Two invoices dated")).toHaveCount(1);
    });

    test("Split at caret starts a new box that stays apart after saving", async ({
      page,
      mockfs,
    }) => {
      await openEdit(page);
      const [x, y] = await center(page, "We selected sales");
      await page.mouse.click(x, y);
      await expect(editor(page)).toBeFocused();
      // The caret just before "For each invoice" (a text position in the rich editor).
      await editor(page).evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.textContent?.indexOf("For each invoice") ?? -1;
          if (at >= 0) {
            window.getSelection()?.collapse(n, at);
            return;
          }
        }
      });
      await page.getByTestId("edit-split").click();
      await settled(page);
      await expect(box(page, "We selected sales")).toHaveCount(1);
      await expect(box(page, "For each invoice")).toHaveCount(1);

      // Saved and reopened, the two boxes are still two.
      await savedText(page, mockfs);
      await page.keyboard.press("Control+w");
      await openEdit(page);
      await expect(box(page, "For each invoice")).toHaveCount(1);
    });

    test("Show bounding boxes off keeps only the hovered outline", async ({ page }) => {
      await openEdit(page);
      const toggle = page.getByTestId("edit-show-boxes");
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await expect(page.getByTestId("edit-layer")).toHaveClass(/hide-boxes/);
      const colour = (start: string) =>
        box(page, start).evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(await colour("MEMORANDUM")).toBe("rgba(0, 0, 0, 0)");
      const [x, y] = await center(page, "MEMORANDUM");
      await page.mouse.move(x, y);
      expect(await colour("MEMORANDUM")).not.toBe("rgba(0, 0, 0, 0)");
      await toggle.check();
    });
  });
});
