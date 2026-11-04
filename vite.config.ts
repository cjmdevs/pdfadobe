import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const host = process.env.TAURI_DEV_HOST;

/**
 * Phase 10a: records which npm packages actually end up in the app bundle (code and
 * imported assets such as WASM and fonts), so scripts/notices.mjs lists exactly those
 * in THIRD-PARTY-NOTICES.txt. Written outside dist/ so it is not shipped.
 */
function bundlePackages(): Plugin {
  return {
    name: "pdfwb-bundle-packages",
    apply: "build",
    generateBundle() {
      const dirs = new Set<string>();
      for (const id of this.getModuleIds()) {
        const path = id.replace(/^\0/, "").split("?")[0].replaceAll("\\", "/");
        const i = path.lastIndexOf("/node_modules/");
        if (i < 0) continue;
        const rest = path.slice(i + "/node_modules/".length).split("/");
        const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
        dirs.add(path.slice(0, i) + "/node_modules/" + name);
      }
      const out = join(process.cwd(), "src-tauri", "notices");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "bundle-packages.json"), JSON.stringify([...dirs].sort(), null, 2));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), bundlePackages()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
