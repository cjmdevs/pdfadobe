// Phase 9: every Tier A tool on the synthetic corpus, through a real MCP client.
// Checks the result facts, that the output opens with the right page count, that the
// original is untouched, and that nothing returned or logged carries document text.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchDocument } from "../../src/engine/redact";
import { pageCount } from "../../mcp-server/src/tools/common";
import {
  auditLines,
  connect,
  makeSandbox,
  sharedRuntime,
  snapshot,
  textOf,
  type Harness,
  type Sandbox,
  type ToolResult,
} from "../helpers/mcp";

const FAKE_SSN = "000-12-3456";

let sb: Sandbox;
let h: Harness;
let originals: Map<string, string>;

beforeAll(async () => {
  sb = makeSandbox();
  originals = snapshot(join(sb.shared, "Clients"));
  h = await connect([sb.shared]);
});

afterAll(async () => {
  await h.close();
});

function ok(r: ToolResult): Record<string, unknown> {
  if (r.isError) throw new Error(`tool failed: ${textOf(r)}`);
  expect(textOf(r)).not.toContain(FAKE_SSN);
  return r.structuredContent ?? {};
}

async function outputPages(r: ToolResult): Promise<number> {
  const out = ok(r).output as { path: string; pages: number };
  expect(out.path.startsWith(join(sb.shared, "Outputs"))).toBe(true);
  const rt = await sharedRuntime();
  const n = pageCount(rt.module, new Uint8Array(readFileSync(out.path)));
  expect(n).toBe(out.pages);
  return n;
}

