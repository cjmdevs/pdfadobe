// Phase 9 safety rules, enforced in code:
// - only configured folders are reachable (links, junctions, ADS, device paths refused)
// - no tool writes outside <folder>\_workspace\ and <folder>\Outputs\, originals unchanged
// - Tier B tools do not exist unless the firm's policy turns them on
// - the audit log records every call (refused ones too) without document text
import { readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseArgs, parsePolicy } from "../../mcp-server/src/config";
import { checkPathForm, isInside, Roots } from "../../mcp-server/src/safety/roots";
import { ensureDir, maskIds, safeName, safeTask } from "../../mcp-server/src/safety/writer";
import { TIER_B_TOOLS } from "../../mcp-server/src/tools/content";
import {
  auditLines,
  connect,
  makeSandbox,
  snapshot,
  textOf,
  type Harness,
  type Sandbox,
} from "../helpers/mcp";

describe("path rules", () => {
  it("rejects relative, device, \\\\?\\ and alternate-data-stream paths", () => {
    for (const p of [
      "file.pdf",
      "..\\x.pdf",
      "\\\\?\\C:\\x.pdf",
      "\\\\.\\PhysicalDrive0",
      "C:\\a\\b.pdf:secret",
      "",
    ]) {
      expect(() => checkPathForm(p), p).toThrow();
    }
    expect(() => checkPathForm("C:\\a\\b.pdf")).not.toThrow();
    expect(() => checkPathForm("\\\\server\\share\\b.pdf")).not.toThrow();
  });

  it("compares like Windows (case-insensitive, whole folder names)", () => {
    expect(isInside("C:\\Shared\\A\\x.pdf", "c:\\shared")).toBe(true);
    expect(isInside("C:\\SharedOther\\x.pdf", "C:\\Shared")).toBe(false);
  });

  it("masks SSN/EIN/account-like numbers in names it creates", () => {
    expect(maskIds("Smith 123-45-6789")).toBe("Smith XXX-XX-XXXX");
    expect(maskIds("EIN 12-3456789")).toBe("EIN XX-XXXXXXX");
    expect(maskIds("acct 12345678901")).toBe("acct XXXXXXXXXXX");
    expect(maskIds("2025 1040 JD")).toBe("2025 1040 JD");
    expect(safeName("..\\..\\evil.pdf", "x.pdf")).toBe("evil.pdf");
    expect(safeName("CON", "x.pdf")).toBe("x.pdf");
    expect(safeTask("../../x 123456789", "t")).toBe("x XXXXXXXXX");
  });

  it("reads folders from the command line and the policy from the registry text", () => {
    expect(parseArgs(["--app=", "C:\\A", "D:\\B"])).toEqual({
      folders: ["C:\\A", "D:\\B"],
      appPath: null,
    });
    expect(() => parseArgs(["--allow-content"])).toThrow();
    expect(parsePolicy("    AllowContentToClaude    REG_DWORD    0x1")).toBe(true);
    expect(parsePolicy("    AllowContentToClaude    REG_DWORD    0x0")).toBe(false);
    expect(parsePolicy("    AllowContentToClaude    REG_SZ    1")).toBe(false);
    expect(parsePolicy("")).toBe(false);
  });
});

