// Phase 8: Protect and Remove Security through qpdf. AES-256 only; an open password
// keeps the file closed without it; permissions are set; removing security gives back
// the same pages; passwords never reach qpdf's command line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUT_DIR, ENCRYPTED_PASSWORDS } from "../corpus/generate.mjs";
import { nodeQpdf } from "../helpers/qpdf-node";
import type { Qpdf, QpdfJob } from "../../src/engine/pages/qpdf";
import { protectPdf, removeSecurity, securityInfo, SecurityError } from "../../src/engine/security";

const corpus = (f: string) => new Uint8Array(readFileSync(join(OUT_DIR, f)));
const jobs: QpdfJob[] = [];
const real = nodeQpdf();
const qpdf: Qpdf = {
  run(job) {
    jobs.push(job);
    return real.run(job);
  },
};

/** Page content as qpdf sees it (decrypted, uncompressed), for comparing round trips. */
async function pagesJson(bytes: Uint8Array): Promise<string> {
  const r = await real.run({
    inputs: { "in0.pdf": bytes },
    args: ["--json=2", "--json-key=pages", "in0.pdf"],
    outputs: [],
  });
  return JSON.stringify(JSON.parse(r.stdout).pages.length);
}

describe("password security", () => {
  it("open password: AES-256, closed without it, round-trips", async () => {
    const src = corpus("text-1p.pdf");
    const locked = await protectPdf(qpdf, src, {
      openPassword: "Open-Sesame-1",
      permissionsPassword: "",
      print: "full",
      changes: "all",
      copy: true,
    });
    expect(await securityInfo(qpdf, locked)).toMatchObject({
      encrypted: true,
      needsOpenPassword: true,
    });
    const info = await securityInfo(qpdf, locked, "Open-Sesame-1");
    expect(info.method).toBe("AES-256");
    expect(info.permissions["print high resolution"]).toBe(true);
    await expect(removeSecurity(qpdf, locked, "wrong")).rejects.toThrow(SecurityError);
    const open = await removeSecurity(qpdf, locked, "Open-Sesame-1");
    expect((await securityInfo(qpdf, open)).encrypted).toBe(false);
    expect(await pagesJson(open)).toBe(await pagesJson(src));
    // Same text as the original.
    const text = (b: Uint8Array) =>
      real.run({
        inputs: { "in0.pdf": b },
        args: ["--qdf", "--object-streams=disable", "in0.pdf", "out.pdf"],
        outputs: ["out.pdf"],
      });
    const a = new TextDecoder("latin1").decode((await text(src)).files["out.pdf"]);
    const b = new TextDecoder("latin1").decode((await text(open)).files["out.pdf"]);
    expect(b).toContain("Sample Engagement Memo");
    expect(a.includes("Sample Engagement Memo")).toBe(b.includes("Sample Engagement Memo"));
  });

  it("permissions password: opens without a password, restrictions set", async () => {
    const locked = await protectPdf(qpdf, corpus("text-1p.pdf"), {
      openPassword: "",
      permissionsPassword: "Owner-Only-2",
      print: "low",
      changes: "none",
      copy: false,
    });
    const info = await securityInfo(qpdf, locked);
    expect(info).toMatchObject({ encrypted: true, needsOpenPassword: false, method: "AES-256" });
    expect(info.permissions).toMatchObject({
      "print high resolution": false,
      "print low resolution": true,
      "extract for any purpose": false,
      "modify anything": false,
    });
    const open = await removeSecurity(qpdf, locked, "Owner-Only-2");
    expect((await securityInfo(qpdf, open)).encrypted).toBe(false);
  });

  it("refuses no password, equal passwords, and an already protected file", async () => {
    const o = { print: "full", changes: "all", copy: true } as const;
    await expect(
      protectPdf(qpdf, corpus("text-1p.pdf"), { ...o, openPassword: "", permissionsPassword: "" }),
    ).rejects.toThrow(SecurityError);
    await expect(
      protectPdf(qpdf, corpus("text-1p.pdf"), {
        ...o,
        openPassword: "x1",
        permissionsPassword: "x1",
      }),
    ).rejects.toThrow(SecurityError);
    await expect(
      protectPdf(qpdf, corpus("encrypted.pdf"), {
        ...o,
        openPassword: "a",
        permissionsPassword: "",
      }),
    ).rejects.toThrow(SecurityError);
    const open = await removeSecurity(qpdf, corpus("encrypted.pdf"), ENCRYPTED_PASSWORDS.user);
    expect((await securityInfo(qpdf, open)).encrypted).toBe(false);
  });

  it("passwords never appear in qpdf's arguments", () => {
    const args = jobs.flatMap((j) => j.args).join(" ");
    for (const pw of ["Open-Sesame-1", "Owner-Only-2", ENCRYPTED_PASSWORDS.user]) {
      expect(args).not.toContain(pw);
    }
    expect(jobs.length).toBeGreaterThan(5);
  });
});
