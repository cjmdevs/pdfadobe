// Phase 9: no tool makes a network request. Every way Node can reach the network is
// replaced by a trap that records the attempt and throws; then every tool runs (Tier B
// too, with the policy on). Any recorded attempt fails the test.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIER_B_TOOLS } from "../../mcp-server/src/tools/content";
import { connect, makeSandbox, type Harness, type Sandbox } from "../helpers/mcp";

const attempts: string[] = [];
const restore: (() => void)[] = [];

function trap(obj: object, key: string, label: string) {
  const o = obj as Record<string, unknown>;
  const orig = o[key];
  o[key] = (...args: unknown[]) => {
    attempts.push(`${label}(${JSON.stringify(args[0] ?? "").slice(0, 80)})`);
    throw new Error(`network blocked: ${label}`);
  };
  restore.push(() => (o[key] = orig));
}

function blockNetwork() {
  trap(net.Socket.prototype, "connect", "net.Socket.connect");
  trap(net, "connect", "net.connect");
  trap(net, "createConnection", "net.createConnection");
  trap(tls, "connect", "tls.connect");
  for (const k of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"])
    trap(dns, k, `dns.${k}`);
  for (const k of ["lookup", "resolve", "resolve4", "resolve6"])
    trap(dns.promises, k, `dns.promises.${k}`);
  for (const k of ["request", "get"]) {
    trap(http, k, `http.${k}`);
    trap(https, k, `https.${k}`);
  }
  trap(http2, "connect", "http2.connect");
  trap(dgram, "createSocket", "dgram.createSocket");
  trap(globalThis, "fetch", "fetch");
  if ("WebSocket" in globalThis) trap(globalThis, "WebSocket", "WebSocket");
  syncBuiltinESMExports();
}

let sb: Sandbox;
let h: Harness;

beforeAll(async () => {
  blockNetwork();
  sb = makeSandbox();
  h = await connect([sb.shared], { allowContent: true });
});

afterAll(async () => {
  await h.close();
  for (const r of restore.reverse()) r();
  syncBuiltinESMExports();
});

describe("no outbound network", () => {
  it("the trap works", () => {
    expect(() => fetch("https://example.invalid/")).toThrow(/network blocked/);
    expect(() => net.connect(443, "example.invalid")).toThrow(/network blocked/);
    attempts.length = 0;
  });

  it("every tool runs without a single network attempt", async () => {
    const f = sb.file;
    const calls: [string, Record<string, unknown>][] = [
      ["list_pdfs", {}],
      ["get_info", { path: f("text-1p.pdf") }],
      ["merge", { paths: [f("workpaper-a.pdf"), f("workpaper-b.pdf")] }],
      ["split", { path: f("navigation.pdf"), mode: "every_n_pages", n: 4 }],
      ["rotate", { path: f("text-1p.pdf"), degrees: 180 }],
      ["reorder", { path: f("navigation.pdf"), order: "8-1" }],
      ["extract_pages", { path: f("navigation.pdf"), pages: "1" }],
      ["insert_pages", { path: f("navigation.pdf"), from_path: f("text-1p.pdf") }],
      ["add_bookmarks", { path: f("text-1p.pdf"), bookmarks: [{ title: "W-2", page: 1 }] }],
      ["ocr", { path: f("scanned-image-only.pdf") }],
      ["optimize", { path: f("text-1p.pdf"), preset: "email" }],
      ["add_bates", { path: f("text-1p.pdf"), prefix: "JD-" }],
      ["add_header_footer", { path: f("text-1p.pdf"), footer_right: "{page}" }],
      ["add_watermark", { path: f("text-1p.pdf"), text: "DRAFT" }],
      ["redact_patterns", { path: f("ssn-redaction.pdf") }],
      ["open_in_app", { path: f("text-1p.pdf") }],
      ["read_text", { path: f("text-1p.pdf"), pages: "1" }],
      ["read_form_values", { path: f("acroform.pdf") }],
      ["list_annotations", { path: f("ssn-redaction.pdf") }],
      ["render_page_image", { path: f("text-1p.pdf"), page: 1 }],
    ];
    const tools = (await h.client.listTools()).tools.map((t) => t.name).sort();
    expect(calls.map((c) => c[0]).sort()).toEqual(tools);
    expect(tools).toEqual(expect.arrayContaining([...TIER_B_TOOLS]));
    for (const [name, args] of calls) {
      const r = await h.call(name, args);
      expect(r.isError, name).toBeFalsy();
    }
    expect(attempts).toEqual([]);
  }, 300_000);
});
