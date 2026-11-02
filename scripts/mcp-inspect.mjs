// Phase 9 Inspector session: runs every Tier A tool of the BUILT server
// (mcp-server/dist/bundle) through the official MCP Inspector CLI over stdio, on a
// copy of the synthetic corpus. Fails on any tool error.
//
//   npm run mcp:inspect
//
// Sandbox: tests/corpus/out/mcp-inspect/Shared (recreated each run).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(repo, "mcp-server", "dist", "bundle", "server", "server.mjs");
const inspector = join(
  repo,
  "node_modules",
  "@modelcontextprotocol",
  "inspector",
  "clients",
  "launcher",
  "build",
  "index.js",
);
if (!existsSync(server)) {
  console.error("Build first: npm run mcp:build");
  process.exit(1);
}

const shared = join(repo, "tests", "corpus", "out", "mcp-inspect", "Shared");
rmSync(dirname(shared), { recursive: true, force: true });
const jd = join(shared, "Clients", "JD");
mkdirSync(jd, { recursive: true });
for (const f of [
  "text-1p.pdf",
  "workpaper-a.pdf",
  "workpaper-b.pdf",
  "navigation.pdf",
  "ssn-redaction.pdf",
  "scanned-image-only.pdf",
]) {
  copyFileSync(join(repo, "tests", "corpus", "generated", f), join(jd, f));
}
const f = (n) => join(jd, n);

// open_in_app is left out: it would start PDF Workbench (covered by the Vitest suite).
const CALLS = [
  ["list_pdfs", {}],
  ["get_info", { path: f("text-1p.pdf") }],
  ["merge", { paths: [f("workpaper-a.pdf"), f("workpaper-b.pdf")], task: "JD merge" }],
  ["split", { path: f("navigation.pdf"), mode: "every_n_pages", n: 4 }],
  ["rotate", { path: f("navigation.pdf"), degrees: 90, pages: "1" }],
  ["reorder", { path: f("navigation.pdf"), order: "8-1" }],
  ["extract_pages", { path: f("navigation.pdf"), pages: "2-3" }],
  ["insert_pages", { path: f("navigation.pdf"), from_path: f("text-1p.pdf"), before_page: 1 }],
  ["add_bookmarks", { path: f("text-1p.pdf"), bookmarks: [{ title: "W-2", page: 1 }] }],
  ["ocr", { path: f("scanned-image-only.pdf") }],
  ["optimize", { path: f("scanned-image-only.pdf"), preset: "email" }],
  ["add_bates", { path: f("navigation.pdf"), prefix: "JD-" }],
  ["add_header_footer", { path: f("text-1p.pdf"), footer_center: "Page {page} of {pages}" }],
  ["add_watermark", { path: f("text-1p.pdf"), text: "DRAFT" }],
  ["redact_patterns", { path: f("ssn-redaction.pdf") }],
];

function inspect(args) {
  return execFileSync(
    process.execPath,
    [inspector, "--cli", process.execPath, server, shared, ...args, "--format", "json"],
    { encoding: "utf8", windowsHide: true, timeout: 300_000 },
  );
}

const listed = JSON.parse(inspect(["--method", "tools/list"]));
const names = (listed.result?.tools ?? listed.tools ?? []).map((t) => t.name);
console.log(`tools/list: ${names.length} tools: ${names.join(", ")}`);
let failed = 0;
for (const [tool, args] of CALLS) {
  try {
    const out = JSON.parse(
      inspect([
        "--method",
        "tools/call",
        "--tool-name",
        tool,
        "--tool-args-json",
        JSON.stringify(args),
      ]),
    );
    const res = out.result ?? out;
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "tool error");
    if (JSON.stringify(res).includes("000-12-3456")) throw new Error("returned document data");
    const o = res.structuredContent ?? {};
    const what =
      o.output?.path ?? (o.outputs ? `${o.outputs.length} files` : (o.count ?? o.pages ?? "ok"));
    console.log(`PASS ${tool.padEnd(18)} ${String(what).replace(shared, "<Shared>")}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${tool.padEnd(18)} ${(e.stderr || e.message || String(e)).split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} tool(s) failed` : `\nAll ${CALLS.length} Tier A calls passed.`);
console.log(`Results: ${join(shared, "Outputs")}`);
process.exit(failed ? 1 : 0);
