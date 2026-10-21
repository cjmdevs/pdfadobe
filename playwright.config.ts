import { defineConfig, devices } from "@playwright/test";

// E2E runs the Vite frontend in Chromium (WebView2 is Chromium-based).
// Tauri APIs are absent in a plain browser; tests must only touch browser-safe paths.
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:1420" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: point at a preinstalled Chromium instead of `npx playwright install`.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
