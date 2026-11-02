// Tier A page tools: merge, split, rotate, reorder, extract_pages, insert_pages,
// add_bookmarks. All of them call the app's own engine (src/engine/pages).
import type { McpServer } from "@modelcontextprotocol/server";
import { basename } from "node:path";
import * as z from "zod/v4";
import {
  bookmark,
  combine,
  extractPages,
  insertPages,
  partsByBookmarks,
  partsByCount,
  readOutline,
  reorderPages,
  rotatePages,
  splitParts,
  writeOutline,
  type Outline,
  type QuarterTurns,
  type SplitPart,
} from "../../../src/engine/pages";
import { runTool, ToolError, type ServerDeps } from "../server";
import { safeName } from "../safety/writer";
import {
  assertEditable,
  changeCopy,
  CREATES_FILES,
  derivedName,
  outputName,
  pageCount,
  pageList,
  pages,
  path,
  task,
} from "./common";

const SAFE_NOTE =
  " The original is not changed: a copy is worked on in _workspace and the result is saved in Outputs.";

interface BookmarkInput {
  title: string;
  page: number;
  children?: BookmarkInput[] | undefined;
}

const bookmarkSchema: z.ZodType<BookmarkInput> = z.lazy(() =>
  z.object({
    title: z.string().min(1).max(200),
    page: z.number().int().min(1),
    children: z.array(bookmarkSchema).max(200).optional(),
  }),
);

function toOutline(list: BookmarkInput[], n: number, depth = 0): Outline {
  if (depth > 4) throw new ToolError("bookmarks may nest at most 5 levels");
  return list.map((b) => {
    if (b.page > n) throw new ToolError(`bookmark page ${b.page} is outside 1-${n}`);
    return bookmark(b.title, b.page - 1, toOutline(b.children ?? [], n, depth + 1));
  });
}

