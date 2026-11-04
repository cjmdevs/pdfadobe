#!/usr/bin/env node
// THIRD-PARTY-NOTICES.txt (Phase 10a), generated at build time and shipped in the
// install folder (tauri.conf.json bundle.resources).
//
//   node scripts/notices.mjs          release/build: fails if any dependency has no text
//   node scripts/notices.mjs --dev    `tauri dev`: writes a placeholder if the frontend
//                                     has not been built yet
//
// Sources:
//   npm    exactly the packages in the Vite bundle (src-tauri/notices/bundle-packages.json,
//          written by the bundlePackages plugin in vite.config.ts)
//   cargo  `cargo metadata` for x86_64-pc-windows-msvc, following normal (not dev or
//          build) dependencies from pdf-workbench
//   native the bundled sidecars and DLLs (qpdf, Tesseract + Leptonica + zlib, tessdata,
//          PDFium), from their license files in src-tauri/vendor/
//
// License text comes from the package's own LICENSE/COPYING/NOTICE files. A package
// without one must be listed in license-policy.json "licenseTexts" with a reviewed
// upstream copy in licenses/upstream/; otherwise the build fails. Identical texts are
// printed once with the list of packages that use them.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "notices");
const OUT = join(outDir, "THIRD-PARTY-NOTICES.txt");

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

/** License files directly in a package folder, sorted. */
export function licenseFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => join(dir, f));
}

/**
 * The notices text. `entries` = [{ name, version, license, texts: [string] }] with at
 * least one text each. Pure, so it can be tested.
 */
export function render(entries, header) {
  const groups = new Map(); // normalized text -> { text, users: [] }
  for (const e of entries) {
    for (const t of e.texts) {
      const key = t.replace(/\s+/g, " ").trim();
      if (!groups.has(key)) groups.set(key, { text: t.trim(), users: [] });
      groups.get(key).users.push(`${e.name} ${e.version} (${e.license})`);
    }
  }
  const rule = "=".repeat(78);
  let s = header.trimEnd() + "\n\n";
  s += `${entries.length} components:\n`;
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name)))
    s += `  ${e.name} ${e.version} (${e.license})\n`;
  s += "\n";
  for (const g of groups.values()) {
    s += `${rule}\nUsed by: ${[...new Set(g.users)].sort().join(", ")}\n${rule}\n\n${g.text}\n\n`;
  }
  return s;
}

/** Entries without any text (the build fails on these). Pure, for tests. */
export function missingTexts(entries) {
  return entries.filter((e) => !e.texts.some((t) => t.trim())).map((e) => `${e.name} ${e.version}`);
}

function readText(f) {
  const t = readFileSync(f, "utf8");
  return f.toLowerCase().endsWith(".html") ? htmlToText(t) : t;
}

/** qpdf ships its license as HTML: keep the words, drop the markup. */
export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h\d|li|pre|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function policyText(policy, name) {
  const p = name === "_note" ? null : policy.licenseTexts?.[name];
  if (!p) return [];
  const f = join(root, p.file);
  if (!existsSync(f))
    throw new Error(`license-policy.json licenseTexts.${name}: ${p.file} missing`);
  return [readFileSync(f, "utf8")];
}

function npmEntries(policy) {
  const list = join(outDir, "bundle-packages.json");
  if (!existsSync(list)) return null;
  return JSON.parse(readFileSync(list, "utf8")).map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const own = licenseFiles(dir).map(readText);
    const license =
      policy.packageOverrides?.[pkg.name]?.license ??
      (typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "see text"));
    return {
      name: pkg.name,
      version: pkg.version,
      license,
      texts: own.length ? own : policyText(policy, pkg.name),
    };
  });
}

function cargoEntries(policy) {
  const meta = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        // --offline, not --locked: raising the version changes this app's own entry in
        // Cargo.lock, which --locked refused (owner test, Phase 10a step 9). --offline
        // still never fetches anything; a dependency that isn't downloaded fails here.
        "--offline",
        "--manifest-path",
        join(root, "src-tauri", "Cargo.toml"),
        "--filter-platform",
        "x86_64-pc-windows-msvc",
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    ).toString(),
  );
  const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [meta.resolve.root];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id).deps)
      if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
  }
  const out = [];
  for (const id of seen) {
    const p = pkgs.get(id);
    if (p.source == null) continue; // pdf-workbench itself
    const dir = dirname(p.manifest_path);
    const files = licenseFiles(dir);
    if (p.license_file && existsSync(join(dir, p.license_file)))
      files.push(join(dir, p.license_file));
    const texts = [...new Set(files)].map(readText);
    out.push({
      name: p.name,
      version: p.version,
      license: p.license ?? "see text",
      texts: texts.length ? texts : policyText(policy, p.name),
    });
  }
  return out;
}

