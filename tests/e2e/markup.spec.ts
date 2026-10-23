// Phase 3: markup in the reader. Saved files are read back with qpdf (no PDFium code).
import { inspectAnnots, rgb } from "../helpers/annot-inspect";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdfjsView } from "../helpers/leak-scan";
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
  type Page,
} from "./fixtures";

const tb = (page: Page, name: string) =>
  page.getByTestId("tool-toolbar").getByRole("button", { name, exact: true });
const props = (page: Page) => page.getByTestId("props-bar");
const activeTab = (page: Page) =>
  page.getByRole("tablist", { name: "Open documents" }).getByRole("tab", { selected: true });

async function openComment(page: Page, path: string) {
  await openPaths(page, [path]);
  await waitForPainted(page, 0);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByTestId("tool-toolbar")).toContainText("Comment");
}

/** Drags on page 1 between two points given as fractions of the page box (keep y within
 * the visible part: below ~0.65 the page is outside the viewport at fit-width). */
async function drawOnPage(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
  const at = ([fx, fy]: [number, number]) => [box.x + box.width * fx, box.y + box.height * fy];
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  await page.mouse.move(x0!, y0!);
  await page.mouse.down();
  await page.mouse.move((x0! + x1!) / 2, (y0! + y1!) / 2, { steps: 4 });
  await page.mouse.move(x1!, y1!, { steps: 4 });
  await page.mouse.up();
}

