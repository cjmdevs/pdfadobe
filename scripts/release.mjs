#!/usr/bin/env node
// Release build (Phase 10a):
//
//   npm run release                   real certificate (PDFWB_SIGN_THUMBPRINT or
//                                     PDFWB_SIGN_COMMAND must be set)
//   npm run release -- --test-cert    self-signed test certificate (build PC only)
//
// 1. tauri build with PDFWB_RELEASE=1: scripts/sign.mjs then fails the build if any
//    file cannot be signed; beforeBuildCommand regenerates THIRD-PARTY-NOTICES.txt and
//    fails on a dependency without license text.
// 2. check-payload: qpdf, Tesseract + English data, PDFium, notices, WebView2
//    bootstrapper, per-user mode and hooks are in the installer.
// 3. verify-signed: every shipped .exe/.dll and the setup .exe are signed.
// 4. update package in release\<version>\ (scripts/update-package.mjs) when the update
//    key exists (PDFWB_UPDATE_KEY or %USERPROFILE%\.pdfworkbench\update-signing.key).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const testCert = process.argv.includes("--test-cert");
const env = { ...process.env, PDFWB_RELEASE: "1" };

if (!env.PDFWB_SIGN_THUMBPRINT && !env.PDFWB_SIGN_COMMAND) {
  console.error("release: set PDFWB_SIGN_THUMBPRINT or PDFWB_SIGN_COMMAND (see docs/admin.md)");
  process.exit(1);
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: cmd === "npx" });

try {
  run("npx", ["tauri", "build"]);
  run(process.execPath, [join(root, "scripts", "check-payload.mjs")]);
  run(process.execPath, [
    join(root, "scripts", "verify-signed.mjs"),
    ...(testCert ? ["--test-cert"] : []),
  ]);
  const key =
    env.PDFWB_UPDATE_KEY ?? join(env.USERPROFILE ?? "", ".pdfworkbench", "update-signing.key");
  if (existsSync(key)) run(process.execPath, [join(root, "scripts", "update-package.mjs")]);
  else console.log("release: no update key, no update package made (see docs/admin.md)");
} catch {
  console.error("release: FAILED (see the output above)");
  process.exit(1);
}
console.log("release: done");
