#!/usr/bin/env node
// Code signing hook (Phase 10a). Tauri calls this for every file it signs
// (`bundle.windows.signCommand` in tauri.conf.json): the app exe, each unsigned
// .exe/.dll in the bundled resources (qpdf, Tesseract, PDFium), the NSIS uninstaller,
// its plugin DLLs and the setup .exe itself.
//
//   node scripts/sign.mjs <file>
//
// Configuration (environment only; nothing about the certificate is committed):
//   PDFWB_SIGN_THUMBPRINT   SHA-1 thumbprint of a code signing certificate in the
//                           Windows certificate store (CurrentUser or LocalMachine \My).
//   PDFWB_SIGN_TIMESTAMP_URL  RFC 3161 timestamp server (optional, but use it for real
//                           releases so signatures outlive the certificate).
//   PDFWB_SIGN_COMMAND      Instead of a thumbprint: a full command with %1 for the file
//                           (cloud HSM or USB token tools). Split on spaces; wrap an
//                           argument in "double quotes" to keep spaces.
//   PDFWB_RELEASE=1         Set by `npm run release`. Then a missing configuration or a
//                           failed signature fails the build. Without it the file is left
//                           unsigned and a warning is printed (dev builds).
//
// Exit code 0 = signed (or skipped outside release), 1 = failure.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What to do for one file, from the environment. Pure, so it can be tested. */
export function signPlan(env, file) {
  const release = env.PDFWB_RELEASE === "1";
  const custom = env.PDFWB_SIGN_COMMAND?.trim();
  const thumb = env.PDFWB_SIGN_THUMBPRINT?.replace(/[^0-9a-f]/gi, "");
  if (custom) {
    if (!custom.includes("%1")) return { kind: "error", message: "PDFWB_SIGN_COMMAND has no %1" };
    const [cmd, ...args] = splitCommand(custom).map((a) => a.replaceAll("%1", file));
    return { kind: "run", cmd, args };
  }
  if (thumb) {
    if (thumb.length !== 40)
      return { kind: "error", message: "PDFWB_SIGN_THUMBPRINT must be 40 hex digits" };
    const args = ["sign", "/sha1", thumb, "/fd", "sha256"];
    const ts = env.PDFWB_SIGN_TIMESTAMP_URL?.trim();
    if (ts) args.push("/tr", ts, "/td", "sha256");
    args.push(file);
    return { kind: "signtool", args };
  }
  if (release)
    return {
      kind: "error",
      message:
        "release build with no signing certificate: set PDFWB_SIGN_THUMBPRINT or PDFWB_SIGN_COMMAND",
    };
  return { kind: "skip" };
}

/** Splits on spaces; "double quoted" parts keep their spaces. */
export function splitCommand(s) {
  const out = [];
  for (const m of s.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2]);
  return out;
}

/** Newest x64 signtool.exe from the Windows SDK, or null. */
export function findSigntool() {
  const base = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
    .sort((a, b) => cmpVersion(b, a));
  for (const v of versions) {
    const p = join(base, v, "x64", "signtool.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

function cmpVersion(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function main() {
  const file = process.argv[2];
  if (!file || !existsSync(file)) {
    console.error(`sign: file not found: ${file ?? "(none)"}`);
    process.exit(1);
  }
  const plan = signPlan(process.env, file);
  if (plan.kind === "skip") {
    console.warn(`sign: WARNING not signed (dev build, no certificate): ${file}`);
    return;
  }
  if (plan.kind === "error") {
    console.error(`sign: ${plan.message}`);
    process.exit(1);
  }
  try {
    if (plan.kind === "run") execFileSync(plan.cmd, plan.args, { stdio: "inherit" });
    else {
      const tool = findSigntool();
      if (!tool) throw new Error("signtool.exe not found (install the Windows 10/11 SDK)");
      execFileSync(tool, plan.args, { stdio: "inherit" });
    }
  } catch (e) {
    console.error(`sign: failed for ${file}: ${e.message}`);
    process.exit(1);
  }
  // Tauri packs the signed app exe, then puts the unsigned build back in
  // target/release. Keep the signed copy so verify-signed.mjs can check what shipped.
  if (basename(file).toLowerCase() === "pdf-workbench.exe") {
    const dir = join(dirname(file), "signed");
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, join(dir, "pdf-workbench.exe"));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
