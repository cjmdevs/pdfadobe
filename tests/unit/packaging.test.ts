// Phase 10a release gates: signing plan, signature judging, installer payload.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { signPlan, splitCommand } from "../../scripts/sign.mjs";
// @ts-expect-error plain .mjs script without type declarations
import { judge } from "../../scripts/verify-signed.mjs";
// @ts-expect-error plain .mjs script without type declarations
import { payloadProblems, REQUIRED } from "../../scripts/check-payload.mjs";

const THUMB = "A1B1A2B2A3B3A4B4A5B5A6B6A7B7A8B8A9B9A0B0";

describe("sign.mjs plan", () => {
  it("skips with a warning outside release when nothing is configured", () => {
    expect(signPlan({}, "a.exe")).toEqual({ kind: "skip" });
  });

  it("fails a release build that has no certificate", () => {
    expect(signPlan({ PDFWB_RELEASE: "1" }, "a.exe").kind).toBe("error");
  });

  it("signs with signtool by thumbprint, sha256, optional timestamp", () => {
    expect(signPlan({ PDFWB_SIGN_THUMBPRINT: THUMB.toLowerCase() }, "a.exe")).toEqual({
      kind: "signtool",
      args: ["sign", "/sha1", THUMB.toLowerCase(), "/fd", "sha256", "a.exe"],
    });
    const p = signPlan(
      { PDFWB_SIGN_THUMBPRINT: THUMB, PDFWB_SIGN_TIMESTAMP_URL: "http://ts.example" },
      "a.exe",
    );
    expect(p.args).toEqual([
      "sign",
      "/sha1",
      THUMB,
      "/fd",
      "sha256",
      "/tr",
      "http://ts.example",
      "/td",
      "sha256",
      "a.exe",
    ]);
  });

  it("refuses a malformed thumbprint even outside release", () => {
    expect(signPlan({ PDFWB_SIGN_THUMBPRINT: "abc" }, "a.exe").kind).toBe("error");
  });

  it("runs a custom command with %1 replaced and quoted parts kept", () => {
    const p = signPlan(
      { PDFWB_SIGN_COMMAND: 'relic sign --file %1 --config "C:\\My Certs\\relic.conf"' },
      "C:\\b\\x y.exe",
    );
    expect(p).toEqual({
      kind: "run",
      cmd: "relic",
      args: ["sign", "--file", "C:\\b\\x y.exe", "--config", "C:\\My Certs\\relic.conf"],
    });
    expect(signPlan({ PDFWB_SIGN_COMMAND: "tool sign" }, "a.exe").kind).toBe("error");
    expect(splitCommand('a "b c" d')).toEqual(["a", "b c", "d"]);
  });
});

describe("verify-signed.mjs judge", () => {
  const ms = "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";
  it("passes our valid signature and Microsoft's", () => {
    expect(judge({ Status: "Valid", Thumbprint: THUMB, Subject: "CN=MGR" }, THUMB, false)).toBe(
      null,
    );
    expect(judge({ Status: "Valid", Thumbprint: "FF", Subject: ms }, THUMB, false)).toBe(null);
  });
  it("fails unsigned, foreign and broken signatures", () => {
    expect(judge({ Status: "NotSigned" }, THUMB, false)).toBe("not signed");
    expect(judge({ Status: "Valid", Thumbprint: "FF", Subject: "CN=Other" }, THUMB, false)).toMatch(
      /someone else/,
    );
    expect(judge({ Status: "HashMismatch", Thumbprint: THUMB }, THUMB, false)).toMatch(
      /HashMismatch/,
    );
  });
  it("accepts an untrusted root only for our test certificate with --test-cert", () => {
    const s = { Status: "UnknownError", Thumbprint: THUMB, Subject: "CN=Test" };
    expect(judge(s, THUMB, false)).toMatch(/UnknownError/);
    expect(judge(s, THUMB, true)).toBe(null);
    expect(judge({ ...s, Thumbprint: "FF" }, THUMB, true)).toMatch(/UnknownError/);
  });
});

describe("check-payload.mjs", () => {
  const good =
    '!define INSTALLMODE "currentUser"\n!define INSTALLWEBVIEW2MODE "embedBootstrapper"\n' +
    '!include "C:\\x\\windows\\hooks.nsh"\n' +
    (REQUIRED as string[]).map((f) => `    File /a "/oname=${f}" "C:\\src\\${f}"`).join("\n");

  it("passes when every required file and setting is there", () => {
    expect(payloadProblems(good)).toEqual([]);
  });

  it("names each missing file and wrong setting", () => {
    const bad = good
      .replace(/.*eng\.traineddata.*\n?/, "")
      .replace("embedBootstrapper", "downloadBootstrapper")
      .replace("currentUser", "perMachine")
      .replace(/!include .*hooks\.nsh"\n/, "");
    expect(payloadProblems(bad)).toEqual([
      "missing tesseract\\tessdata\\eng.traineddata",
      "WebView2 bootstrapper is not embedded (webviewInstallMode)",
      "install mode is not currentUser",
      "installer hooks (hooks.nsh) not included",
    ]);
  });
});

describe("notices.mjs", () => {
  it("prints identical texts once and lists who uses them", async () => {
    // @ts-expect-error plain .mjs script without type declarations
    const { render, missingTexts, htmlToText } = await import("../../scripts/notices.mjs");
    const mit = "MIT License\n\nCopyright (c) X";
    const text: string = render(
      [
        { name: "a", version: "1", license: "MIT", texts: [mit] },
        { name: "b", version: "2", license: "MIT", texts: ["MIT License\n  Copyright (c) X  "] },
        { name: "c", version: "3", license: "Apache-2.0", texts: ["Apache text"] },
      ],
      "Header",
    );
    expect(text.split("MIT License").length - 1).toBe(1);
    expect(text).toContain("Used by: a 1 (MIT), b 2 (MIT)");
    expect(text).toContain("3 components:");
    expect(
      missingTexts([
        { name: "a", version: "1", texts: [] },
        { name: "b", version: "2", texts: [" "] },
        { name: "c", version: "3", texts: ["x"] },
      ]),
    ).toEqual(["a 1", "b 2"]);
    expect(htmlToText("<p>A &amp; B</p><br>C")).toBe("A & B\n\nC");
  });
});

describe("update-package.mjs", () => {
  it("writes the manifest the app reads and finds versions in setup names", async () => {
    // @ts-expect-error plain .mjs script without type declarations
    const { manifestText, versionOfSetup } = await import("../../scripts/update-package.mjs");
    const base = { version: "1.2.0", notes: "n", file: "f-setup.exe", sha256: "ab", date: "d" };
    expect(JSON.parse(manifestText(base))).toEqual({
      version: "1.2.0",
      notes: "n",
      pub_date: "d",
      file: "f-setup.exe",
      sha256: "ab",
    });
    expect(JSON.parse(manifestText({ ...base, rollback: true })).rollback).toBe(true);
    expect(versionOfSetup("PDF Workbench_1.2.0_x64-setup.exe")).toBe("1.2.0");
    expect(versionOfSetup("PDF Workbench_1.2.0-rc.1_x64-setup.exe")).toBe("1.2.0-rc.1");
    expect(versionOfSetup("other.exe")).toBe(null);
  });
});
