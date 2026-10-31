#!/usr/bin/env node
// Builds the OCR sidecar into src-tauri/vendor/tesseract/ (git-ignored):
//
//   tesseract.exe            Tesseract 5.5.4 CLI, MSVC, static CRT, no DLLs
//   tessdata/eng, osd        standard tessdata (pinned by SHA-256)
//   tessdata/pdf.ttf         GlyphLessFont for the invisible text layer
//   LICENSE-*                Tesseract (Apache-2.0), Leptonica (BSD-2-Clause), zlib (Zlib),
//                            tessdata (Apache-2.0)
//
// Phase 7 decision: no image libraries (no png/jpeg/tiff/webp/gif/openjpeg, no
// libarchive, no libcurl). Pages are handed over as 8-bit PGM, which Leptonica reads
// natively. zlib is the one extra: Tesseract's PDF writer compresses with it.
//
// Needs Visual Studio 2022/2026 with the C++ workload (its bundled CMake is used) and
// git. Takes ~10 minutes. Usage: node scripts/build-tesseract.mjs [--force]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "src-tauri", "vendor", "tesseract");
const work = join(root, "src-tauri", "target", "tesseract-build");

const SOURCES = {
  zlib: { repo: "https://github.com/madler/zlib", tag: "v1.3.1" },
  leptonica: { repo: "https://github.com/DanBloomberg/leptonica", tag: "1.87.0" },
  tesseract: { repo: "https://github.com/tesseract-ocr/tesseract", tag: "5.5.4" },
};
const TESSDATA = "https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0";
const DATA = {
  "eng.traineddata": "daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047",
  "osd.traineddata": "e19f2ae860792fdf372cf48d8ce70ae5da3c4052962fe22e9de1f680c374bb0e",
};

const force = process.argv.includes("--force");
const marker = join(dest, ".built");
if (!force && existsSync(marker)) process.exit(0);
if (process.platform !== "win32") {
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "README.txt"), "Placeholder: Tesseract is only bundled on Windows.\n");
  process.exit(0);
}

function cmakeExe() {
  const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  const vs = execFileSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"])
    .toString()
    .trim();
  const exe = join(vs, "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe");
  if (!existsSync(exe)) throw new Error("CMake not found; install the VS C++ CMake tools");
  return exe;
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const cmake = cmakeExe();
// Static CRT in both libraries so tesseract.exe needs no runtime DLLs.
const common = [
  "-A",
  "x64",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DCMAKE_POLICY_DEFAULT_CMP0091=NEW",
  "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
];

function build(name, options) {
  const { repo, tag } = SOURCES[name];
  const src = join(work, name);
  if (!existsSync(src)) run("git", ["clone", "--depth", "1", "--branch", tag, repo, src]);
  const bin = join(work, `${name}-build`);
  run(cmake, [
    "-S",
    src,
    "-B",
    bin,
    ...common,
    `-DCMAKE_INSTALL_PREFIX=${join(work, "prefix")}`,
    ...options,
  ]);
  run(cmake, ["--build", bin, "--config", "Release", "--parallel"]);
  run(cmake, ["--install", bin, "--config", "Release"]);
  return src;
}

mkdirSync(work, { recursive: true });
const prefix = join(work, "prefix");
const zlibSrc = build("zlib", []);
// The static library, so tesseract.exe needs no zlib1.dll.
const zlib = [
  `-DZLIB_LIBRARY=${join(prefix, "lib", "zlibstatic.lib")}`,
  `-DZLIB_INCLUDE_DIR=${join(prefix, "include")}`,
];
const lept = build("leptonica", [
  "-DSW_BUILD=OFF",
  "-DSTRICT_CONF=OFF",
  "-DBUILD_PROG=OFF",
  "-DENABLE_ZLIB=ON",
  ...zlib,
  ...["PNG", "GIF", "JPEG", "TIFF", "WEBP", "OPENJPEG"].map((l) => `-DENABLE_${l}=OFF`),
]);
const tess = build("tesseract", [
  ...zlib,
  `-DLeptonica_DIR=${join(work, "prefix", "lib", "cmake", "leptonica")}`,
  "-DBUILD_TRAINING_TOOLS=OFF",
  "-DBUILD_TESTS=OFF",
  "-DDISABLE_TIFF=ON",
  "-DDISABLE_ARCHIVE=ON",
  "-DDISABLE_CURL=ON",
  "-DOPENMP_BUILD=OFF",
  "-DGRAPHICS_DISABLED=ON",
  "-DINSTALL_CONFIGS=OFF",
]);

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, "tessdata"), { recursive: true });
copyFileSync(join(work, "prefix", "bin", "tesseract.exe"), join(dest, "tesseract.exe"));
copyFileSync(join(tess, "tessdata", "pdf.ttf"), join(dest, "tessdata", "pdf.ttf"));
copyFileSync(join(tess, "LICENSE"), join(dest, "LICENSE-tesseract.txt"));
copyFileSync(join(lept, "leptonica-license.txt"), join(dest, "LICENSE-leptonica.txt"));
copyFileSync(join(zlibSrc, "LICENSE"), join(dest, "LICENSE-zlib.txt"));
for (const [file, sha] of Object.entries(DATA)) {
  const res = await fetch(`${TESSDATA}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha) throw new Error(`${file}: SHA-256 mismatch (got ${got})`);
  writeFileSync(join(dest, "tessdata", file), bytes);
}
const lic = await fetch(`${TESSDATA}/LICENSE`);
writeFileSync(join(dest, "tessdata", "LICENSE.txt"), Buffer.from(await lic.arrayBuffer()));
writeFileSync(marker, `${SOURCES.leptonica.tag} ${SOURCES.tesseract.tag}\n`);
console.log(`tesseract: built into ${dest}`);
