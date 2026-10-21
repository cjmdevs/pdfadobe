// Drives the throwaway /spike page in Chromium (browser fallback path: file input +
// download). The native-dialog path needs Tauri on Windows; see docs/spike-report.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { pdfjsView, rawHits } from "../helpers/leak-scan";

const corpus = join(import.meta.dirname, "..", "corpus", "generated");
const SSN = "000-12-3456";

test.beforeEach(async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (
      !["localhost", "127.0.0.1"].includes(u.hostname) &&
      u.protocol !== "data:" &&
      u.protocol !== "blob:"
    )
      external.push(r.url());
  });
  await page.goto("/#/spike");
  await expect(page.getByTestId("status")).toContainText("PDFium ready", { timeout: 30_000 });
  // CLAUDE.md: no network calls. Checked again after each test.
  (page as unknown as { __external: string[] }).__external = external;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __external: string[] }).__external).toEqual([]);
});

async function saveAs(page: import("@playwright/test").Page): Promise<Uint8Array> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save As…" }).click();
  const path = await (await download).path();
  return new Uint8Array(readFileSync(path));
}

test("open, stamp + free text, Save As", async ({ page }) => {
  await page.getByLabel("Open PDF").setInputFiles(join(corpus, "text-1p.pdf"));
  await expect(page.getByTestId("status")).toContainText("Opened 1 page(s)");
  await page.getByRole("button", { name: "Add stamp + free text" }).click();
  await expect(page.getByTestId("status")).toContainText("Added image stamp");
  const out = await saveAs(page);
  const v = await pdfjsView(out);
  expect(v.annotations.map((a) => a.subtype).sort()).toEqual(["FreeText", "Stamp"]);
});

test("open, redact SSN, Save As: gone from page text", async ({ page }) => {
  await page.getByLabel("Open PDF").setInputFiles(join(corpus, "ssn-redaction.pdf"));
  await expect(page.getByTestId("status")).toContainText("Opened 2 page(s)");
  await page.getByRole("button", { name: "Mark + apply redaction" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Marked 3 redaction(s); applied on 2 page(s)",
  );
  const out = await saveAs(page);
  const v = await pdfjsView(out);
  expect(v.pageText.join("")).not.toContain(SSN);
  expect(v.pageText.join("")).toContain("KEEP-THIS-LINE");
  // Same known gaps as tests/redaction: the SSN survives outside page content.
  expect(rawHits(out, SSN).length).toBeGreaterThan(0);
});
