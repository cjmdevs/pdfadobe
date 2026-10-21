#!/usr/bin/env node
// Downloads the two native Windows binaries the installer bundles, pinned by SHA-256,
// into src-tauri/vendor/ (git-ignored):
//
//   vendor/pdfium/  pdfium.dll   native printing (src-tauri/src/print/win.rs)
//   vendor/qpdf/    qpdf.exe     "Repair a copy" for damaged PDFs (src-tauri/src/repair.rs)
//
// Licenses (shipped next to the binaries):
//   pdfium-binaries: Apache-2.0 build scripts; PDFium BSD-3-Clause; bundled third-party
//     code is BSD/MIT/Apache/FreeType (FTL)/IJG/libpng/Boost/Unicode (see licenses/).
//   qpdf: Apache-2.0. Its MSVC build ships the Microsoft Visual C++ runtime DLLs
//     (Microsoft redistributable license; app-local deployment).
//
// On non-Windows hosts this only creates placeholder folders so `tauri build` resource
// globs resolve; the app then falls back to qpdf on PATH and WebView printing.
// Usage: node scripts/fetch-win-binaries.mjs [--force]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "src-tauri", "vendor");

const PINS = {
  pdfium: {
    url: "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8111/pdfium-win-x64.tgz",
    sha256: "3452d11031050ec65e57f180215b57b9e6d465e3fbedafa8a77ad90885c7d23e",
    // [from (inside the archive), to (inside vendor/pdfium)]
    copy: [
      ["bin/pdfium.dll", "pdfium.dll"],
      ["LICENSE", "LICENSE"],
      ["licenses", "licenses"],
    ],
  },
  qpdf: {
    url: "https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-msvc64.zip",
    sha256: "db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d",
    copy: [
      ["qpdf-12.4.2-msvc64/bin", "."],
      ["qpdf-12.4.2-msvc64/share/doc/qpdf/manual-html/license.html", "LICENSE.html"],
    ],
  },
};

const force = process.argv.includes("--force");
const isWindows = process.platform === "win32";

for (const [name, pin] of Object.entries(PINS)) {
  const dest = join(vendor, name);
  const marker = join(dest, ".sha256");
  if (!force && existsSync(marker)) continue;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  if (!isWindows && !force) {
    writeFileSync(
      join(dest, "README.txt"),
      `Placeholder: ${name} is only bundled on Windows builds.\n`,
    );
    continue;
  }
  console.log(`fetching ${name}…`);
  const res = await fetch(pin.url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== pin.sha256) throw new Error(`${name}: SHA-256 mismatch (got ${got})`);

  const work = mkdtempSync(join(tmpdir(), `pdfwb-${name}-`));
  const archive = join(work, pin.url.endsWith(".zip") ? "a.zip" : "a.tgz");
  writeFileSync(archive, bytes);
  const out = join(work, "x");
  mkdirSync(out);
  // Windows 10+ tar.exe (bsdtar) reads both .tgz and .zip.
  if (archive.endsWith(".zip") && !isWindows) execFileSync("unzip", ["-q", archive, "-d", out]);
  else execFileSync("tar", ["-xf", archive, "-C", out]);
  for (const [from, to] of pin.copy) cpSync(join(out, from), join(dest, to), { recursive: true });
  rmSync(work, { recursive: true, force: true });
  writeFileSync(marker, pin.sha256);
  console.log(`${name}: ${readdirSync(dest).length} files in ${dest}`);
}
