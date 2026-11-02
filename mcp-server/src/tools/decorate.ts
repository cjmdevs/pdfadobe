// Tier A document tools: ocr, optimize, add_bates, add_header_footer, add_watermark,
// redact_patterns. Results are facts and counts; matched text never leaves the server.
import type { McpServer } from "@modelcontextprotocol/server";
import { basename } from "node:path";
import * as z from "zod/v4";
import {
  addHeaderFooter,
  addWatermark,
  type DateFormat,
  type FontName,
  type HeaderFooterSpec,
  type TextStyle,
} from "../../../src/engine/decorate";
import { OcrControl, ocrDocument } from "../../../src/engine/ocr";
import { optimizeDocument } from "../../../src/engine/optimize";
import { pageWidgets } from "../../../src/engine/forms/fields";
import { withEngineDoc } from "../../../src/engine/pages/outline-io";
import {
  findMatches,
  redactDocument,
  searchDocument,
  type PageRedaction,
  type PatternId,
} from "../../../src/engine/redact";
import type { Runtime } from "../runtime";
import { runTool, ToolError, type ServerDeps } from "../server";
import {
  changeCopy,
  CREATES_FILES,
  outputName,
  pageList,
  pages,
  path,
  pdfFacts,
  task,
} from "./common";

const SAFE_NOTE =
  " The original is not changed: a copy is worked on in _workspace and the result is saved in Outputs.";

const font = z
  .enum(["Helvetica", "Helvetica Bold", "Times Roman", "Times Bold", "Courier", "Courier Bold"])
  .optional()
  .describe("Standard PDF font (default Helvetica).");
const size = z.number().min(4).max(144).optional().describe("Font size in points.");
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional()
  .describe('Colour as "#rrggbb" (default black).');

function style(
  a: { font?: FontName | undefined; size?: number | undefined; color?: string | undefined },
  dflt: number,
): TextStyle {
  return { font: a.font ?? "Helvetica", size: a.size ?? dflt, color: a.color ?? "#000000" };
}

const MARGIN = 36;

function headerSpec(over: Partial<HeaderFooterSpec> & { style: TextStyle }): HeaderFooterSpec {
  return {
    header: ["", "", ""],
    footer: ["", "", ""],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    startNumber: 1,
    dateFormat: "M/D/YYYY",
    ...over,
  };
}

interface Hit extends PageRedaction {
  text: string;
}

/**
 * Matches in page text (boxes padded by 1 pt, like the leak suite) and in form field
 * values (the whole widget is marked, so the field goes). Never logged or returned.
 */
async function findHits(
  rt: Runtime,
  bytes: Uint8Array,
  patterns: PatternId[],
  pages: number[],
): Promise<Hit[]> {
  const hits: Hit[] = searchDocument(rt.module, bytes, { patterns }, pages).map((h) => ({
    pageIndex: h.pageIndex,
    rects: h.rects.map((r) => ({ l: r.l - 1, b: r.b - 1, r: r.r + 1, t: r.t + 1 })),
    text: h.text ?? "",
  }));
  await withEngineDoc(rt.engine, bytes, async (doc) => {
    for (const i of pages) {
      const height = doc.pages[i]?.size.height ?? 0;
      for (const w of await pageWidgets(rt.engine, doc, i)) {
        const value = w.field.value ?? "";
        for (const m of findMatches(value, { patterns })) {
          const r = w.rect;
          hits.push({
            pageIndex: i,
            rects: [
              {
                l: r.origin.x,
                r: r.origin.x + r.size.width,
                t: height - r.origin.y,
                b: height - r.origin.y - r.size.height,
              },
            ],
            text: value.slice(m.start, m.end),
          });
        }
      }
    }
  });
  return hits;
}

const REDACT_PATTERNS = ["ssn", "itin", "ein", "routing", "account"] as const;

