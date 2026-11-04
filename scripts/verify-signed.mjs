#!/usr/bin/env node
// Release gate (Phase 10a): every .exe and .dll that ships, and the setup .exe itself,
// must carry a good Authenticode signature. Run by `npm run release` after `tauri build`.
//
//   node scripts/verify-signed.mjs [--test-cert]
//
// A file passes when Windows reports the signature Valid and the signer is our
// certificate (PDFWB_SIGN_THUMBPRINT, when set) or Microsoft (the Visual C++ runtime
// DLLs qpdf ships are signed by Microsoft). With --test-cert (self-signed certificate
// from scripts/make-test-codesign-cert.ps1) an untrusted root is accepted as long as
// the signer thumbprint is ours; never use that for a real release.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const tauri = join(root, "src-tauri");

/** Every file the installer ships that Windows can sign, plus the installer. */
export function shippedBinaries(setupExe) {
  // The copy scripts/sign.mjs kept: Tauri restores the unsigned exe after packing.
  const out = [join(tauri, "target", "release", "signed", "pdf-workbench.exe")];
  for (const dir of ["qpdf", "tesseract", "pdfium"]) walk(join(tauri, "vendor", dir), out);
  if (setupExe) out.push(setupExe);
  return out;
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(exe|dll)$/i.test(f)) out.push(p);
  }
}

/** The newest NSIS setup .exe in the bundle folder, or null. */
export function findSetup() {
  const dir = join(tauri, "target", "release", "bundle", "nsis");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith("-setup.exe"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/**
 * Pass/fail for one Get-AuthenticodeSignature result. Pure, so it can be tested.
 * `sig` = { Status, Thumbprint, Subject }, `ours` = expected thumbprint or "".
 */
export function judge(sig, ours, testCert) {
  const thumb = (sig.Thumbprint ?? "").toUpperCase();
  const mine = ours !== "" && thumb === ours.toUpperCase();
  // The VC++ runtime DLLs are signed by Microsoft (Corporation or Windows Software
  // Compatibility Publisher); Valid status means the chain goes to Microsoft's root.
  const microsoft = /(^|, )O=Microsoft Corporation(,|$)/.test(sig.Subject ?? "");
  if (sig.Status === "Valid" && (mine || microsoft || ours === "")) return null;
  if (sig.Status === "Valid") return `signed by someone else (${sig.Subject})`;
  if (testCert && mine && sig.Status === "UnknownError") return null; // untrusted test root
  if (sig.Status === "NotSigned") return "not signed";
  return `signature ${sig.Status}`;
}

/** Get-AuthenticodeSignature for many files in one PowerShell call. */
export function signatures(files) {
  const list = files.map((f) => `'${f.replaceAll("'", "''")}'`).join(",");
  const script =
    `@(${list}) | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; ` +
    `[pscustomobject]@{ Path = $_; Status = [string]$s.Status; ` +
    `Thumbprint = $s.SignerCertificate.Thumbprint; Subject = $s.SignerCertificate.Subject } } ` +
    `| ConvertTo-Json -Compress`;
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  ).toString();
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function main() {
  const testCert = process.argv.includes("--test-cert");
  const setup = findSetup();
  if (!setup) {
    console.error("verify-signed: no NSIS setup .exe found; run tauri build first");
    process.exit(1);
  }
  const files = shippedBinaries(setup);
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error(`verify-signed: missing ${missing.join(", ")}`);
    process.exit(1);
  }
  const ours = (process.env.PDFWB_SIGN_THUMBPRINT ?? "").replace(/[^0-9a-f]/gi, "");
  const bad = [];
  for (const sig of signatures(files)) {
    const why = judge(sig, ours, testCert);
    if (why) bad.push(`${relative(root, sig.Path)}: ${why}`);
  }
  if (bad.length) {
    console.error(
      `verify-signed: ${bad.length} of ${files.length} files fail:\n  ${bad.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `verify-signed: all ${files.length} files signed${testCert ? " (test certificate)" : ""}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
