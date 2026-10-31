// Phase 8: Fill & Sign, certificate signing, the Signatures panel, Protect. The browser
// build signs with a throwaway WebCrypto certificate ("Browser Test Signer"); every
// signed file is checked with the engine's verifier (pkijs) in Node.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectAnnots } from "../helpers/annot-inspect";
import { listSignatures } from "../../src/engine/sign";
import { securityInfo } from "../../src/engine/security";
import { nodeQpdf } from "../helpers/qpdf-node";
import {
  CORPUS,
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

async function pageBox(page: Page, index = 0) {
  const pg = page.locator(`[data-testid=viewport] [data-page-index="${index}"]`);
  await pg.scrollIntoViewIfNeeded();
  return (await pg.boundingBox())!;
}

/** Arms a mark, then clicks the page at (fx, fy) of its size once the outline shows. */
async function placeAt(page: Page, fx: number, fy: number) {
  const box = await pageBox(page);
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.move(x + 4, y + 2);
  await expect(page.getByTestId("stamp-ghost")).toBeVisible();
  await page.mouse.click(x, y);
}

test.describe("Fill & Sign", () => {
  test("check, cross and date marks, and a typed signature, saved as stamps", async ({
    page,
    mockfs,
  }) => {
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text()));
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Fill & Sign", exact: true }).click();

    await tb(page, "Check mark").click();
    await placeAt(page, 0.2, 0.4);
    await tb(page, "Cross mark").click();
    await placeAt(page, 0.3, 0.4);
    await tb(page, "Today's date").click();
    await placeAt(page, 0.5, 0.4);

    await tb(page, "Sign yourself").click();
    await page.getByRole("menuitemradio", { name: "Add Signature…" }).click();
    const dialog = page.getByTestId("signature-dialog");
    await dialog.getByLabel("Signature text").fill("Pat Sample");
    await dialog.getByRole("radio", { name: "Great Vibes" }).click();
    await dialog.getByRole("button", { name: "Save and place" }).click();
    await expect(page.getByText(/place your signature/)).toHaveCount(1);
    await placeAt(page, 0.5, 0.45);

    await page.keyboard.press("Control+s");
    await idle(page);
    const stamps = inspectAnnots(new Uint8Array(bytesAt(mockfs, P.text))).filter(
      (a) => a.subtype === "/Stamp",
    );
    expect(stamps.map((s) => s.subject).sort()).toEqual(
      ["Check mark", "Cross mark", "Date", "Signature"].sort(),
    );

    // Saved signatures are listed for next time; no image data reached the console.
    await tb(page, "Sign yourself").click();
    await expect(page.getByRole("menuitemradio", { name: "Place signature" })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(logs.join("\n")).not.toMatch(/iVBORw0KGgo|\\x89PNG|data:image/);
  });

  test("a drawn signature is saved and shown in the list", async ({ page }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Fill & Sign", exact: true }).click();
    await tb(page, "Sign yourself").click();
    await page.getByRole("menuitemradio", { name: "Add Initials…" }).click();
    const dialog = page.getByTestId("signature-dialog");
    await dialog.getByRole("tab", { name: "Draw" }).click();
    const pad = (await dialog.getByTestId("signature-pad").boundingBox())!;
    await page.mouse.move(pad.x + 30, pad.y + 60);
    await page.mouse.down();
    await page.mouse.move(pad.x + 120, pad.y + 100, { steps: 8 });
    await page.mouse.move(pad.x + 200, pad.y + 40, { steps: 8 });
    await page.mouse.up();
    await dialog.getByRole("button", { name: "Save and place" }).click();
    await page.keyboard.press("Escape");
    await tb(page, "Sign yourself").click();
    await expect(page.getByRole("menuitemradio", { name: "Place initials" })).toBeVisible();
  });
});