describe("no tool can write outside _workspace and Outputs", () => {
  let sb: Sandbox;
  let h: Harness;
  let before: Map<string, string>;
  let tempBefore: string[];

  beforeAll(async () => {
    sb = makeSandbox();
    // A junction inside the configured folder that leads outside it.
    symlinkSync(sb.outside, join(sb.shared, "Clients", "link-out"), "junction");
    before = snapshot(sb.base);
    tempBefore = readdirSync(tmpdir());
    h = await connect([sb.shared]);
  });

  afterAll(async () => {
    await h.close();
  });

  const attacks = (sb: Sandbox) =>
    [
      ["get_info", { path: join(sb.outside, "secret.pdf") }],
      ["get_info", { path: join(sb.shared, "..", "Outside", "secret.pdf") }],
      ["get_info", { path: join(sb.shared, "Clients", "link-out", "secret.pdf") }],
      ["get_info", { path: `${sb.file("text-1p.pdf")}:stream` }],
      ["rotate", { path: join(sb.outside, "secret.pdf"), degrees: 90 }],
      ["list_pdfs", { folder: sb.outside }],
      ["list_pdfs", { folder: join(sb.shared, "Clients", "link-out") }],
      ["merge", { paths: [sb.file("text-1p.pdf"), join(sb.outside, "secret.pdf")] }],
      ["insert_pages", { path: sb.file("text-1p.pdf"), from_path: join(sb.outside, "secret.pdf") }],
    ] as const;

  it("refuses every path outside the configured folder", async () => {
    for (const [tool, args] of attacks(sb)) {
      const r = await h.call(tool, args as Record<string, unknown>);
      expect(r.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
    }
  });

  it("list_pdfs never follows the junction", async () => {
    const r = await h.call("list_pdfs", {});
    expect(textOf(r)).not.toContain("secret.pdf");
  });

  it("keeps output names and task names inside Outputs and _workspace", async () => {
    const r = await h.call("rotate", {
      path: sb.file("text-1p.pdf"),
      degrees: 90,
      task: "..\\..\\..\\Outside",
      output_name: "..\\..\\Outside\\pwned.pdf",
    });
    expect(r.isError).toBeFalsy();
    const out = (r.structuredContent?.output as { path: string }).path;
    expect(out).toBe(join(sb.shared, "Outputs", "pwned.pdf"));
    const again = await h.call("rotate", {
      path: sb.file("text-1p.pdf"),
      degrees: 90,
      output_name: "pwned.pdf",
    });
    expect((again.structuredContent?.output as { path: string }).path).toBe(
      join(sb.shared, "Outputs", "pwned (2).pdf"),
    );
  });

  it("refuses to write through an Outputs junction that leads elsewhere", async () => {
    const sb2 = makeSandbox();
    symlinkSync(sb2.outside, join(sb2.shared, "Outputs"), "junction");
    const h2 = await connect([sb2.shared]);
    const r = await h2.call("rotate", { path: sb2.file("text-1p.pdf"), degrees: 90 });
    expect(r.isError).toBe(true);
    expect(readdirSync(sb2.outside)).toEqual(["secret.pdf"]);
    await h2.close();
    const roots = await Roots.create([sb2.shared]);
    await expect(ensureDir(roots.list[0]!, ["Clients"])).rejects.toThrow();
    await expect(ensureDir(roots.list[0]!, ["..", "x"])).rejects.toThrow();
  });

  it("after all calls, only _workspace and Outputs changed; temp folder untouched", async () => {
    for (const [tool, args] of [
      ["merge", { paths: [sb.file("workpaper-a.pdf"), sb.file("workpaper-b.pdf")] }],
      ["split", { path: sb.file("navigation.pdf"), mode: "every_n_pages", n: 3 }],
      ["add_bates", { path: sb.file("text-1p.pdf"), prefix: "JD-" }],
      ["redact_patterns", { path: sb.file("ssn-redaction.pdf") }],
      ["optimize", { path: sb.file("text-1p.pdf") }],
    ] as const) {
      const r = await h.call(tool, args as Record<string, unknown>);
      expect(r.isError, tool).toBeFalsy();
    }
    const after = snapshot(sb.base);
    for (const [k, v] of before) expect(after.get(k), k).toBe(v);
    const added = [...after.keys()].filter((k) => !before.has(k));
    expect(added.length).toBeGreaterThan(0);
    for (const k of added) {
      expect(
        k.startsWith("Shared\\_workspace\\") ||
          k.startsWith("Shared\\Outputs\\") ||
          k === "Shared\\_workspace\\" ||
          k === "Shared\\Outputs\\",
        k,
      ).toBe(true);
    }
    const newTemp = readdirSync(tmpdir()).filter(
      (n) => !tempBefore.includes(n) && /^(qpdf|ocr)-/.test(n),
    );
    expect(newTemp).toEqual([]);
  });

  it("logged the refused calls too, with no document text", () => {
    const lines = auditLines(sb.shared);
    expect(lines.filter((l) => l.result === "error").length).toBeGreaterThanOrEqual(
      attacks(sb).length,
    );
    expect(JSON.stringify(lines)).not.toContain("000-12-3456");
  });
});

describe("Tier B tools", () => {
  it("do not exist when the firm policy is off", async () => {
    const sb = makeSandbox();
    const h = await connect([sb.shared], { allowContent: false });
    const names = (await h.client.listTools()).tools.map((t) => t.name);
    for (const t of TIER_B_TOOLS) {
      expect(names).not.toContain(t);
      const r = await h
        .call(t, { path: sb.file("text-1p.pdf"), pages: "1", page: 1 })
        .catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
      expect(r.isError, t).toBe(true);
      expect(JSON.stringify(r)).not.toContain("KEEP");
    }
    await h.close();
  });

  it("when on: name the file and pages in a header, and are marked B in the audit log", async () => {
    const sb = makeSandbox();
    const h = await connect([sb.shared], { allowContent: true });
    const names = (await h.client.listTools()).tools.map((t) => t.name);
    for (const t of TIER_B_TOOLS) expect(names).toContain(t);
    const desc = (await h.client.listTools()).tools.find(
      (t) => t.name === "read_text",
    )?.description;
    expect(desc).toMatch(/STOP AND ASK FIRST/);
    const r = await h.call("read_text", { path: sb.file("navigation.pdf"), pages: "1-2" });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain(`File: ${sb.file("navigation.pdf")} | Pages: 1-2`);
    const img = await h.call("render_page_image", { path: sb.file("text-1p.pdf"), page: 1 });
    expect(img.content.some((c) => c.type === "image")).toBe(true);
    const f = await h.call("read_form_values", { path: sb.file("acroform.pdf") });
    expect(f.isError).toBeFalsy();
    const a = await h.call("list_annotations", { path: sb.file("ssn-redaction.pdf") });
    expect(a.isError).toBeFalsy();
    const too = await h.call("read_text", { path: sb.file("navigation.pdf"), pages: "1-z" });
    expect(too.isError).toBeFalsy();
    const lines = auditLines(sb.shared).filter((l) =>
      (TIER_B_TOOLS as readonly string[]).includes(l.tool as string),
    );
    expect(lines.length).toBe(5);
    for (const l of lines) expect(l.tier).toBe("B");
    expect(JSON.stringify(auditLines(sb.shared))).not.toContain("000-12-3456");
    await h.close();
  });
});