test.describe("markup", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("draw a rectangle, restyle it, undo/redo, save: qpdf sees a red-then-blue /Square", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.text);
    await tb(page, "Rectangle").click();
    await expect(tb(page, "Rectangle")).toHaveAttribute("aria-pressed", "true");
    // Tool on, nothing selected: the bar edits the tool's style.
    await expect(props(page)).toContainText("Rectangle tool");

    await drawOnPage(page, [0.2, 0.5], [0.5, 0.65]);
    await expect(props(page)).toContainText("Rectangle");
    await expect(activeTab(page)).toContainText("•");
    await expect(page.getByRole("button", { name: "Undo Markup (Ctrl+Z)" })).toBeEnabled();

    await props(page)
      .getByRole("button", { name: /^Line color/ })
      .click();
    await page.getByRole("dialog", { name: "Line color" }).getByLabel("#0000FF").click();
    await expect(props(page).getByRole("button", { name: "Line color: #0000FF" })).toBeVisible();

    // Undo the color, then redo it.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");

    await page.keyboard.press("Control+s");
    await idle(page);
    await expect(activeTab(page)).not.toContainText("•");
    const annots = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text)));
    const sq = annots.filter((a) => a.subtype === "/Square");
    expect(sq).toHaveLength(1);
    rgb("#0000FF").forEach((v, i) => expect(Math.abs(sq[0]!.color![i]! - v)).toBeLessThan(0.01));
    expect(sq[0]!.hasAppearance).toBe(true);
    expect(sq[0]!.author).toBe("Reviewer");
  });

  test("a page change keeps the markup; Ctrl+Z then steps back through both", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.wpA);
    const circles = () =>
      inspectAnnots(new Uint8Array(bytesAt(mockfs, P.wpA))).filter((a) => a.subtype === "/Circle");
    await tb(page, "Ellipse").click();
    await drawOnPage(page, [0.3, 0.3], [0.5, 0.4]);
    await page.keyboard.press("Escape"); // tool off
    await expect(tb(page, "Ellipse")).toHaveAttribute("aria-pressed", "false");

    // A page operation pushes the markup into the document first.
    await page.getByRole("button", { name: /^Rotate right: page 1/ }).click();
    await idle(page);
    await expect(page.getByRole("button", { name: /^Undo Rotate/ })).toBeEnabled();
    await page.keyboard.press("Control+s");
    await idle(page);
    expect(circles()).toHaveLength(1);
    await page.keyboard.press("Control+z");
    await idle(page);
    // Back to the state with the ellipse ("Markup" revision), then before it.
    await expect(page.getByRole("button", { name: "Undo Markup (Ctrl+Z)" })).toBeEnabled();
    await page.keyboard.press("Control+z");
    await idle(page);
    // Saved after the rotate, so both undo steps leave the tab unsaved.
    await expect(activeTab(page)).toContainText("•");
    await page.keyboard.press("Control+s");
    await idle(page);
    expect(circles()).toHaveLength(0);
  });

  test("Delete removes the selected comment; a locked one stays", async ({ page }) => {
    await openComment(page, P.text);
    await tb(page, "Rectangle").click();
    await drawOnPage(page, [0.2, 0.2], [0.4, 0.3]);
    await props(page).getByRole("button", { name: "Lock", exact: true }).click();
    await expect(props(page).getByRole("button", { name: "Unlock" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Delete");
    await expect(props(page)).toContainText("Rectangle");
    await props(page).getByRole("button", { name: "Unlock" }).click();
    await page.keyboard.press("Delete");
    await expect(props(page)).toContainText("Rectangle tool");
  });

  test("Make default saves the tool style in settings", async ({ page }) => {
    await openComment(page, P.text);
    await tb(page, "Rectangle").click();
    await props(page).getByLabel("Width").selectOption("4");
    await props(page).getByRole("button", { name: "Make default" }).click();
    const saved = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("pdf-workbench.settings") ?? "{}").markupDefaults
          ?.square as Record<string, unknown> | undefined,
    );
    expect(saved?.strokeWidth).toBe(4);
  });

  test("highlight selected text and type into a text box; both saved as standard annotations", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.text);
    await tb(page, "Highlight").click();
    // Across the heading (text-1p.pdf: 18 pt at x 72, baseline y 720 of 792).
    await drawOnPage(page, [0.11, 0.083], [0.45, 0.083]);
    await expect(props(page)).toContainText(/^Highlight(?! tool)/);

    await tb(page, "Text box").click();
    await drawOnPage(page, [0.2, 0.6], [0.6, 0.66]);
    await page.keyboard.type("Agrees to TB");
    // Escape leaves the box and keeps the text; then the tool goes off.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(tb(page, "Text box")).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Control+s");
    await idle(page);
    const annots = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text)));
    const hl = annots.find((a) => a.subtype === "/Highlight");
    expect(hl?.dict["/QuadPoints"]).toBeDefined();
    const ft = annots.find((a) => a.subtype === "/FreeText");
    expect(ft?.contents).toBe("Agrees to TB");
    expect(String(ft?.dict["/DA"])).toMatch(/12 Tf/);
  });

  test("draw ink, erase across its middle: saved as one /Ink with two strokes", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.text);
    await tb(page, "Draw").click();
    await drawOnPage(page, [0.2, 0.55], [0.7, 0.55]);
    // The ink tool commits the stroke after a short pause.
    await expect(page.getByRole("button", { name: "Undo Markup (Ctrl+Z)" })).toBeEnabled();

    await tb(page, "Eraser").click();
    await expect(tb(page, "Eraser")).toHaveAttribute("aria-pressed", "true");
    await expect(tb(page, "Draw")).toHaveAttribute("aria-pressed", "false");
    await drawOnPage(page, [0.45, 0.5], [0.45, 0.6]);
    await page.keyboard.press("Escape");
    await expect(tb(page, "Eraser")).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Control+s");
    await idle(page);
    const ink = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
      (a) => a.subtype === "/Ink",
    );
    expect(ink).toHaveLength(1);
    expect(ink[0]!.dict["/InkList"] as unknown[]).toHaveLength(2);
    expect(ink[0]!.hasAppearance).toBe(true);
  });

  test("cloud: click the corners, double-click to finish; saved with a cloudy border", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.text);
    await tb(page, "Cloud").click();
    const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
    const at = (fx: number, fy: number) =>
      [box.x + box.width * fx, box.y + box.height * fy] as const;
    await page.mouse.click(...at(0.2, 0.3));
    await page.mouse.click(...at(0.6, 0.3));
    await page.mouse.click(...at(0.6, 0.5));
    await page.mouse.dblclick(...at(0.2, 0.5));
    await expect(props(page)).toContainText(/^Cloud(?! tool)/);

    await page.keyboard.press("Control+s");
    await idle(page);
    const poly = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
      (a) => a.subtype === "/Polygon",
    );
    expect(poly).toHaveLength(1);
    expect(JSON.stringify(poly[0]!.dict["/BE"])).toContain('"/S":"/C"');
  });

  test("Approved stamp from the Stamp tool: saved as /Stamp /Approved with our appearance", async ({
    page,
    mockfs,
  }) => {
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Stamp", exact: true }).click();
    await tb(page, "Approved stamp").click();
    const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await expect(page.getByTestId("stamp-ghost")).toBeVisible();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await expect(props(page)).toBeVisible();
    await expect(page.getByTestId("stamp-ghost")).toHaveCount(0);

    await page.keyboard.press("Control+s");
    await idle(page);
    const stamps = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
      (a) => a.subtype === "/Stamp",
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.dict["/Name"]).toBe("/Approved");
    expect(stamps[0]!.subject).toBe("Approved");
    expect(stamps[0]!.author).toBe("Reviewer");
    expect(stamps[0]!.hasAppearance).toBe(true);
  });

  test("add an image to My stamps, place it; Esc cancels a picked stamp", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.text);
    await tb(page, "Stamp").click();
    const dialog = page.getByRole("dialog", { name: "Stamps" });
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: /Add image/ }).click();
    await (await chooser).setFiles(join(CORPUS, "stamp-reviewed.png"));
    await dialog.getByRole("button", { name: "stamp-reviewed", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/place the stamp-reviewed stamp/)).toBeVisible();

    // Esc: nothing placed.
    await page.keyboard.press("Escape");
    const box = (await page.locator('[data-testid=viewport] [data-page-index="0"]').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await expect(page.getByRole("button", { name: "Undo Markup (Ctrl+Z)" })).toHaveCount(0);

    await tb(page, "Stamp").click();
    await dialog.getByRole("button", { name: "stamp-reviewed", exact: true }).click();
    // The image loads first; then its outline follows the pointer.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await page.mouse.move(box.x + box.width * 0.5 + 5, box.y + box.height * 0.3);
    await expect(page.getByTestId("stamp-ghost")).toBeVisible();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await expect(page.getByRole("button", { name: "Undo Markup (Ctrl+Z)" })).toBeEnabled();
    await page.keyboard.press("Control+s");
    await idle(page);
    const stamps = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
      (a) => a.subtype === "/Stamp",
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.dict["/Name"]).toBe("/Image");
    expect(stamps[0]!.subject).toBe("stamp-reviewed");
  });

  test("comments panel: lists comments, edits a note, replies, sets status, filters, jumps", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.wpA);
    await tb(page, "Comments list").click();
    const panel = page.getByTestId("comments-panel");
    const items = panel.getByTestId("comment");
    // workpaper-a: a sticky note on page 1 and a square on page 2.
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Sticky note");
    await expect(items.nth(0)).toContainText("Reviewer");
    await expect(items.nth(0)).toContainText("p. 1");
    await expect(items.nth(1)).toContainText("p. 2");

    await panel.getByLabel("Filter by type").selectOption("Rectangle");
    await expect(items).toHaveCount(1);
    await panel.getByLabel("Filter by type").selectOption("");

    // Jump to the square on page 2, which selects it.
    await items
      .nth(1)
      .getByRole("button", { name: /Rectangle/ })
      .click();
    await expect(props(page)).toContainText("Rectangle");
    await expect(page.getByLabel("Page number")).toHaveValue("2");

    // Edit the note's text, reply, set a status.
    await items
      .nth(0)
      .getByRole("button", { name: /Sticky note/ })
      .click();
    const text = items.nth(0).getByLabel("Comment text");
    await text.fill("Tied to TB, see A-1");
    await text.blur();
    await items.nth(0).getByRole("button", { name: "Reply" }).click();
    await items.nth(0).getByLabel("Reply").fill("Agreed");
    await items.nth(0).getByRole("button", { name: "Post reply" }).click();
    await expect(items.nth(0).getByLabel("Replies")).toContainText("Agreed");
    await items.nth(0).getByLabel("Review status").selectOption("Accepted");
    await expect(items.nth(0).getByLabel("Review status")).toHaveValue("Accepted");
    // Replies and states are not listed as comments of their own.
    await expect(items).toHaveCount(2);

    await page.keyboard.press("Control+s");
    await idle(page);
    const annots = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.wpA)));
    const note = annots.find((a) => a.contents === "Tied to TB, see A-1");
    expect(note?.subtype).toBe("/Text");
    const reply = annots.find((a) => a.contents === "Agreed");
    expect(reply?.dict["/IRT"]).toBe(note?.ref);
    expect(reply?.author).toBe("Reviewer");
    const state = annots.find((a) => a.dict["/StateModel"] !== undefined);
    expect(state?.dict["/State"]).toBe("u:Accepted");
    expect(state?.dict["/IRT"]).toBe(note?.ref);
  });

  test("author: the Windows name by default, the Settings name when set", async ({
    page,
    mockfs,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __PDFWB_USER__: string }).__PDFWB_USER__ = "Jane Smith";
    });
    await page.reload();
    await expect(page.locator("html[data-app-ready=true]")).toBeAttached();
    await openComment(page, P.text);
    await tb(page, "Rectangle").click();
    await drawOnPage(page, [0.2, 0.2], [0.3, 0.3]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Settings…" }).click();
    const dlg = page.getByRole("dialog", { name: "Settings" });
    await expect(dlg.getByLabel("Author name")).toHaveAttribute("placeholder", "Jane Smith");
    await dlg.getByLabel("Author name").fill("J. Partner");
    await dlg.getByLabel("Author name").press("Enter");
    await dlg.getByRole("button", { name: "Close" }).click();

    await tb(page, "Ellipse").click();
    await drawOnPage(page, [0.4, 0.2], [0.5, 0.3]);
    await page.keyboard.press("Control+s");
    await idle(page);
    const annots = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text)));
    expect(annots.find((a) => a.subtype === "/Square")?.author).toBe("Jane Smith");
    expect(annots.find((a) => a.subtype === "/Circle")?.author).toBe("J. Partner");
  });

  test("flatten the whole document into a new file; the original keeps its comments", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.wpA);
    await tb(page, "Flatten comments into a new file…").click();
    const dlg = page.getByRole("dialog", { name: "Flatten comments" });
    await expect(dlg.getByLabel(/Selected comments/)).toBeDisabled();
    await dlg.getByLabel("All comments in the document").check();
    await dlg.getByRole("button", { name: "Flatten to new file" }).click();
    const out = P.wpA.replace(".pdf", " (flattened).pdf");
    await expect.poll(() => mockfs.writes.map((w) => w.path)).toContain(out);
    // Opened in a new tab.
    await expect(activeTab(page)).toContainText("workpaper-a (flattened)");
    const left = inspectAnnots(new Uint8Array(bytesAt(mockfs, out))).map((a) => a.subtype);
    expect(left).not.toContain("/Text");
    expect(left).not.toContain("/Square");
    // Form fields are still there (widgets are not flattened).
    expect(left).toContain("/Widget");
    expect(mockfs.writes.some((w) => w.path === P.wpA)).toBe(false);
  });

  test("export comments to XFDF, import them into another file (undoable)", async ({
    page,
    mockfs,
  }) => {
    const xfdfPath = P.wpA.replace(".pdf", ".xfdf");
    await openComment(page, P.wpA);
    await queueChoices(page, { savePaths: [xfdfPath] });
    await tb(page, "Export comments (XFDF)…").click();
    await expect.poll(() => mockfs.writes.map((w) => w.path)).toContain(xfdfPath);
    const xml = bytesAt(mockfs, xfdfPath).toString("utf8");
    expect(xml).toContain("<square ");
    expect(xml).toContain('title="Reviewer"');

    await openComment(page, P.text);
    const dir = mkdtempSync(join(tmpdir(), "pdfwb-xfdf-"));
    const file = join(dir, "comments.xfdf");
    writeFileSync(file, xml);
    const chooser = page.waitForEvent("filechooser");
    await tb(page, "Import comments (XFDF)…").click();
    await (await chooser).setFiles(file);
    // workpaper-a has comments on pages 1 and 2; text-1p has one page.
    await expect(
      page.getByText(/Imported 1 comment\(s\); 1 on pages this document does not have/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo Markup (Ctrl+Z)" })).toBeEnabled();
    await page.keyboard.press("Control+s");
    await idle(page);
    const notes = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
      (a) => a.subtype === "/Text",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.author).toBe("Reviewer");
  });

  test("comment summary: a new PDF listing the comments, opened in a tab", async ({
    page,
    mockfs,
  }) => {
    await openComment(page, P.wpA);
    await tb(page, "Summarize comments into a printable PDF").click();
    const out = P.wpA.replace(".pdf", " (comment summary).pdf");
    await expect.poll(() => mockfs.writes.map((w) => w.path)).toContain(out);
    await expect(activeTab(page)).toContainText("comment summary");
    const v = await pdfjsView(new Uint8Array(bytesAt(mockfs, out)));
    const text = v.pageText.join(" ");
    expect(text).toContain("Comment summary: workpaper-a.pdf");
    expect(text).toContain("Page 1");
    expect(text).toContain("Page 2");
    expect(text).toContain("Square A");
    expect(text).toContain("2. Rectangle");
  });
});
