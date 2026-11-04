#!/usr/bin/env node
// Release gate (Phase 10a): the installer must carry everything the app needs offline.
// Reads the NSIS script Tauri generated for the last build
// (src-tauri/target/release/nsis/x64/installer.nsi): its `File` lines are exactly what
// goes into the setup .exe, so nothing has to be installed or unpacked to check.
//
//   node scripts/check-payload.mjs

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Files (install-folder relative, backslashes) that must be in the installer. */
export const REQUIRED = [
  "qpdf\\qpdf.exe",
  "qpdf\\qpdf30.dll",
  "qpdf\\vcruntime140.dll",
  "qpdf\\msvcp140.dll",
  "qpdf\\LICENSE.html",
  "tesseract\\tesseract.exe",
  "tesseract\\tessdata\\eng.traineddata",
  "tesseract\\tessdata\\osd.traineddata",
  "tesseract\\tessdata\\pdf.ttf",
  "tesseract\\LICENSE-tesseract.txt",
  "tesseract\\LICENSE-leptonica.txt",
  "tesseract\\LICENSE-zlib.txt",
  "pdfium\\pdfium.dll",
  "pdfium\\LICENSE",
  "THIRD-PARTY-NOTICES.txt",
];

/** Problems found in a generated installer.nsi (empty = good). Pure, for tests. */
export function payloadProblems(nsi) {
  const packed = new Set([...nsi.matchAll(/File \/a "\/oname=([^"]+)"/g)].map((m) => m[1]));
  const problems = REQUIRED.filter((f) => !packed.has(f)).map((f) => `missing ${f}`);
  if (!/!define INSTALLWEBVIEW2MODE "embedBootstrapper"/.test(nsi))
    problems.push("WebView2 bootstrapper is not embedded (webviewInstallMode)");
  if (!/!define INSTALLMODE "currentUser"/.test(nsi))
    problems.push("install mode is not currentUser");
  if (!/!include "[^"]*hooks\.nsh"/.test(nsi))
    problems.push("installer hooks (hooks.nsh) not included");
  return problems;
}

function main() {
  const f = join(root, "src-tauri", "target", "release", "nsis", "x64", "installer.nsi");
  if (!existsSync(f)) {
    console.error("check-payload: no generated installer.nsi; run tauri build first");
    process.exit(1);
  }
  const problems = payloadProblems(readFileSync(f, "utf8"));
  if (problems.length) {
    console.error(`check-payload: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check-payload: installer has all ${REQUIRED.length} required files`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