export function registerPageTools(server: McpServer, deps: ServerDeps): void {
  const { rt } = deps;

  server.registerTool(
    "merge",
    {
      title: "Merge PDFs",
      description:
        "Combines PDFs into one new PDF, in the order given. Form fields, comments and bookmarks are kept." +
        SAFE_NOTE,
      inputSchema: z.object({
        paths: z.array(path).min(2).max(100).describe("PDFs to combine, in order."),
        bookmark_per_file: z
          .boolean()
          .optional()
          .describe("Add one bookmark per file, named after the file (default false)."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "merge", "A", async (args, call) => {
      const srcs = [];
      for (const p of args.paths) srcs.push(await call.pdf(p));
      const first = srcs[0];
      if (!first) throw new ToolError("give at least two PDFs");
      const job = await call.job(first.root, args.task);
      const sources = [];
      for (const s of srcs) {
        const copy = await job.copyIn(s);
        const bytes = await call.read({ path: copy, root: first.root });
        assertEditable(rt.module, bytes);
        sources.push({ name: basename(s.path), bytes });
      }
      const ctx = { engine: rt.engine, module: rt.module, qpdf: rt.qpdf(job.dir) };
      const out = await combine(ctx, sources, { bookmarkPerFile: args.bookmark_per_file === true });
      const p = await call.publish(job, args.output_name ?? derivedName(first.path, "Merged"), out);
      return {
        facts: {
          output: { path: p, pages: pageCount(rt.module, out), size_bytes: out.byteLength },
        },
      };
    }),
  );

  server.registerTool(
    "split",
    {
      title: "Split PDF",
      description:
        "Splits one PDF into several new PDFs: every N pages, at each top-level bookmark, or by page ranges." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        mode: z.enum(["every_n_pages", "top_level_bookmarks", "ranges"]),
        n: z.number().int().min(1).optional().describe("Pages per file (mode every_n_pages)."),
        ranges: z
          .array(z.string().max(500))
          .max(200)
          .optional()
          .describe('One page range per new file (mode ranges), e.g. ["1-2", "3-z"].'),
        task,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "split", "A", async (args, call) => {
      const src = await call.pdf(args.path);
      const job = await call.job(src.root, args.task);
      const bytes = await call.read({ path: await job.copyIn(src), root: src.root });
      const n = assertEditable(rt.module, bytes).pages ?? 0;
      const ctx = { engine: rt.engine, module: rt.module, qpdf: rt.qpdf(job.dir) };
      let parts: SplitPart[];
      if (args.mode === "every_n_pages") {
        if (!args.n) throw new ToolError("give n (pages per file)");
        parts = partsByCount(n, args.n);
      } else if (args.mode === "top_level_bookmarks") {
        parts = partsByBookmarks(await readOutline(rt.engine, bytes), n);
      } else {
        if (!args.ranges?.length) throw new ToolError("give ranges (one per new file)");
        parts = args.ranges.map((r, i) => ({
          label: `Part ${i + 1}`,
          pages: pageList(call, r, n),
        }));
      }
      if (parts.length > 200) throw new ToolError("that would make more than 200 files");
      const outputs = [];
      for (const [i, part] of (await splitParts(ctx, bytes, parts)).entries()) {
        const label = safeName(part.label, `Part ${i + 1}`);
        const p = await call.publish(job, derivedName(src.path, label), part.bytes);
        outputs.push({ path: p, pages: part.pages.length, size_bytes: part.bytes.byteLength });
      }
      return { facts: { outputs } };
    }),
  );

  server.registerTool(
    "rotate",
    {
      title: "Rotate pages",
      description: "Turns pages clockwise by 90, 180 or 270 degrees." + SAFE_NOTE,
      inputSchema: z.object({
        path,
        degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
        pages,
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "rotate", "A", async (args, call) => {
      const r = await changeCopy(call, args, "Rotated", async (c) =>
        rotatePages(
          rt.module,
          c.bytes,
          pageList(call, args.pages, c.pageCount),
          (args.degrees / 90) as QuarterTurns,
        ),
      );
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );

  server.registerTool(
    "reorder",
    {
      title: "Reorder pages",
      description:
        'Puts the pages in a new order. Give every page exactly once, e.g. "3, 1-2, 4-z".' +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        order: z.string().min(1).max(2000).describe("New order as a 1-based page range list."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "reorder", "A", async (args, call) => {
      const r = await changeCopy(call, args, "Reordered", async (c) => {
        const order = pageList(call, args.order, c.pageCount);
        const seen = new Set(order);
        if (order.length !== c.pageCount || seen.size !== c.pageCount) {
          throw new ToolError(`the order must name each of the ${c.pageCount} pages exactly once`);
        }
        return reorderPages(c.ctx, c.bytes, order);
      });
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );

  server.registerTool(
    "extract_pages",
    {
      title: "Extract pages",
      description:
        "Copies some pages into a new PDF (bookmarks to those pages come along)." + SAFE_NOTE,
      inputSchema: z.object({
        path,
        pages: z.string().min(1).max(500).describe('1-based page range, e.g. "2-4, 7".'),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "extract_pages", "A", async (args, call) => {
      const r = await changeCopy(call, args, "Extract", async (c) =>
        extractPages(c.ctx, c.bytes, pageList(call, args.pages, c.pageCount)),
      );
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );

  server.registerTool(
    "insert_pages",
    {
      title: "Insert pages",
      description:
        "Inserts pages from another PDF before a page of this one (or at the end)." + SAFE_NOTE,
      inputSchema: z.object({
        path,
        from_path: path.describe("The PDF the pages come from."),
        from_pages: pages.describe("Pages of from_path to insert (all when left out)."),
        before_page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Insert before this 1-based page; page count + 1 or left out = at the end."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "insert_pages", "A", async (args, call) => {
      const from = await call.pdf(args.from_path);
      const r = await changeCopy(call, args, "Inserted", async (c) => {
        const other = await call.read({ path: await c.job.copyIn(from), root: from.root });
        const otherCount = assertEditable(rt.module, other).pages ?? 0;
        const at = (args.before_page ?? c.pageCount + 1) - 1;
        if (at > c.pageCount) throw new ToolError(`before_page must be 1-${c.pageCount + 1}`);
        return insertPages(c.ctx, c.bytes, other, pageList(call, args.from_pages, otherCount), at);
      });
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );

  server.registerTool(
    "add_bookmarks",
    {
      title: "Add bookmarks",
      description:
        "Adds bookmarks (with optional nested children) pointing at pages. Titles should name document types (e.g. 'W-2', 'K-1 Partnership'), never SSNs/EINs/account numbers." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        bookmarks: z.array(bookmarkSchema).min(1).max(500),
        replace_existing: z
          .boolean()
          .optional()
          .describe("Replace all existing bookmarks instead of adding after them (default false)."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "add_bookmarks", "A", async (args, call) => {
      const r = await changeCopy(call, args, "Bookmarked", async (c) => {
        const added = toOutline(args.bookmarks, c.pageCount);
        const old = args.replace_existing ? [] : await readOutline(rt.engine, c.bytes);
        return writeOutline(rt.engine, c.bytes, [...old, ...added]);
      });
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );
}
