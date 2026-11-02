// The MCP server: tool registration plus the wrapper every tool call goes through.
//
// The wrapper (1) runs one call at a time (PDFium is single-threaded), (2) appends the
// audit entry whether the call worked or not, and (3) turns errors into tool errors
// whose text never quotes document data. Tier B tools are registered only when the
// firm's policy allows them, so with the policy off they do not exist at all.
import { McpServer } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { QpdfError } from "../../src/engine/pages/qpdf";
import { RangeSyntaxError } from "../../src/engine/pages/ranges";
import { OcrError } from "../../src/engine/ocr/tesseract";
import { RedactionLeakError } from "../../src/engine/redact";
import type { Runtime } from "./runtime";
import { windowsUser, writeAudit, type AuditEntry } from "./safety/audit";
import { PathRefused, type Resolved, type Root, type Roots } from "./safety/roots";
import { Job, safeTask } from "./safety/writer";
import { registerContentTools } from "./tools/content";
import { registerDecorateTools } from "./tools/decorate";
import { registerFileTools } from "./tools/files";
import { registerPageTools } from "./tools/pages";

export const SERVER_NAME = "pdf-workbench";
export const SERVER_VERSION = "0.1.0";

export interface ServerDeps {
  roots: Roots;
  rt: Runtime;
  /** Firm policy: Tier B (document content to Claude) tools exist. */
  allowContent: boolean;
  /** Opens a file in PDF Workbench (open_in_app). */
  openInApp: (file: string, page: number) => Promise<void>;
}

export const INSTRUCTIONS = `PDF Workbench tools for a CPA firm's PDFs. Rules:
- Refer to clients only by initials or file number. Never write an SSN, ITIN, EIN or account number in your messages, tool arguments, task names or output names.
- Only the folders configured in this extension can be used. Original files are never changed: every change works on a copy in <folder>\\_workspace\\<date>_<task>\\ and the finished file goes to <folder>\\Outputs\\.
- Tools return file facts (page counts, paths, counts per page), not document text.
- No tool sends, emails, uploads or shares anything.
- Page numbers are 1-based. Page ranges look like "1-3, 5, 8-z" (z = last page).
- Every call is recorded in the firm's audit log.`;

/** An error whose message is safe to show Claude (no document data). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

const SAFE_MESSAGES = [ToolError, PathRefused, QpdfError, OcrError, RangeSyntaxError];

export function errorText(e: unknown): string {
  if (e instanceof RedactionLeakError) {
    return "Redaction could not be verified (some matched text was still readable), so no file was written. Redact this file in PDF Workbench instead.";
  }
  if (SAFE_MESSAGES.some((c) => e instanceof c)) return (e as Error).message;
  const name = e instanceof Error ? e.name : "Error";
  return `The operation failed (${name}). Try it in PDF Workbench, or check the file.`;
}

/** What one tool call touched, for the audit log, plus helpers that record as they go. */
export class Call {
  files: string[] = [];
  outputs: string[] = [];
  pages: string | undefined;
  root: Root | null = null;

  constructor(
    readonly deps: ServerDeps,
    readonly tool: string,
  ) {}

  /** A PDF inside a configured folder; recorded for the audit log. */
  async pdf(path: string): Promise<Resolved> {
    this.files.push(path);
    const r = await this.deps.roots.resolvePdf(path);
    this.files[this.files.length - 1] = r.path;
    this.root ??= r.root;
    return r;
  }

  /** A folder inside a configured folder. */
  async folder(path: string): Promise<Resolved> {
    this.files.push(path);
    const r = await this.deps.roots.resolve(path);
    this.root ??= r.root;
    return r;
  }

  /** Bytes of an original, read once (never written). */
  read(r: Resolved): Promise<Uint8Array> {
    return readFile(r.path).then((b) => new Uint8Array(b));
  }

  async job(root: Root, task: string | undefined): Promise<Job> {
    return Job.start(root, safeTask(task, this.tool));
  }

  async publish(job: Job, name: string, bytes: Uint8Array): Promise<string> {
    const p = await job.publish(name, bytes);
    this.outputs.push(p);
    return p;
  }
}

type Tier = "A" | "B";
export type ToolContent =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** A tool's answer: Tier A returns facts only; Tier B may add content items. */
export interface ToolAnswer {
  facts: Record<string, unknown>;
  content?: ToolContent[];
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function runTool<A>(
  deps: ServerDeps,
  tool: string,
  tier: Tier,
  handler: (args: A, call: Call) => Promise<ToolAnswer>,
) {
  return (args: A) =>
    serial(async () => {
      const call = new Call(deps, tool);
      let answer: ToolAnswer | null = null;
      let failure: unknown = null;
      try {
        answer = await handler(args, call);
      } catch (e) {
        failure = e;
      }
      const entry: AuditEntry = {
        time: new Date().toISOString(),
        user: windowsUser(),
        tool,
        tier,
        files: call.files,
        ...(call.pages ? { pages: call.pages } : {}),
        ...(call.outputs.length ? { outputs: call.outputs } : {}),
        result: failure ? "error" : "ok",
        ...(failure ? { error: failure instanceof Error ? failure.name : "Error" } : {}),
      };
      try {
        await writeAudit(call.root ?? (deps.roots.list[0] as Root), entry);
      } catch {
        return errorResult("The audit log could not be written, so the call was refused.");
      }
      if (failure || !answer) return errorResult(errorText(failure));
      const text = JSON.stringify(answer.facts, null, 2);
      return {
        content: [...(answer.content ?? []), { type: "text" as const, text }],
        structuredContent: answer.facts,
      };
    });
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  registerFileTools(server, deps);
  registerPageTools(server, deps);
  registerDecorateTools(server, deps);
  if (deps.allowContent) registerContentTools(server, deps);
  return server;
}
