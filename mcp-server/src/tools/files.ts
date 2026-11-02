// Tier A: list_pdfs, get_info, open_in_app. Metadata only.
import type { McpServer } from "@modelcontextprotocol/server";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/v4";
import { runTool, ToolError, type ServerDeps } from "../server";
import { WORKSPACE } from "../safety/writer";
import { path, pdfFacts, READ_ONLY } from "./common";

const MAX_LIST = 1000;
const MAX_DEPTH = 12;

interface Listed {
  path: string;
  size_bytes: number;
  modified: string;
}

async function walk(
  dir: string,
  depth: number,
  opts: { recursive: boolean; workspace: boolean },
  out: Listed[],
): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return true; // unreadable folder: skip it
  }
  for (const e of entries) {
    if (out.length >= MAX_LIST) return false;
    // Links and junctions are never followed: they could lead out of the folder.
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!opts.recursive || depth >= MAX_DEPTH) continue;
      if (depth === 0 && e.name.toLowerCase() === WORKSPACE.toLowerCase() && !opts.workspace)
        continue;
      if (!(await walk(p, depth + 1, opts, out))) return false;
    } else if (e.isFile() && /\.pdf$/i.test(e.name)) {
      try {
        const s = await stat(p);
        out.push({ path: p, size_bytes: s.size, modified: s.mtime.toISOString() });
      } catch {
        // locked or vanished: leave it out
      }
    }
  }
  return true;
}

export function registerFileTools(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "list_pdfs",
    {
      title: "List PDFs",
      description:
        "Lists PDF files (path, size, date) in the folders this extension may use. Returns file names only, never contents. Refer to clients by initials or file number in your replies.",
      inputSchema: z.object({
        folder: z
          .string()
          .optional()
          .describe(
            "A configured folder or a folder inside one. All configured folders when left out.",
          ),
        recursive: z.boolean().optional().describe("Include subfolders (default true)."),
        include_workspace: z
          .boolean()
          .optional()
          .describe("Also list working copies in _workspace (default false)."),
      }),
      annotations: READ_ONLY,
    },
    runTool(deps, "list_pdfs", "A", async (args, call) => {
      const dirs = args.folder
        ? [(await call.folder(args.folder)).path]
        : deps.roots.list.map((r) => r.path);
      const out: Listed[] = [];
      let complete = true;
      for (const d of dirs) {
        if (!(await stat(d)).isDirectory()) throw new ToolError("not a folder");
        complete &&= await walk(
          d,
          0,
          { recursive: args.recursive !== false, workspace: args.include_workspace === true },
          out,
        );
      }
      return {
        facts: {
          folders: dirs,
          count: out.length,
          ...(complete ? {} : { truncated: `only the first ${MAX_LIST} files are listed` }),
          files: out,
        },
      };
    }),
  );

  server.registerTool(
    "get_info",
    {
      title: "PDF info",
      description:
        "Facts about one PDF: page count, file size, whether it has text (or needs OCR), form fields, a password, or digital signatures. Never returns document text.",
      inputSchema: z.object({ path }),
      annotations: READ_ONLY,
    },
    runTool(deps, "get_info", "A", async (args, call) => {
      const src = await call.pdf(args.path);
      const facts = pdfFacts(deps.rt.module, await call.read(src));
      return { facts: { path: src.path, ...facts } };
    }),
  );

  server.registerTool(
    "open_in_app",
    {
      title: "Open in PDF Workbench",
      description:
        "Opens a PDF in PDF Workbench on this computer, at a page, so a person can look at it or finish the work by hand. Use it for anything that needs a human's eyes (reviewing redactions, signing, reading).",
      inputSchema: z.object({
        path,
        page: z.number().int().min(1).optional().describe("1-based page to show (default 1)."),
      }),
      annotations: { ...READ_ONLY, idempotentHint: true },
    },
    runTool(deps, "open_in_app", "A", async (args, call) => {
      const src = await call.pdf(args.path);
      const facts = pdfFacts(deps.rt.module, await call.read(src));
      const n = facts.pages ?? 1;
      const page = Math.min(Math.max(1, args.page ?? 1), Math.max(1, n));
      call.pages = String(page);
      await deps.openInApp(src.path, page);
      return { facts: { opened: src.path, page } };
    }),
  );
}