test.describe("Certificate signatures", () => {
  test("Digitally Sign: drag a box, sign, the new file verifies and the panel says valid", async ({
    page,
    mockfs,
  }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Certificates", exact: true }).click();
    await tb(page, "Digitally sign: drag a box where the signature goes").click();
    const box = await pageBox(page);
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    const dialog = page.getByTestId("cert-sign");
    await expect(dialog.getByRole("radio", { name: /Browser Test Signer/ })).toBeChecked();
    await dialog.getByLabel("Location").fill("Test office");
    await dialog.getByRole("button", { name: "Sign and save as a new file" }).click();
    const out = "C:\\Corpus\\text-1p_Signed.pdf";
    await expect(page.getByRole("tab", { name: /text-1p_Signed\.pdf/ })).toBeVisible({
      timeout: 30_000,
    });
    expect(mockfs.writes.map((w) => w.path)).toEqual([out]);
    const [sig] = await listSignatures(new Uint8Array(bytesAt(mockfs, out)));
    expect(sig).toMatchObject({
      signer: "Browser Test Signer",
      intact: true,
      changedAfter: false,
      location: "Test office",
      subFilter: "ETSI.CAdES.detached",
    });

    await page.getByRole("button", { name: "Certificates", exact: true }).click();
    const panel = page.getByTestId("signature-panel");
    await expect(panel.getByTestId("signature-row")).toHaveCount(1);
    await expect(panel).toContainText("Browser Test Signer");
    await expect(panel).toContainText("Valid: the document has not been changed");
  });

  test("an empty signature field is signed by clicking it", async ({ page, mockfs }) => {
    const src = "C:\\Corpus\\sign-field.pdf";
    mockfs.entries[src] = { bytes: readFileSync(join(CORPUS, "sign-field.pdf")) };
    await boot(page);
    await openPaths(page, [src]);
    await waitForPainted(page, 0);
    const field = page.getByTestId("signature-box");
    await field.scrollIntoViewIfNeeded();
    await expect(field).toContainText("Click to sign");
    await field.click();
    const dialog = page.getByTestId("cert-sign");
    await expect(dialog).toContainText('Signs the field "Client Signature"');
    await dialog.getByRole("button", { name: "Sign and save as a new file" }).click();
    const out = "C:\\Corpus\\sign-field_Signed.pdf";
    await expect(page.getByRole("tab", { name: /sign-field_Signed\.pdf/ })).toBeVisible({
      timeout: 30_000,
    });
    const sigs = await listSignatures(new Uint8Array(bytesAt(mockfs, out)));
    expect(sigs.map((s) => s.intact)).toEqual([true]);
  });
});

test.describe("Protect", () => {
  test("open password: warning shown, protected copy saved (AES-256) and asks for it", async ({
    page,
    mockfs,
  }) => {
    await boot(page);
    await openPaths(page, [P.text]);
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Protect", exact: true }).click();
    await tb(page, "Protect with passwords…").click();
    const dialog = page.getByTestId("protect");
    await expect(dialog.getByTestId("permissions-warning")).toContainText(
      "A permissions password is not real protection",
    );
    await dialog.getByLabel("Open password", { exact: true }).fill("Synthetic-Pw-1");
    await dialog.getByLabel("Confirm open password").fill("Synthetic-Pw-1");
    await dialog.getByRole("button", { name: "Save a protected copy" }).click();
    await expect(page.getByLabel("Document password")).toBeVisible({ timeout: 30_000 });
    const out = "C:\\Corpus\\text-1p_Protected.pdf";
    const info = await securityInfo(
      nodeQpdf(),
      new Uint8Array(bytesAt(mockfs, out)),
      "Synthetic-Pw-1",
    );
    expect(info.method).toBe("AES-256");
  });

  test("Remove Security with the password saves an unprotected copy", async ({ page, mockfs }) => {
    await boot(page);
    await openPaths(page, [P.encrypted]);
    await page.getByLabel("Document password").fill("corpus-user");
    await page.keyboard.press("Enter");
    await waitForPainted(page, 0);
    await page.getByRole("button", { name: "Protect", exact: true }).click();
    await expect(tb(page, "Protect with passwords…")).toBeDisabled();
    await tb(page, "Remove security…").click();
    const dialog = page.getByTestId("remove-security");
    await dialog.getByLabel("Password").fill("wrong");
    await dialog.getByRole("button", { name: "Save an unprotected copy" }).click();
    await expect(page.getByText(/That password is not correct/)).toBeVisible();
    await dialog.getByLabel("Password").fill("corpus-user");
    await dialog.getByRole("button", { name: "Save an unprotected copy" }).click();
    await expect(page.getByRole("tab", { name: /encrypted_Unprotected\.pdf/ })).toBeVisible({
      timeout: 30_000,
    });
    const info = await securityInfo(
      nodeQpdf(),
      new Uint8Array(bytesAt(mockfs, "C:\\Corpus\\encrypted_Unprotected.pdf")),
    );
    expect(info.encrypted).toBe(false);
  });
});
