// Tier B: tools that return document content to Claude. Registered ONLY when the firm's
// machine policy turns them on (see config.ts); with the policy off they do not exist.
// Every result starts with a header naming the file and pages, and the audit log marks
// the call tier "B". Text extraction goes through pageText (the getPageGlyphs guard).
import type { McpServer } from "@modelcontextprotocol/server";
import type { PdfAnnotationObject } from "@embedpdf/models";
import * as z from "zod/v4";
import { pageImage } from "../../../src/engine/convert";
import { readFields } from "../../../src/engine/forms/fields";
import { formatRanges } from "../../../src/engine/pages/ranges";
import { withEngineDoc } from "../../../src/engine/pages/outline-io";
import { pageText } from "../../../src/engine/text";
import { runTool, ToolError, type Call, type ServerDeps, type ToolContent } from "../server";
import { pageList, path, pdfFacts, READ_ONLY } from "./common";

export const TIER_B_TOOLS = [
  "read_text",
  "read_form_values",
  "list_annotations",
  "render_page_image",
] as const;

const ASK_FIRST =
  "STOP AND ASK FIRST: this returns client document content to Claude. Before calling it, tell the user which file and pages you want to read and wait for a clear yes. Prefer the Tier A tools (get_info, redact_patterns) when they are enough. In replies, refer to the client by initials or file number and never repeat SSNs, EINs or account numbers.";

const MAX_PAGES = 20;

function header(file: string, pages: string, what: string): ToolContent {
  return {
    type: "text",
    text: `[Tier B content sent to Claude] File: ${file} | Pages: ${pages} | ${what}. Do not repeat SSNs, EINs or account numbers from it.`,
  };
}

async function open(call: Call, p: string) {
  const src = await call.pdf(p);
  const bytes = await call.read(src);
  const facts = pdfFacts(call.deps.rt.module, bytes);
  if (facts.needs_password) throw new ToolError("This PDF is password-protected.");
  return { src, bytes, pageCount: facts.pages ?? 0 };
}

function limit(list: number[]): number[] {
  if (list.length > MAX_PAGES) {
    throw new ToolError(`ask for at most ${MAX_PAGES} pages per call`);
  }
  return list;
}

const tierBPages = z
  .string()
  .max(200)
  .describe(`1-based page range, at most ${MAX_PAGES} pages, e.g. "1-3".`);

export function registerContentTools(server: McpServer, deps: ServerDeps): void {
  const { rt } = deps;

  server.registerTool(
    "read_text",
    {
      title: "Read page text (Tier B)",
      description: `Returns the text of some pages. ${ASK_FIRST}`,
      inputSchema: z.object({ path, pages: tierBPages }),
      annotations: READ_ONLY,
    },
    runTool(deps, "read_text", "B", async (args, call) => {
      const { src, bytes, pageCount } = await open(call, args.path);
      const list = limit(pageList(call, args.pages, pageCount));
      const texts = await withEngineDoc(rt.engine, bytes, async (doc) => {
        const out: string[] = [];
        for (const i of list) out.push(await pageText(rt.engine, doc, i));
        return out;
      });
      const range = formatRanges(list);
      return {
        facts: { path: src.path, pages: range },
        content: [
          header(src.path, range, "page text"),
          ...list.map((p, k) => ({
            type: "text" as const,
            text: `--- Page ${p + 1} ---\n${texts[k] || "(no text on this page; it may need OCR)"}`,
          })),
        ],
      };
    }),
  );

  server.registerTool(
    "read_form_values",
    {
      title: "Read form values (Tier B)",
      description: `Returns the name, type and value of every form field. ${ASK_FIRST}`,
      inputSchema: z.object({ path }),
      annotations: READ_ONLY,
    },
    runTool(deps, "read_form_values", "B", async (args, call) => {
      const { src, bytes } = await open(call, args.path);
      call.pages = "all";
      const fields = await withEngineDoc(rt.engine, bytes, (doc) => readFields(rt.engine, doc));
      const rows = fields.map((f) => ({
        name: f.name,
        kind: f.kind,
        value: f.value,
        pages: [...new Set(f.widgets.map((w) => w.pageIndex + 1))],
      }));
      return {
        facts: { path: src.path, pages: "all", fields: rows.length },
        content: [
          header(src.path, "all", "form field values"),
          { type: "text", text: JSON.stringify(rows, null, 2) },
        ],
      };
    }),
  );

  server.registerTool(
    "list_annotations",
    {
      title: "List comments and markups (Tier B)",
      description: `Returns the comments, stamps and markups on some pages, with their text. ${ASK_FIRST}`,
      inputSchema: z.object({ path, pages: tierBPages.optional() }),
      annotations: READ_ONLY,
    },
    runTool(deps, "list_annotations", "B", async (args, call) => {
      const { src, bytes, pageCount } = await open(call, args.path);
      const list = pageList(call, args.pages, pageCount);
      const rows = await withEngineDoc(rt.engine, bytes, async (doc) => {
        const out: Record<string, unknown>[] = [];
        for (const i of list) {
          const page = doc.pages[i];
          if (!page) continue;
          const annots = (await rt.engine
            .getPageAnnotations(doc, page)
            .toPromise()) as PdfAnnotationObject[];
          for (const a of annots) {
            const x = a as PdfAnnotationObject & { contents?: string; author?: string };
            out.push({
              page: i + 1,
              type: a.type,
              ...(x.author ? { author: x.author } : {}),
              ...(x.contents ? { text: x.contents } : {}),
            });
          }
        }
        return out;
      });
      const range = formatRanges(list);
      return {
        facts: { path: src.path, pages: range, annotations: rows.length },
        content: [
          header(src.path, range, "comments and markups"),
          { type: "text", text: JSON.stringify(rows, null, 2) },
        ],
      };
    }),
  );

  server.registerTool(
    "render_page_image",
    {
      title: "Page picture (Tier B)",
      description: `Returns a PNG picture of one page. ${ASK_FIRST}`,
      inputSchema: z.object({
        path,
        page: z.number().int().min(1),
        dpi: z.number().int().min(36).max(200).optional().describe("Resolution (default 100)."),
      }),
      annotations: READ_ONLY,
    },
    runTool(deps, "render_page_image", "B", async (args, call) => {
      const { src, bytes, pageCount } = await open(call, args.path);
      if (args.page > pageCount) throw new ToolError(`page must be 1-${pageCount}`);
      call.pages = String(args.page);
      const png = pageImage(rt.module, bytes, args.page - 1, args.dpi ?? 100, "png");
      return {
        facts: { path: src.path, pages: String(args.page) },
        content: [
          header(src.path, String(args.page), "page picture"),
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
        ],
      };
    }),
  );
}
