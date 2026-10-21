// Shared Playwright fixtures.
//
// The app runs in plain Chromium here (the browser platform, src/platform/browser.ts).
// `mockfs` stands in for the Windows file system: readPath() fetches
// /__mockfs/<encoded path> and we answer from tests/corpus/generated, or with a
// simulated error (locked, network, notFound...). Every test also asserts the app made
// no external network requests (CLAUDE.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
export type { Page };

export const CORPUS = join(import.meta.dirname, "..", "corpus", "generated");

/** Virtual Windows paths used across tests. All synthetic. */
export const P = {
  text: "C:\\Corpus\\text-1p.pdf",
  long200: "C:\\Corpus\\long-200p.pdf",
  long500: "\\\\fileserver\\share\\Corpus\\long-500p.pdf",
  nav: "C:\\Corpus\\navigation.pdf",
  encrypted: "C:\\Corpus\\encrypted.pdf",
  corrupt: "C:\\Corpus\\corrupt.pdf",
  damaged: "C:\\Corpus\\damaged-xref.pdf",
  ssn: "C:\\Corpus\\ssn-redaction.pdf",
  noPrint: "C:\\Corpus\\no-print.pdf",
  locked: "C:\\Corpus\\locked-by-excel.pdf",
  offline: "\\\\offline-server\\share\\return.pdf",
  missing: "C:\\Corpus\\moved-away.pdf",
} as const;

type Entry = { file: string } | { error: string; message: string };

const DEFAULT_FS: Record<string, Entry> = {
  [P.text]: { file: "text-1p.pdf" },
  [P.long200]: { file: "long-200p.pdf" },
  [P.long500]: { file: "long-500p.pdf" },
  [P.nav]: { file: "navigation.pdf" },
  [P.encrypted]: { file: "encrypted.pdf" },
  [P.corrupt]: { file: "corrupt.pdf" },
  [P.damaged]: { file: "damaged-xref.pdf" },
  [P.ssn]: { file: "ssn-redaction.pdf" },
  [P.noPrint]: { file: "no-print.pdf" },
  [P.locked]: { error: "locked", message: "could not open: the file is open in another program" },
  [P.offline]: {
    error: "network",
    message: "could not open: The network path was not found. (os error 53)",
  },
};

export interface MockFs {
  entries: Record<string, Entry>;
  /** Paths written by "repair" (target -> source corpus file). */
  repaired: Map<string, string>;
}

export const test = base.extend<{ mockfs: MockFs; external: string[] }>({
  // Auto fixtures: every test gets the mock file system and the network guard.
  mockfs: [
    async ({ page }, use) => {
      const fs: MockFs = { entries: { ...DEFAULT_FS }, repaired: new Map() };
      await page.route("**/__mockfs/**", async (route) => {
        const url = new URL(route.request().url());
        const path = decodeURIComponent(url.pathname.slice("/__mockfs/".length));
        const entry = fs.entries[path];
        if (!entry) return route.fulfill({ status: 404, body: "not found" });
        if ("error" in entry)
          return route.fulfill({
            status: 500,
            headers: { "x-mockfs-error": entry.error },
            body: entry.message,
          });
        return route.fulfill({ status: 200, body: readFileSync(join(CORPUS, entry.file)) });
      });
      // Simulated qpdf repair: "repairs" damaged-xref.pdf by serving text-1p.pdf at the target.
      await page.route("**/__mockfs-repair", async (route) => {
        const { source, target } = JSON.parse(route.request().postData() ?? "{}") as {
          source: string;
          target: string;
        };
        const src = fs.entries[source];
        if (!src || !("file" in src) || src.file === "corrupt.pdf")
          return route.fulfill({
            status: 500,
            headers: { "x-mockfs-error": "unrepairable" },
            body: "unable to find trailer dictionary while recovering damaged file",
          });
        fs.entries[target] = { file: "text-1p.pdf" };
        fs.repaired.set(target, source);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ hadWarnings: true }),
        });
      });
      await use(fs);
    },
    { auto: true },
  ],

  external: [
    async ({ page }, use) => {
      const external: string[] = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (
          !["localhost", "127.0.0.1"].includes(u.hostname) &&
          !["data:", "blob:"].includes(u.protocol)
        )
          external.push(r.url());
      });
      await use(external);
      expect(external, "no network calls outside the app").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Load the app (optionally with launch paths, like Explorer "Open with") and wait until ready. */
export async function boot(page: Page, opts: { launch?: string[]; settings?: unknown } = {}) {
  await page.addInitScript(
    ({ launch, settings }) => {
      // Init scripts re-run on reload; seed only on the first load, like a real first launch.
      if (sessionStorage.getItem("pdfwb-test-booted")) return;
      sessionStorage.setItem("pdfwb-test-booted", "1");
      (window as unknown as { __PDFWB_LAUNCH_PATHS__: string[] }).__PDFWB_LAUNCH_PATHS__ = launch;
      if (settings) localStorage.setItem("pdf-workbench.settings", JSON.stringify(settings));
    },
    { launch: opts.launch ?? [], settings: opts.settings ?? null },
  );
  await page.goto("/");
  await expect(page.locator("html[data-app-ready=true]")).toBeAttached({ timeout: 30_000 });
}

/** Simulates "Open with" on an already-running app (second instance). */
export async function openPaths(page: Page, paths: string[]) {
  await page.evaluate(
    (p) => window.dispatchEvent(new CustomEvent("pdfwb:open-paths", { detail: p })),
    paths,
  );
}

/** Pages currently rendered in the document viewer. */
export function pages(page: Page) {
  return page.getByTestId("viewport").getByTestId("page");
}

/** Waits until page N (0-based) has a painted image. */
export async function waitForPainted(page: Page, index: number) {
  await expect(
    page.locator(`[data-testid=viewport] [data-page-index="${index}"] img`).first(),
  ).toHaveJSProperty("complete", true, { timeout: 15_000 });
}

export async function currentPageNumber(page: Page): Promise<number> {
  return Number(await page.getByLabel("Page number").inputValue());
}
