// Phase 9: the BUILT bundle (what the .mcpb ships) over stdio, in a plain Node process
// whose network APIs are trapped (tests/helpers/block-net.mjs exits 99 on any attempt).
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBundle } from "../../mcp-server/build.mjs";
import { makeSandbox, REPO, type Sandbox } from "../helpers/mcp";

let sb: Sandbox;
let client: Client;
let stderr = "";

beforeAll(async () => {
  const out = await buildBundle(join(REPO, "tests", "corpus", "out", "mcp-bundle"));
  sb = makeSandbox();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      new URL("../helpers/block-net.mjs", import.meta.url).href,
      join(out, "server", "server.mjs"),
      "--app=",
      sb.shared,
    ],
    stderr: "pipe",
  });
  transport.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  client = new Client({ name: "pdfwb-stdio-test", version: "1.0.0" });
  await client.connect(transport);
}, 180_000);

afterAll(async () => {
  await client?.close();
});

describe("bundled server over stdio", () => {
  it("serves the Tier A tools (Tier B off: no machine policy in tests)", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("redact_patterns");
    expect(names).not.toContain("read_text");
  });

  it("runs page, OCR and redaction tools with the network trapped", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["get_info", { path: sb.file("text-1p.pdf") }],
      ["merge", { paths: [sb.file("workpaper-a.pdf"), sb.file("workpaper-b.pdf")] }],
      ["ocr", { path: sb.file("scanned-image-only.pdf") }],
      ["optimize", { path: sb.file("text-1p.pdf") }],
      ["redact_patterns", { path: sb.file("ssn-redaction.pdf") }],
    ];
    for (const [name, args] of calls) {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean };
      expect(r.isError, name).toBeFalsy();
    }
    expect(stderr).not.toContain("NETWORK-ATTEMPT");
  }, 300_000);
});