function nativeEntries() {
  const v = join(root, "src-tauri", "vendor");
  const read = (...p) => {
    const f = join(v, ...p);
    return existsSync(f) ? [readText(f)] : [];
  };
  const pdfiumLicenses = join(v, "pdfium", "licenses");
  const pdfiumTexts = [
    ...read("pdfium", "LICENSE"),
    ...(existsSync(pdfiumLicenses)
      ? readdirSync(pdfiumLicenses)
          .sort()
          .map((f) => `--- ${f} ---\n${readText(join(pdfiumLicenses, f))}`)
      : []),
  ];
  return [
    {
      name: "qpdf",
      version: "12.4.2",
      license: "Apache-2.0",
      texts: read("qpdf", "LICENSE.html"),
    },
    {
      name: "Microsoft Visual C++ runtime DLLs (shipped with qpdf)",
      version: "14",
      license: "Microsoft Visual C++ Redistributable license",
      texts: [
        "The files vcruntime140*.dll, msvcp140*.dll and concrt140.dll in the qpdf folder are\n" +
          "the Microsoft Visual C++ Redistributable, distributed app-locally as permitted by\n" +
          "the Microsoft Software License Terms for Microsoft Visual Studio\n" +
          "(Distributable Code). Copyright (c) Microsoft Corporation.",
      ],
    },
    {
      name: "Tesseract OCR",
      version: "5.5.4",
      license: "Apache-2.0",
      texts: read("tesseract", "LICENSE-tesseract.txt"),
    },
    {
      name: "Leptonica",
      version: "1.87.0",
      license: "BSD-2-Clause",
      texts: read("tesseract", "LICENSE-leptonica.txt"),
    },
    {
      name: "zlib",
      version: "1.3.1",
      license: "Zlib",
      texts: read("tesseract", "LICENSE-zlib.txt"),
    },
    {
      name: "tessdata (eng, osd)",
      version: "4.1.0",
      license: "Apache-2.0",
      texts: read("tesseract", "tessdata", "LICENSE.txt"),
    },
    {
      name: "PDFium (pdfium-binaries)",
      version: "chromium/8111",
      license: "BSD-3-Clause AND Apache-2.0 (and bundled third-party licenses)",
      texts: pdfiumTexts,
    },
    {
      name: "Microsoft Edge WebView2 Runtime bootstrapper",
      version: "embedded",
      license: "Microsoft software license",
      texts: [
        "The installer embeds MicrosoftEdgeWebview2Setup.exe, which installs the Microsoft\n" +
          "Edge WebView2 Runtime when it is missing. The runtime is Microsoft software under\n" +
          "its own license terms. Copyright (c) Microsoft Corporation.",
      ],
    },
  ];
}

const HEADER = `PDF Workbench: third-party notices

PDF Workbench is (c) cjmdevs. It includes the third-party software listed below, each
under its own license. The full license texts follow. This file is generated at build
time from the npm packages in the app bundle, the Rust crates in the app and the bundled
native programs.`;

function main() {
  const dev = process.argv.includes("--dev");
  const policy = JSON.parse(readFileSync(join(root, "license-policy.json"), "utf8"));
  mkdirSync(outDir, { recursive: true });
  const npm = npmEntries(policy);
  if (!npm) {
    if (dev) {
      if (!existsSync(OUT))
        writeFileSync(OUT, "PDF Workbench development build: notices are generated by a build.\n");
      return;
    }
    console.error("notices: run vite build first (no bundle-packages.json)");
    process.exit(1);
  }
  const entries = [...npm, ...cargoEntries(policy), ...nativeEntries()];
  const missing = missingTexts(entries);
  if (missing.length) {
    console.error(
      `notices: ${missing.length} dependencies have no license text. Add a reviewed copy to ` +
        `licenses/upstream/ and an entry in license-policy.json "licenseTexts":\n  ${missing.join("\n  ")}`,
    );
    process.exit(1);
  }
  writeFileSync(OUT, render(entries, HEADER));
  console.log(`notices: ${entries.length} components -> ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
