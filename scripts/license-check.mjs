#!/usr/bin/env node
// License gate for npm packages and Rust crates. Exits 1 on any violation.
//
// Policy (CLAUDE.md): MIT, BSD, Apache-2.0, MPL-2.0, ISC only; never GPL/AGPL/LGPL.
// - An SPDX expression passes if it can be satisfied using allowed licenses
//   (for "A OR B" we can pick either; for "A AND B" both must pass).
// - `approvedExtras` in license-policy.json are permissive, non-copyleft licenses
//   that the owner approved individually (e.g. Unicode-3.0 for unicode-ident).
// - Copyleft is never satisfiable, even if someone adds it to the policy file.
// - Missing or unparseable licenses fail.
//
// Usage: node scripts/license-check.mjs [--npm-only | --rust-only]

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, satisfy } from "./license-spdx.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(readFileSync(join(root, "license-policy.json"), "utf8"));

const ALLOWED = new Set(policy.allowed);
const EXTRAS = new Set(Object.keys(policy.approvedExtras));
const usedExtras = new Map();

// ---- Collectors -------------------------------------------------------------
function npmPackages() {
  // `npm ls` walks the installed tree; --all includes transitive deps (dev too:
  // dev tools are redistributed to every developer machine and CI).
  const out = execFileSync("npm", ["ls", "--all", "--json", "--long"], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const tree = JSON.parse(out.toString());
  const seen = new Map();
  (function walk(deps) {
    for (const [name, d] of Object.entries(deps ?? {})) {
      if (!d.version) continue; // missing optional dep (other OS)
      const key = `${name}@${d.version}`;
      if (seen.has(key)) continue;
      let license = d.license;
      if (typeof license === "object" && license) license = license.type;
      if (!license && d.path) license = readPkgLicense(d.path);
      seen.set(key, { name: key, license, source: "npm" });
      walk(d.dependencies);
    }
  })(tree.dependencies);
  return [...seen.values()];
}

function readPkgLicense(dir) {
  const f = join(dir, "package.json");
  if (!existsSync(f)) return undefined;
  const p = JSON.parse(readFileSync(f, "utf8"));
  if (typeof p.license === "string") return p.license;
  if (Array.isArray(p.licenses)) return p.licenses.map((l) => l.type ?? l).join(" OR ");
  return undefined;
}

function rustPackages() {
  // Without --filter-platform this covers every target (Windows crates included).
  const out = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
    cwd: join(root, "src-tauri"),
    maxBuffer: 256 * 1024 * 1024,
  });
  const meta = JSON.parse(out.toString());
  const members = new Set(meta.workspace_members);
  return meta.packages
    .filter((p) => !members.has(p.id))
    .map((p) => ({
      name: `${p.name}@${p.version}`,
      license: p.license ?? (p.license_file ? `FILE:${p.license_file}` : undefined),
      source: "cargo",
    }));
}

// ---- Main -------------------------------------------------------------------
const args = new Set(process.argv.slice(2));
const pkgs = [
  ...(args.has("--rust-only") ? [] : npmPackages()),
  ...(args.has("--npm-only") ? [] : rustPackages()),
];

const failures = [];
for (const p of pkgs) {
  const override = policy.packageOverrides[p.name.replace(/@[^@]+$/, "")];
  const expr = override?.license ?? p.license;
  if (!expr) {
    failures.push(`${p.source} ${p.name}: no license declared`);
    continue;
  }
  let used;
  try {
    used = satisfy(parse(expr), ALLOWED, EXTRAS);
  } catch (e) {
    failures.push(`${p.source} ${p.name}: unparseable license "${expr}" (${e.message})`);
    continue;
  }
  if (used === null) {
    failures.push(`${p.source} ${p.name}: "${expr}" not allowed`);
    continue;
  }
  for (const l of used) {
    if (!usedExtras.has(l)) usedExtras.set(l, []);
    usedExtras.get(l).push(`${p.source} ${p.name}`);
  }
}

const npmCount = pkgs.filter((p) => p.source === "npm").length;
const cargoCount = pkgs.length - npmCount;
console.log(`license-check: ${npmCount} npm packages, ${cargoCount} Rust crates`);
for (const [l, users] of usedExtras) {
  console.log(`  approved extra ${l} (${policy.approvedExtras[l]}): ${users.length} package(s)`);
  for (const u of users) console.log(`    - ${u}`);
}
if (failures.length) {
  console.error(`\nFAIL: ${failures.length} package(s) violate the license policy:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("OK: no copyleft or unapproved licenses");
