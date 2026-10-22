// Independent view of a PDF's structure for page-organization tests: qpdf's JSON for
// pages, bookmarks and form fields; pdf.js for annotations and rendered field values.
// Neither shares code with PDFium, which produced most of the files under test.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qpdfBin } from "../corpus/generate.mjs";
import { pdfjsView } from "./leak-scan";

export interface BookmarkView {
  title: string;
  /** 1-based page, or null when the target is gone. */
  page: number | null;
  kids: BookmarkView[];
}

export interface FieldView {
  name: string;
  /** Text value, checkbox/radio state name, or null. */
  value: string | null;
  page: number;
}

export interface PdfInspection {
  pages: number;
  /** Text drawn on each page (pdf.js), to identify pages after a reorder. */
  pageText: string[];
  outline: BookmarkView[];
  fields: FieldView[];
  annotations: { page: number; subtype: string; strings: string[] }[];
  /** First line of `qpdf --check` when it reports a problem; null when clean. */
  checkError: string | null;
  /** Visible size (CropBox, else MediaBox) and the MediaBox size, in points. */
  pageSizes: {
    width: number;
    height: number;
    rotate: number;
    mediaWidth: number;
    mediaHeight: number;
  }[];
}

interface QpdfOutline {
  title: string;
  destpageposfrom1: number | null;
  kids: QpdfOutline[];
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-inspect-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, bytes);
    const json = JSON.parse(
      execFileSync(
        qpdfBin(),
        ["--json=2", "--json-key=pages", "--json-key=outlines", "--json-key=acroform", file],
        {
          maxBuffer: 256 * 1024 * 1024,
          encoding: "utf8",
        },
      ),
    ) as {
      pages: { object: string }[];
      outlines: QpdfOutline[];
      acroform: {
        fields: {
          fullname: string;
          value: unknown;
          pageposfrom1: number;
          annotation: { appearancestate: string };
        }[];
      };
    };
    let checkError: string | null = null;
    try {
      execFileSync(qpdfBin(), ["--check", file], { stdio: "pipe" });
    } catch (e) {
      checkError =
        String((e as { stdout?: Buffer }).stdout ?? e)
          .split("\n")
          .find((l) => /error|warning/i.test(l)) ?? "qpdf --check failed";
    }
    const toView = (o: QpdfOutline): BookmarkView => ({
      title: o.title,
      page: o.destpageposfrom1 ?? null,
      kids: o.kids.map(toView),
    });
    const fields = json.acroform.fields.map((f) => ({
      name: f.fullname,
      value: fieldValue(f.value),
      page: f.pageposfrom1,
    }));
    const view = await pdfjsView(bytes);
    const pageSizes = json.pages.map((p) => {
      const out = execFileSync(qpdfBin(), [`--show-object=${p.object.replace(" 0 R", "")}`, file], {
        encoding: "utf8",
      });
      const box =
        /\/CropBox \[ ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) \]/.exec(out) ??
        /\/MediaBox \[ ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) \]/.exec(out);
      const rot = /\/Rotate (-?\d+)/.exec(out);
      const n = box ? box.slice(1).map(Number) : [0, 0, 0, 0];
      const mb = /\/MediaBox \[ ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) \]/.exec(out);
      const m = mb ? mb.slice(1).map(Number) : n;
      return {
        width: n[2]! - n[0]!,
        height: n[3]! - n[1]!,
        rotate: rot ? Number(rot[1]) : 0,
        mediaWidth: m[2]! - m[0]!,
        mediaHeight: m[3]! - m[1]!,
      };
    });
    return {
      pages: json.pages.length,
      pageText: view.pageText,
      outline: json.outlines.map(toView),
      fields,
      annotations: view.annotations,
      checkError,
      pageSizes,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fieldValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.startsWith("u:") ? s.slice(2) : s;
}

/** Flattened "title@page" list, depth shown by leading dots. */
export function outlineLines(o: BookmarkView[], depth = 0): string[] {
  return o.flatMap((b) => [
    `${".".repeat(depth)}${b.title}@${b.page}`,
    ...outlineLines(b.kids, depth + 1),
  ]);
}