export function registerDecorateTools(server: McpServer, deps: ServerDeps): void {
  const { rt } = deps;

  server.registerTool(
    "ocr",
    {
      title: "OCR (make searchable)",
      description:
        "Adds an invisible text layer to scanned pages so they can be searched and redacted. Pages that already have text are skipped. Returns page numbers only, never the recognised text." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        pages,
        straighten: z
          .boolean()
          .optional()
          .describe("Fix sideways and tilted pages first (default true)."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "ocr", "A", async (args, call) => {
      let rep = { read: [] as number[], hadText: [] as number[], noWords: [] as number[] };
      const r = await changeCopy(call, args, "OCR", async (c) => {
        const ocr = rt.ocr(c.job.dir);
        const res = await ocrDocument(
          rt.module,
          ocr,
          c.ctx.qpdf,
          c.bytes,
          {
            pages: pageList(call, args.pages, c.pageCount),
            straighten: args.straighten !== false,
          },
          new OcrControl(ocr),
        );
        rep = res;
        return res.bytes;
      });
      const one = (l: number[]) => l.map((i) => i + 1);
      return {
        facts: {
          output: r.output,
          pages_read: one(rep.read),
          pages_already_text: one(rep.hadText),
          pages_no_words: one(rep.noWords),
          warnings: r.warnings,
        },
      };
    }),
  );

  server.registerTool(
    "optimize",
    {
      title: "Reduce file size",
      description:
        "Makes a smaller copy: email (100 dpi images), standard (150 dpi) or archive (300 dpi, mostly removes waste)." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        preset: z.enum(["email", "standard", "archive"]).optional().describe("Default standard."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "optimize", "A", async (args, call) => {
      let before = 0;
      const r = await changeCopy(call, args, "Optimized", async (c) => {
        before = c.bytes.byteLength;
        const res = await optimizeDocument(
          rt.module,
          c.ctx.qpdf,
          await rt.subsetter(),
          c.bytes,
          args.preset ?? "standard",
        );
        return res.bytes;
      });
      return {
        facts: { output: r.output, size_before: before, warnings: r.warnings },
      };
    }),
  );

  server.registerTool(
    "add_bates",
    {
      title: "Add Bates numbers",
      description:
        "Stamps Bates numbers (prefix + zero-padded number + suffix) on each page, bottom right by default." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        prefix: z
          .string()
          .max(40)
          .optional()
          .describe('e.g. "JD-" (client initials, never an SSN).'),
        start: z.number().int().min(0).optional().describe("First number (default 1)."),
        digits: z.number().int().min(1).max(12).optional().describe("Zero padding (default 6)."),
        suffix: z.string().max(40).optional(),
        position: z
          .enum([
            "footer-left",
            "footer-center",
            "footer-right",
            "header-left",
            "header-center",
            "header-right",
          ])
          .optional(),
        pages,
        font,
        size,
        color,
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "add_bates", "A", async (args, call) => {
      const bates = {
        prefix: args.prefix ?? "",
        start: args.start ?? 1,
        digits: args.digits ?? 6,
        suffix: args.suffix ?? "",
      };
      const [row, col] = (args.position ?? "footer-right").split("-") as [string, string];
      const slots: [string, string, string] = ["", "", ""];
      slots[col === "left" ? 0 : col === "center" ? 1 : 2] = "{bates}";
      let numbered = 0;
      const r = await changeCopy(call, args, "Bates", async (c) => {
        const list = pageList(call, args.pages, c.pageCount);
        numbered = list.length;
        return addHeaderFooter(
          rt.module,
          c.ctx.qpdf,
          c.bytes,
          headerSpec({
            style: style(args, 10),
            ...(row === "header" ? { header: slots } : { footer: slots }),
            ...(args.pages ? { pages: list } : {}),
          }),
          { fileName: basename(c.srcPath), date: new Date() },
          bates,
        );
      });
      return {
        facts: {
          output: r.output,
          first_number: `${bates.prefix}${String(bates.start).padStart(bates.digits, "0")}${bates.suffix}`,
          pages_numbered: numbered,
          warnings: r.warnings,
        },
      };
    }),
  );

  const slot = z.string().max(200).optional();
  server.registerTool(
    "add_header_footer",
    {
      title: "Add header and footer",
      description:
        "Adds header and/or footer text (left, center, right). Tokens: {page} {pages} {date} {file}. Example footer_center: 'Page {page} of {pages}'. Never put SSNs/EINs/account numbers in the text." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        header_left: slot,
        header_center: slot,
        header_right: slot,
        footer_left: slot,
        footer_center: slot,
        footer_right: slot,
        start_number: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Number {page} shows first (default 1)."),
        date_format: z.enum(["M/D/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMMM D, YYYY"]).optional(),
        pages,
        font,
        size,
        color,
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "add_header_footer", "A", async (args, call) => {
      const header: [string, string, string] = [
        args.header_left ?? "",
        args.header_center ?? "",
        args.header_right ?? "",
      ];
      const footer: [string, string, string] = [
        args.footer_left ?? "",
        args.footer_center ?? "",
        args.footer_right ?? "",
      ];
      if (![...header, ...footer].some((t) => t.trim()))
        throw new ToolError("give some header or footer text");
      const r = await changeCopy(call, args, "Header", async (c) =>
        addHeaderFooter(
          rt.module,
          c.ctx.qpdf,
          c.bytes,
          headerSpec({
            style: style(args, 10),
            header,
            footer,
            startNumber: args.start_number ?? 1,
            dateFormat: (args.date_format ?? "M/D/YYYY") as DateFormat,
            ...(args.pages ? { pages: pageList(call, args.pages, c.pageCount) } : {}),
          }),
          { fileName: basename(c.srcPath), date: new Date() },
        ),
      );
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );

  server.registerTool(
    "add_watermark",
    {
      title: "Add watermark",
      description: 'Adds a text watermark such as "DRAFT" or "COPY" across the pages.' + SAFE_NOTE,
      inputSchema: z.object({
        path,
        text: z.string().min(1).max(100),
        opacity: z.number().min(0.05).max(1).optional().describe("0.05-1 (default 0.3)."),
        rotation: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("Degrees anticlockwise (default 45)."),
        behind: z.boolean().optional().describe("Draw behind the page content (default false)."),
        pages,
        font,
        size: z.number().min(8).max(300).optional().describe("Font size (default 72)."),
        color: color.describe('Colour as "#rrggbb" (default grey #808080).'),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "add_watermark", "A", async (args, call) => {
      const r = await changeCopy(call, args, "Watermarked", async (c) =>
        addWatermark(rt.module, c.ctx.qpdf, c.bytes, {
          source: {
            text: args.text,
            style: { ...style(args, 72), color: args.color ?? "#808080" },
          },
          opacity: args.opacity ?? 0.3,
          rotation: args.rotation ?? 45,
          behind: args.behind === true,
          position: { h: "center", v: "center", dx: 0, dy: 0 },
          ...(args.pages ? { pages: pageList(call, args.pages, c.pageCount) } : {}),
        }),
      );
      return { facts: { output: r.output, warnings: r.warnings } };
    }),
  );

  server.registerTool(
    "redact_patterns",
    {
      title: "Redact SSNs, EINs and account numbers",
      description:
        "Finds SSNs, ITINs, EINs, bank routing numbers and account numbers in the PDF's text and permanently removes them (text, images and data under each match), then checks the result. Returns only how many matches were on each page, never the matched text. Scanned pages need ocr first. Use dry_run to count without redacting. A person should review the result: offer open_in_app." +
        SAFE_NOTE,
      inputSchema: z.object({
        path,
        patterns: z
          .array(z.enum(REDACT_PATTERNS))
          .min(1)
          .optional()
          .describe("Which kinds to find (default all five)."),
        pages,
        dry_run: z
          .boolean()
          .optional()
          .describe("Only count matches; write nothing (default false)."),
        task,
        output_name: outputName,
      }),
      annotations: CREATES_FILES,
    },
    runTool(deps, "redact_patterns", "A", async (args, call) => {
      const patterns: PatternId[] = [...(args.patterns ?? REDACT_PATTERNS)];
      const count = (hits: { pageIndex: number }[]) => {
        const per: Record<string, number> = {};
        for (const h of hits)
          per[String(h.pageIndex + 1)] = (per[String(h.pageIndex + 1)] ?? 0) + 1;
        return per;
      };
      if (args.dry_run) {
        const src = await call.pdf(args.path);
        const bytes = await call.read(src);
        const facts = pdfFacts(rt.module, bytes);
        if (facts.needs_password) throw new ToolError("This PDF is password-protected.");
        const hits = await findHits(
          rt,
          bytes,
          patterns,
          pageList(call, args.pages, facts.pages ?? 0),
        );
        return {
          facts: {
            dry_run: true,
            matches: hits.length,
            matches_per_page: count(hits),
            has_text: facts.has_text,
          },
        };
      }
      let perPage: Record<string, number> = {};
      let total = 0;
      const r = await changeCopy(call, args, "Redacted", async (c) => {
        const hits = await findHits(rt, c.bytes, patterns, pageList(call, args.pages, c.pageCount));
        total = hits.length;
        perPage = count(hits);
        if (!hits.length) {
          const hasText = pdfFacts(rt.module, c.bytes).has_text === true;
          throw new ToolError(
            hasText
              ? "No matches were found, so no file was written."
              : "No matches: this PDF has no text layer. Run ocr first, then redact the OCR copy.",
          );
        }
        const res = await redactDocument(rt.module, c.ctx.qpdf, c.bytes, {
          marks: hits.map((h) => ({ pageIndex: h.pageIndex, rects: h.rects })),
          found: hits.map((h) => h.text),
        });
        return res.bytes;
      });
      return {
        facts: {
          output: r.output,
          matches_redacted: total,
          matches_per_page: perPage,
          verified: true,
          warnings: [
            ...r.warnings,
            "Patterns can miss numbers written unusually (or in images). Have a person check the result in PDF Workbench.",
          ],
        },
      };
    }),
  );
}
