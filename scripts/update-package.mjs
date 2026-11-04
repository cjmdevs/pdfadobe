#!/usr/bin/env node
// Update packages (Phase 10a). See docs/admin.md "Publishing an update".
//
//   node scripts/update-package.mjs                       package the last release build
//                                                         into release\<version>\
//   node scripts/update-package.mjs --publish <folder>    ...and publish it to the firm's
//                                                         update folder
//   node scripts/update-package.mjs --rollback <version> --folder <folder>
//                                                         point everyone back to a version
//                                                         already in that folder
//
// Environment: PDFWB_UPDATE_KEY = path of the private update key (made by
// `npx tauri signer generate`; default %USERPROFILE%\.pdfworkbench\update-signing.key),
// PDFWB_UPDATE_KEY_PASSWORD = its password (empty if none).
//
// Publishing copies the installer and its signature first and writes latest.json last
// (through a temporary name), so a PC never sees a manifest whose installer isn't there.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSetup } from "./verify-signed.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The manifest text (2-space JSON, trailing newline). Pure, for tests. */
export function manifestText({ version, notes, file, sha256, rollback, date }) {
  const m = { version, notes, pub_date: date, file, sha256 };
  if (rollback) m.rollback = true;
  return JSON.stringify(m, null, 2) + "\n";
}

/** "PDF Workbench_1.2.0_x64-setup.exe" -> "1.2.0" (Tauri's NSIS file name). */
export function versionOfSetup(name) {
  return /_(\d+\.\d+\.\d+(?:-[\w.]+)?)_x64-setup\.exe$/.exec(name)?.[1] ?? null;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function keyPath() {
  const k =
    process.env.PDFWB_UPDATE_KEY ??
    join(process.env.USERPROFILE ?? "", ".pdfworkbench", "update-signing.key");
  if (!existsSync(k)) throw new Error(`update key not found: ${k} (set PDFWB_UPDATE_KEY)`);
  return k;
}

/** Signs `file` with the update key; writes `<file>.sig`. */
function sign(file) {
  execFileSync(
    "npx",
    [
      "tauri",
      "signer",
      "sign",
      "-f",
      `"${keyPath()}"`,
      "-p",
      `"${process.env.PDFWB_UPDATE_KEY_PASSWORD ?? ""}"`,
      `"${file}"`,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"], shell: true },
  );
  if (!existsSync(`${file}.sig`)) throw new Error(`signing failed: ${file}`);
}

const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

/** Writes and signs latest.json in `dir`, through temporary names. */
function writeManifest(dir, fields) {
  const tmp = join(dir, "latest.json.tmp");
  writeFileSync(tmp, manifestText({ ...fields, date: new Date().toISOString() }));
  sign(tmp);
  renameSync(`${tmp}.sig`, join(dir, "latest.json.sig.new"));
  // The signature covers the bytes, not the name: rename both into place, sig last
  // so a reader that sees the new sig also sees the new json.
  renameSync(tmp, join(dir, "latest.json"));
  renameSync(join(dir, "latest.json.sig.new"), join(dir, "latest.json.sig"));
}

function packageBuild() {
  const setup = findSetup();
  if (!setup) throw new Error("no setup .exe: run npm run release first");
  const version = versionOfSetup(basename(setup));
  const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  if (version !== pkgVersion)
    throw new Error(`setup is ${version}, package.json is ${pkgVersion}: rebuild`);
  const out = join(root, "release", version);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const file = basename(setup);
  copyFileSync(setup, join(out, file));
  sign(join(out, file));
  const notesFile = join(root, "release", `notes-${version}.txt`);
  const notes = existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";
  writeManifest(out, { version, notes, file, sha256: sha256(join(out, file)) });
  copyFileSync(
    join(root, "src-tauri", "notices", "THIRD-PARTY-NOTICES.txt"),
    join(out, "THIRD-PARTY-NOTICES.txt"),
  );
  console.log(`update-package: ${out}`);
  return { out, file, version, notes };
}

function publish(pkg, folder) {
  if (!existsSync(folder)) throw new Error(`update folder not found: ${folder}`);
  for (const f of [pkg.file, `${pkg.file}.sig`]) copyFileSync(join(pkg.out, f), join(folder, f));
  if (sha256(join(folder, pkg.file)) !== sha256(join(pkg.out, pkg.file)))
    throw new Error("copy to the update folder does not match");
  writeManifest(folder, {
    version: pkg.version,
    notes: pkg.notes,
    file: pkg.file,
    sha256: sha256(join(folder, pkg.file)),
  });
  console.log(`update-package: published ${pkg.version} to ${folder}`);
}

function rollback(version, folder) {
  const file = `PDF Workbench_${version}_x64-setup.exe`;
  for (const f of [file, `${file}.sig`])
    if (!existsSync(join(folder, f))) throw new Error(`not in the update folder: ${f}`);
  writeManifest(folder, {
    version,
    notes: `The firm is moving everyone back to version ${version}.`,
    file,
    sha256: sha256(join(folder, file)),
    rollback: true,
  });
  console.log(`update-package: ${folder} now sends everyone back to ${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const back = arg("--rollback");
    if (back) {
      const folder = arg("--folder");
      if (!folder) throw new Error("--rollback needs --folder <update folder>");
      rollback(back, folder);
    } else {
      const pkg = packageBuild();
      const to = arg("--publish");
      if (to) publish(pkg, to);
    }
  } catch (e) {
    console.error(`update-package: ${e.message}`);
    process.exit(1);
  }
}
