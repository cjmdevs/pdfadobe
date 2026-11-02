// MCP server test harness: a sandbox folder with synthetic PDFs, and an in-memory MCP
// client wired to a server built exactly as main.ts builds it (except the launcher,
// which only records what it would open, and the policy flag, which tests set).
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntime, repoPaths, type Runtime } from "../../mcp-server/src/runtime";
import { Roots } from "../../mcp-server/src/safety/roots";
import { createServer, type ServerDeps } from "../../mcp-server/src/server";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORPUS = join(REPO, "tests", "corpus", "generated");

export const SAMPLE_FILES = [
  "text-1p.pdf",
  "workpaper-a.pdf",
  "workpaper-b.pdf",
  "navigation.pdf",
  "acroform.pdf",
  "ssn-redaction.pdf",
  "scanned-image-only.pdf",
  "encrypted.pdf",
];

export interface Sandbox {
  /** Temp folder holding everything. */
  base: string;
  /** The configured ("shared") folder. */
  shared: string;
  /** A sibling folder that is NOT configured. */
  outside: string;
  /** Path of a sample inside `shared\Clients\JD\`. */
  file(name: string): string;
}

export function makeSandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), "pdfwb-mcp-"));
  const shared = join(base, "Shared");
  const outside = join(base, "Outside");
  const clients = join(shared, "Clients", "JD");
  mkdirSync(clients, { recursive: true });
  mkdirSync(outside, { recursive: true });
  for (const f of SAMPLE_FILES) copyFileSync(join(CORPUS, f), join(clients, f));
  copyFileSync(join(CORPUS, "text-1p.pdf"), join(outside, "secret.pdf"));
  return { base, shared, outside, file: (n) => join(clients, n) };
}

let runtime: Promise<Runtime> | null = null;
export function sharedRuntime(): Promise<Runtime> {
  return (runtime ??= loadRuntime(repoPaths(REPO)));
}

export interface Harness {
  client: Client;
  opened: { file: string; page: number }[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
  structuredContent?: Record<string, unknown>;
}

export async function connect(
  folders: string[],
  opts: { allowContent?: boolean } = {},
): Promise<Harness> {
  const opened: { file: string; page: number }[] = [];
  const deps: ServerDeps = {
    roots: await Roots.create(folders),
    rt: await sharedRuntime(),
    allowContent: opts.allowContent === true,
    openInApp: async (file, page) => {
      opened.push({ file, page });
    },
  };
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createServer(deps);
  await server.connect(serverT);
  const client = new Client({ name: "pdfwb-test", version: "1.0.0" });
  await client.connect(clientT);
  return {
    client,
    opened,
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as unknown as ToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(r: ToolResult): string {
  return r.content.map((c) => c.text ?? "").join("\n");
}

/** Every file under `dir` -> size and mtime, keyed by relative path (for before/after checks). */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) out.set(relative(dir, p), "link");
      else if (e.isDirectory()) {
        out.set(relative(dir, p) + "\\", "dir");
        walk(p);
      } else {
        const s = statSync(p);
        out.set(
          relative(dir, p),
          `${s.size}:${s.mtimeMs}:${readFileSync(p).subarray(0, 64).toString("hex")}`,
        );
      }
    }
  };
  walk(dir);
  return out;
}

/** Audit lines written in a configured folder. */
export function auditLines(shared: string): Record<string, unknown>[] {
  const dir = join(shared, "_workspace", "_audit");
  const out: Record<string, unknown>[] = [];
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (line.trim()) out.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return out;
}
