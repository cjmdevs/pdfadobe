// Export PDF (pages to PNG/JPEG at a chosen resolution, the text as a .txt file, and in
// B5 to Word through Word itself, or to Excel with our own table layout) and Create PDF
// (Phase 7 images; B5 Office files, batches and mixed combines). New files never replace
// existing ones (" (2)" is added).
import { useEffect, useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useWorkbench } from "../../app/workbench";
import { pageOp, pageTask } from "../../app/pages";
import { pageFileName, type ImageFormat } from "../../engine/convert";
import { OcrCancelled, type OcrProgress } from "../../engine/ocr";
import { parseRanges, RangeSyntaxError } from "../../engine/pages/ranges";
import { platform } from "../../platform";
import { baseName, dirName, officeAppFor, type OfficeApps } from "../../platform/types";
import { scan } from "../scan/scanStore";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stem = (name: string) => name.replace(/\.[^.\\/]+$/, "");
const IMAGE = /\.(jpe?g|png|tiff?)$/i;

export function ExportPdfDialog({ documentId, onClose }: { documentId: string; onClose(): void }) {
  const wb = useWorkbench();
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? 0;
  const m = wb.meta[documentId];
  const [as, setAs] = useState<ImageFormat | "text" | "word" | "excel">("png");
  const [hasWord, setHasWord] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    platform.office
      .apps()
      .then((a) => live && setHasWord(a.word))
      .catch(() => live && setHasWord(false));
    return () => {
      live = false;
    };
  }, []);
  const images = as === "png" || as === "jpeg";
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(85);
  const [range, setRange] = useState("");
  const [folder, setFolder] = useState<string | null>(
    m?.source.kind === "path" ? dirName(m.source.path) : null,
  );
  const [done, setDone] = useState<number | null>(null);

  const run = async () => {
    let pages: number[];
    try {
      pages = parseRanges(range, pageCount);
    } catch (e) {
      wb.toast(e instanceof RangeSyntaxError ? e.message : message(e), "error");
      return;
    }
    const target = folder ?? (await platform.pickFolder());
    if (!target) return;
    setFolder(target);
    const bytes = await wb.docBytes(documentId);
    if (!bytes) return;
    const name = stem(m?.name ?? "Document.pdf");
    setDone(0);
    try {
      if (as === "word") {
        // Word converts the whole document; its layout is rebuilt, not copied.
        const docx = await platform.office.pdfToWord(bytes);
        const path = await platform.writeNewFile(target, `${name}.docx`, docx);
        wb.toast(`Saved ${baseName(path)}. Check it against the PDF: layouts can shift.`);
      } else if (as === "excel") {
        const xlsx = await pageOp("documentXlsx", bytes, pages);
        const path = await platform.writeNewFile(target, `${name}.xlsx`, xlsx);
        wb.toast(`Saved ${baseName(path)} (one sheet per page).`);
      } else if (as === "text") {
        const text = await pageOp("documentText", bytes, pages);
        // UTF-8 with a byte order mark, so Notepad and Excel read accents right.
        const BOM = String.fromCharCode(0xfeff);
        const body = new TextEncoder().encode(`${BOM}${text}\r\n`);
        const path = await platform.writeNewFile(target, `${name}.txt`, body);
        wb.toast(`Saved the text as ${baseName(path)}.`);
      } else {
        for (const [i, p] of pages.entries()) {
          const img = await pageOp("pageImage", bytes, p, dpi, as, quality);
          await platform.writeNewFile(target, pageFileName(name, p, pageCount, as), img);
          setDone(i + 1);
        }
        wb.toast(`Saved ${pages.length} ${as === "png" ? "PNG" : "JPEG"} file(s) in ${target}.`);
      }
      onClose();
    } catch (e) {
      wb.toast(`Export failed: ${message(e)}`, "error");
      setDone(null);
    }
  };

  return (
    <div className="decorate" data-testid="export-dialog">
      <fieldset>
        <legend>Save as</legend>
        {(
          [
            ["word", "Word document (.docx)"],
            ["excel", "Excel workbook (.xlsx)"],
            ["png", "PNG images (one per page)"],
            ["jpeg", "JPEG images (one per page)"],
            ["text", "Plain text (.txt)"],
          ] as const
        ).map(([v, label]) => (
          <label key={v}>
            <input
              type="radio"
              checked={as === v}
              disabled={v === "word" && hasWord === false}
              onChange={() => setAs(v)}
            />
            {label}
            {v === "word" && hasWord === false && " (needs Microsoft Word)"}
          </label>
        ))}
      </fieldset>
      {images && (
        <div className="row">
          <label>
            Resolution
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {[72, 96, 150, 200, 300, 600].map((d) => (
                <option key={d} value={d}>
                  {d} dpi
                </option>
              ))}
            </select>
          </label>
          {as === "jpeg" && (
            <label>
              Quality
              <input
                type="number"
                min={10}
                max={100}
                value={quality}
                onChange={(e) =>
                  setQuality(Math.min(100, Math.max(10, Number(e.target.value) || 85)))
                }
              />
            </label>
          )}
        </div>
      )}
      {as === "word" && (
        <p className="warning" role="note">
          Microsoft Word rebuilds the pages as editable text. Complex layouts (columns, tables,
          forms, tax returns) shift and fonts can change, so check the result against the PDF. Word
          converts the whole document.
        </p>
      )}
      {as === "excel" && (
        <p className="hint">
          One sheet per page. Each line of text becomes a row, and amounts like (1,234.50) become
          numbers. Check totals against the PDF. Scanned pages need Recognize Text first.
        </p>
      )}
      {as === "text" && (
        <p className="hint">Scanned pages need Recognize Text first, or they give no text.</p>
      )}
      {as !== "word" && (
        <label>
          Pages
          <input
            type="text"
            placeholder={`All (1-${pageCount})`}
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
      )}
      <div className="row">
        <span className="hint">Folder: {folder ?? "(you will be asked)"}</span>
        <button
          type="button"
          onClick={() => void platform.pickFolder().then((f) => f && setFolder(f))}
        >
          Change…
        </button>
      </div>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void run()}
          disabled={done !== null}
        >
          {done === null
            ? "Export"
            : images
              ? `Saving page ${done + 1}…`
              : as === "word"
                ? "Word is converting…"
                : "Exporting…"}
        </button>
      </div>
    </div>
  );
}

