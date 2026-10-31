// Header & Footer, Bates numbers, Watermark and Background as the UI runs them: each
// add, update or remove on the open document is one undo step; Bates numbers on more
// than one file write "<name>_Bates.pdf" beside each file instead.
import type { WorkbenchApi } from "../../app/workbench";
import { pageOp } from "../../app/pages";
import type {
  BackgroundSpec,
  BatesSpec,
  DecorKind,
  HeaderFooterSpec,
  WatermarkSpec,
} from "../../engine/decorate";
import { dirName, platform, safeFileName } from "../../platform";
import { baseName } from "../../platform/types";

export const KIND_NAMES: Record<DecorKind, string> = {
  header: "header & footer",
  bates: "Bates numbers",
  watermark: "watermark",
  background: "background",
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Kinds the open document carries now (for Update / Remove). */
export async function kindsIn(wb: WorkbenchApi, documentId: string): Promise<Set<string>> {
  const bytes = await wb.docBytes(documentId);
  return new Set(bytes ? await pageOp("decorKinds", bytes) : []);
}

export function addHeaderFooter(
  wb: WorkbenchApi,
  documentId: string,
  spec: HeaderFooterSpec,
  bates?: BatesSpec,
) {
  const fileName = wb.meta[documentId]?.name ?? "Document.pdf";
  return wb.edit(documentId, bates ? "Bates numbering" : "Header & footer", (b) =>
    pageOp("addHeaderFooter", b, spec, { fileName, date: new Date() }, bates),
  );
}

export function addWatermark(wb: WorkbenchApi, documentId: string, spec: WatermarkSpec) {
  return wb.edit(documentId, "Watermark", (b) => pageOp("addWatermark", b, spec));
}

export function addBackground(wb: WorkbenchApi, documentId: string, spec: BackgroundSpec) {
  return wb.edit(documentId, "Background", (b) => pageOp("addBackground", b, spec));
}

export async function removeKind(wb: WorkbenchApi, documentId: string, kind: DecorKind) {
  let found = true;
  await wb.edit(documentId, `Remove ${KIND_NAMES[kind]}`, async (b) => {
    const r = await pageOp("removeDecorations", b, [kind]);
    found = r.pages.length > 0;
    return found ? r.bytes : null;
  });
  if (!found)
    wb.toast(`This document has no ${KIND_NAMES[kind]} added by PDF Workbench to remove.`);
}

/** A file in the Bates list: the open document, a file on disk, or picked bytes. */
export interface BatesFile {
  path: string | null;
  documentId: string | null;
  name: string;
  bytes?: Uint8Array;
}

/**
 * Bates numbers across files, in order: the numbers run on from file to file. Each
 * file is saved as "<name>_Bates.pdf" beside it (" (2)" when taken). Returns the
 * next free number, or null when it stopped on an error.
 */
export async function batesFiles(
  wb: WorkbenchApi,
  files: BatesFile[],
  spec: HeaderFooterSpec,
  bates: BatesSpec,
  progress: (done: number) => void,
): Promise<number | null> {
  let next = bates.start;
  for (const [i, f] of files.entries()) {
    try {
      const bytes = f.documentId
        ? await wb.docBytes(f.documentId)
        : f.path
          ? new Uint8Array((await platform.readPath(f.path)).bytes)
          : (f.bytes ?? null);
      if (!bytes) throw new Error("it is password-protected");
      // Every page of every file; {page} counts within each file.
      const { pages: _all, ...whole } = spec;
      void _all;
      const out = await pageOp(
        "addHeaderFooter",
        bytes,
        { ...whole, startNumber: 1 },
        { fileName: f.name, date: new Date() },
        { ...bates, start: next },
      );
      const count = await pageOp("pageCount", out);
      const name = safeFileName(`${f.name.replace(/\.pdf$/i, "")}_Bates.pdf`);
      if (f.path) await platform.writeNewFile(dirName(f.path), name, out);
      else {
        const target = await platform.pickSavePath(name);
        if (!target) throw new Error("not saved");
        await platform.saveAs(target, null, out);
      }
      next += count;
      progress(i + 1);
    } catch (e) {
      wb.toast(`Bates numbering stopped at ${baseName(f.path ?? f.name)}: ${message(e)}`, "error");
      return null;
    }
  }
  return next;
}