describe("MCP Tier A tools", () => {
  it("lists only the tools the plan names (Tier B is off by default)", async () => {
    const names = (await h.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_bates",
        "add_bookmarks",
        "add_header_footer",
        "add_watermark",
        "extract_pages",
        "get_info",
        "insert_pages",
        "list_pdfs",
        "merge",
        "ocr",
        "open_in_app",
        "optimize",
        "redact_patterns",
        "reorder",
        "rotate",
        "split",
      ].sort(),
    );
  });

  it("list_pdfs finds the samples and skips _workspace", async () => {
    const f = ok(await h.call("list_pdfs", {}));
    const paths = (f.files as { path: string }[]).map((x) => x.path);
    expect(paths).toContain(sb.file("text-1p.pdf"));
    expect(paths.some((p) => p.includes("_workspace"))).toBe(false);
  });

  it("get_info reports facts, never text", async () => {
    const t = ok(await h.call("get_info", { path: sb.file("text-1p.pdf") }));
    expect(t).toMatchObject({ pages: 1, has_text: true, has_forms: false, is_encrypted: false });
    const s = ok(await h.call("get_info", { path: sb.file("scanned-image-only.pdf") }));
    expect(s.has_text).toBe(false);
    const f = ok(await h.call("get_info", { path: sb.file("acroform.pdf") }));
    expect(f.has_forms).toBe(true);
    const e = ok(await h.call("get_info", { path: sb.file("encrypted.pdf") }));
    expect(e.is_encrypted).toBe(true);
  });

  it("merge", async () => {
    const r = await h.call("merge", {
      paths: [sb.file("workpaper-a.pdf"), sb.file("workpaper-b.pdf")],
      bookmark_per_file: true,
      task: "JD merge",
    });
    const rt = await sharedRuntime();
    const a = pageCount(rt.module, new Uint8Array(readFileSync(sb.file("workpaper-a.pdf"))));
    const b = pageCount(rt.module, new Uint8Array(readFileSync(sb.file("workpaper-b.pdf"))));
    expect(await outputPages(r)).toBe(a + b);
  });

  it("split every page, by bookmarks and by ranges", async () => {
    const r = ok(
      await h.call("split", {
        path: sb.file("navigation.pdf"),
        mode: "ranges",
        ranges: ["1-2", "3-z"],
      }),
    );
    expect((r.outputs as { pages: number }[]).map((o) => o.pages)).toEqual([2, 6]);
    const n = ok(
      await h.call("split", { path: sb.file("navigation.pdf"), mode: "every_n_pages", n: 4 }),
    );
    expect((n.outputs as unknown[]).length).toBe(2);
    const b = ok(
      await h.call("split", { path: sb.file("navigation.pdf"), mode: "top_level_bookmarks" }),
    );
    expect((b.outputs as unknown[]).length).toBeGreaterThan(0);
  });

  it("rotate, reorder, extract_pages, insert_pages", async () => {
    expect(
      await outputPages(
        await h.call("rotate", { path: sb.file("navigation.pdf"), degrees: 90, pages: "1-2" }),
      ),
    ).toBe(8);
    expect(
      await outputPages(await h.call("reorder", { path: sb.file("navigation.pdf"), order: "8-1" })),
    ).toBe(8);
    const bad = await h.call("reorder", { path: sb.file("navigation.pdf"), order: "1-3" });
    expect(bad.isError).toBe(true);
    expect(
      await outputPages(
        await h.call("extract_pages", { path: sb.file("navigation.pdf"), pages: "2, 4" }),
      ),
    ).toBe(2);
    expect(
      await outputPages(
        await h.call("insert_pages", {
          path: sb.file("navigation.pdf"),
          from_path: sb.file("text-1p.pdf"),
          before_page: 2,
        }),
      ),
    ).toBe(9);
  });

  it("add_bookmarks", async () => {
    const r = await h.call("add_bookmarks", {
      path: sb.file("text-1p.pdf"),
      bookmarks: [{ title: "W-2", page: 1, children: [{ title: "Employer A", page: 1 }] }],
    });
    expect(await outputPages(r)).toBe(1);
  });

  it("add_bates, add_header_footer, add_watermark", async () => {
    const b = ok(
      await h.call("add_bates", { path: sb.file("navigation.pdf"), prefix: "JD-", digits: 4 }),
    );
    expect(b.first_number).toBe("JD-0001");
    expect(b.pages_numbered).toBe(8);
    expect(
      await outputPages(
        await h.call("add_header_footer", {
          path: sb.file("text-1p.pdf"),
          footer_center: "Page {page} of {pages}",
        }),
      ),
    ).toBe(1);
    expect(
      await outputPages(
        await h.call("add_watermark", { path: sb.file("text-1p.pdf"), text: "DRAFT" }),
      ),
    ).toBe(1);
  });

  it("optimize", async () => {
    const r = ok(
      await h.call("optimize", { path: sb.file("scanned-image-only.pdf"), preset: "email" }),
    );
    expect((r.output as { size_bytes: number }).size_bytes).toBeLessThanOrEqual(
      r.size_before as number,
    );
  });

  it("ocr reports page numbers only", async () => {
    const r = ok(await h.call("ocr", { path: sb.file("scanned-image-only.pdf") }));
    expect(r.pages_read).toEqual([1]);
    const out = (r.output as { path: string }).path;
    const info = ok(await h.call("get_info", { path: out }));
    expect(info.has_text).toBe(true);
  }, 180_000);

  it("redact_patterns returns counts per page and removes the numbers", async () => {
    const dry = ok(
      await h.call("redact_patterns", { path: sb.file("ssn-redaction.pdf"), dry_run: true }),
    );
    expect(dry.matches).toBeGreaterThan(0);
    const r = ok(
      await h.call("redact_patterns", { path: sb.file("ssn-redaction.pdf"), patterns: ["ssn"] }),
    );
    expect(r.verified).toBe(true);
    expect(Object.keys(r.matches_per_page as object)).toContain("1");
    const out = (r.output as { path: string }).path;
    const rt = await sharedRuntime();
    expect(
      searchDocument(rt.module, new Uint8Array(readFileSync(out)), { patterns: ["ssn"] }),
    ).toEqual([]);
    expect(readFileSync(out).includes(Buffer.from(FAKE_SSN))).toBe(false);
  });

  it("open_in_app hands the file and page to the launcher", async () => {
    ok(await h.call("open_in_app", { path: sb.file("navigation.pdf"), page: 3 }));
    expect(h.opened.at(-1)).toEqual({ file: sb.file("navigation.pdf"), page: 3 });
  });

  it("refuses password-protected files for changes", async () => {
    const r = await h.call("rotate", { path: sb.file("encrypted.pdf"), degrees: 90 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/password/);
  });

  it("left every original untouched and logged every call without text", () => {
    expect(snapshot(join(sb.shared, "Clients"))).toEqual(originals);
    const lines = auditLines(sb.shared);
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) {
      expect(l).toMatchObject({ tier: "A" });
      expect(typeof l.user).toBe("string");
      expect(JSON.stringify(l)).not.toContain(FAKE_SSN);
    }
    expect(existsSync(join(sb.shared, "_workspace"))).toBe(true);
  });
});