type Kind = "office" | "pdf" | "image";

interface Item {
  path: string;
  name: string;
  kind: Kind;
  app: keyof OfficeApps | null;
}

const APP_NAME: Record<keyof OfficeApps, string> = {
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
};

function itemFor(path: string): Item | null {
  const name = baseName(path);
  const app = officeAppFor(name);
  if (app) return { path, name, kind: "office", app };
  if (/\.pdf$/i.test(name)) return { path, name, kind: "pdf", app: null };
  if (IMAGE.test(name)) return { path, name, kind: "image", app: null };
  return null;
}

const byName = (a: Item, b: Item) =>
  a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });

/**
 * Create PDF (Phase 7 images, B5 Office and mixed files). "One PDF per file" writes
 * name.pdf beside each Word, Excel, PowerPoint or image file; "Combine" makes one PDF of
 * the list in order, beside the first file. Originals are never touched.
 */
export function CreatePdfDialog({ onClose }: { onClose(): void }) {
  const wb = useWorkbench();
  const [items, setItems] = useState<Item[]>([]);
  const [mode, setMode] = useState<"each" | "combine">("each");
  const [ocr, setOcr] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [apps, setApps] = useState<OfficeApps | null>(null);

  useEffect(() => {
    let live = true;
    platform.office
      .apps()
      .then((a) => live && setApps(a))
      .catch(() => live && setApps({ word: false, excel: false, powerpoint: false }));
    return () => {
      live = false;
    };
  }, []);

  const add = (paths: string[]) => {
    const known = new Set(items.map((i) => i.path.toLowerCase()));
    const added = paths
      .map(itemFor)
      .filter((i): i is Item => !!i && !known.has(i.path.toLowerCase()))
      .sort(byName);
    setItems([...items, ...added]);
  };
  const addFolder = async () => {
    const dir = await platform.pickFolder();
    if (!dir) return;
    try {
      add(await platform.listFolder(dir, { office: true }));
    } catch (e) {
      wb.toast(`Could not read the folder: ${message(e)}`, "error");
    }
  };
  const move = (i: number, by: number) => {
    const next = [...items];
    const [it] = next.splice(i, 1);
    if (!it) return;
    next.splice(i + by, 0, it);
    setItems(next);
  };

  const missing = (i: Item) => i.app !== null && apps !== null && !apps[i.app];
  const blocked = items.filter(missing);
  const work = mode === "each" ? items.filter((i) => i.kind !== "pdf") : items;

  const asPdf = async (it: Item): Promise<Uint8Array> => {
    if (it.kind === "office") return platform.office.toPdf(it.path);
    const bytes = new Uint8Array((await platform.readPath(it.path)).bytes);
    return it.kind === "pdf" ? bytes : pageOp("imagesToPdf", [bytes]);
  };
  const recognize = async (pdf: Uint8Array, label: string) => {
    const task = pageTask<"ocrDocument", OcrProgress>(
      "ocrDocument",
      (p) =>
        setStatus(
          `${label}: recognizing text, page ${Math.min(p.done + 1, p.total)} of ${p.total}…`,
        ),
      pdf,
      { skipText: true, straighten: scan.get().straighten },
    );
    return (await task.done).bytes;
  };

  const runEach = async () => {
    const failed: string[] = [];
    let made: string | null = null;
    let count = 0;
    for (const [n, it] of work.entries()) {
      setStatus(`Converting ${n + 1} of ${work.length}: ${it.name}…`);
      try {
        let pdf = await asPdf(it);
        if (ocr && it.kind === "image") pdf = await recognize(pdf, it.name);
        made = await platform.writeNewFile(dirName(it.path), `${stem(it.name)}.pdf`, pdf);
        count++;
      } catch (e) {
        if (e instanceof OcrCancelled) break;
        failed.push(`${it.name}: ${message(e)}`);
      }
    }
    if (count === 1 && made && work.length === 1) await wb.openPaths([made]);
    if (count) wb.toast(`Created ${count} PDF${count === 1 ? "" : "s"} beside the original files.`);
    if (failed.length) {
      wb.toast(
        `${failed.length} file${failed.length === 1 ? "" : "s"} not converted. ${failed.slice(0, 3).join("; ")}`,
        "error",
      );
    }
    return failed.length === 0;
  };

  const runCombine = async () => {
    const sources: { name: string; bytes: Uint8Array }[] = [];
    for (const [n, it] of items.entries()) {
      setStatus(`Preparing ${n + 1} of ${items.length}: ${it.name}…`);
      try {
        sources.push({ name: it.name, bytes: await asPdf(it) });
      } catch (e) {
        wb.toast(`${it.name} could not be added: ${message(e)}`, "error");
        return false;
      }
    }
    setStatus("Combining…");
    let pdf = await pageOp("combine", sources, { bookmarkPerFile: items.length > 1 });
    // Pages that already have text (Office, searchable PDFs) are skipped.
    if (ocr && items.some((i) => i.kind === "image")) pdf = await recognize(pdf, "Combined");
    const first = items[0];
    if (!first) return false;
    const path = await platform.writeNewFile(dirName(first.path), "Combined.pdf", pdf);
    await wb.openPaths([path]);
    wb.toast(`Saved ${baseName(path)} beside ${first.name}.`);
    return true;
  };

  const create = async () => {
    try {
      if (await (mode === "each" ? runEach() : runCombine())) onClose();
    } catch (e) {
      if (!(e instanceof OcrCancelled)) wb.toast(`Create PDF failed: ${message(e)}`, "error");
    }
    setStatus(null);
  };

  const label =
    mode === "combine"
      ? `Combine ${items.length} file${items.length === 1 ? "" : "s"} into one PDF`
      : `Create ${work.length} PDF${work.length === 1 ? "" : "s"}`;

  return (
    <div className="decorate" data-testid="create-pdf-dialog">
      <div className="row">
        <button type="button" onClick={() => void platform.pickPaths("create").then(add)}>
          Add Files…
        </button>
        <button type="button" onClick={() => void addFolder()}>
          Add a Folder…
        </button>
        {items.length > 0 && (
          <button type="button" onClick={() => setItems([])}>
            Clear
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="hint">
          Word, Excel and PowerPoint files, PDFs, and images (JPEG, PNG, TIFF; a multi-page TIFF
          gives one page per image). A folder adds the files in it, not its subfolders.
        </p>
      ) : (
        <ol className="bates-files" aria-label="Files">
          {items.map((it, i) => (
            <li key={it.path}>
              {it.name}
              {missing(it) && it.app && (
                <span className="error-text"> (needs Microsoft {APP_NAME[it.app]})</span>
              )}{" "}
              {mode === "combine" && (
                <>
                  <button
                    type="button"
                    aria-label={`Move ${it.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${it.name} down`}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
              <button type="button" onClick={() => setItems(items.filter((_, k) => k !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <fieldset>
        <legend>Make</legend>
        <label>
          <input type="radio" checked={mode === "each"} onChange={() => setMode("each")} />
          One PDF per file, saved beside each file
        </label>
        <label>
          <input type="radio" checked={mode === "combine"} onChange={() => setMode("combine")} />
          One combined PDF, in the order above, saved beside the first file
        </label>
      </fieldset>
      {mode === "each" && items.some((i) => i.kind === "pdf") && (
        <p className="hint">PDFs in the list are only used when combining.</p>
      )}
      <label>
        <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
        Recognize text in scanned images (make the PDF searchable)
      </label>
      <p className="hint">
        Office files are converted by Microsoft Office on this PC, in the background. You can also
        print from any program to the &ldquo;Microsoft Print to PDF&rdquo; printer that comes with
        Windows.
      </p>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={!work.length || blocked.length > 0 || apps === null || status !== null}
        >
          {status ?? label}
        </button>
      </div>
    </div>
  );
}
