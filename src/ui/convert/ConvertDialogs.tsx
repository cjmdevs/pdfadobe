// Export PDF (pages to PNG/JPEG at a chosen resolution, or the text as a .txt file) and
// Create PDF from images (scanner batches, optionally made searchable). Phase 7; no
// Office formats in v1. New files never replace existing ones (" (2)" is added).
import { useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useWorkbench } from "../../app/workbench";
import { pageOp, pageTask } from "../../app/pages";
import { pageFileName, type ImageFormat } from "../../engine/convert";
import { OcrCancelled, type OcrProgress } from "../../engine/ocr";
import { parseRanges, RangeSyntaxError } from "../../engine/pages/ranges";
import { platform } from "../../platform";
import { baseName, dirName, type OpenedFile } from "../../platform/types";
import { scan } from "../scan/scanStore";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stem = (name: string) => name.replace(/\.[^.\\/]+$/, "");
const IMAGE = /\.(jpe?g|png|tiff?)$/i;

export function ExportPdfDialog({ documentId, onClose }: { documentId: string; onClose(): void }) {
  const wb = useWorkbench();
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? 0;
  const m = wb.meta[documentId];
  const [as, setAs] = useState<ImageFormat | "text">("png");
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
      if (as === "text") {
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
            ["png", "PNG images (one per page)"],
            ["jpeg", "JPEG images (one per page)"],
            ["text", "Plain text (.txt)"],
          ] as const
        ).map(([v, label]) => (
          <label key={v}>
            <input type="radio" checked={as === v} onChange={() => setAs(v)} />
            {label}
          </label>
        ))}
      </fieldset>
      {as !== "text" && (
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
      {as === "text" && (
        <p className="hint">Scanned pages need Recognize Text first, or they give no text.</p>
      )}
      <label>
        Pages
        <input
          type="text"
          placeholder={`All (1-${pageCount})`}
          value={range}
          onChange={(e) => setRange(e.target.value)}
        />
      </label>
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
          {done !== null && as !== "text" ? `Saving page ${done + 1}…` : "Export"}
        </button>
      </div>
    </div>
  );
}

interface Picked {
  name: string;
  bytes: Uint8Array;
}

export function CreatePdfDialog({ onClose }: { onClose(): void }) {
  const wb = useWorkbench();
  const [files, setFiles] = useState<Picked[]>([]);
  const [ocr, setOcr] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const order = (list: Picked[]) =>
    [...list].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }),
    );
  const add = (opened: OpenedFile[]) =>
    setFiles(
      order([
        ...files,
        ...opened
          .filter((f) => IMAGE.test(f.name))
          .map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
      ]),
    );
  const addFolder = async () => {
    const dir = await platform.pickFolder();
    if (!dir) return;
    try {
      const paths = (await platform.listFolder(dir)).filter((p) => IMAGE.test(p));
      add(await Promise.all(paths.map((p) => platform.readPath(p))));
    } catch (e) {
      wb.toast(`Could not read the folder: ${message(e)}`, "error");
    }
  };

  const create = async () => {
    setStatus("Making the PDF…");
    try {
      let pdf = await pageOp(
        "imagesToPdf",
        files.map((f) => f.bytes),
      );
      if (ocr) {
        const task = pageTask<"ocrDocument", OcrProgress>(
          "ocrDocument",
          (p) =>
            setStatus(`Recognizing text: page ${Math.min(p.done + 1, p.total)} of ${p.total}…`),
          pdf,
          { skipText: true, straighten: scan.get().straighten },
        );
        pdf = (await task.done).bytes;
      }
      wb.openNew(`${stem(files[0]?.name ?? "Scans")}.pdf`, pdf);
      onClose();
    } catch (e) {
      if (!(e instanceof OcrCancelled)) wb.toast(`Create PDF failed: ${message(e)}`, "error");
      setStatus(null);
    }
  };

  return (
    <div className="decorate" data-testid="create-pdf-dialog">
      <div className="row">
        <button type="button" onClick={() => void platform.pickFiles({ images: true }).then(add)}>
          Add Images…
        </button>
        <button type="button" onClick={() => void addFolder()}>
          Add a Folder…
        </button>
      </div>
      {files.length === 0 ? (
        <p className="hint">JPEG, PNG or TIFF (multi-page TIFF gives one page per image).</p>
      ) : (
        <ol className="bates-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.name}{" "}
              <button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <label>
        <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
        Recognize text (make the PDF searchable)
      </label>
      <p className="hint">Pages follow the file names in order (Scan 2 before Scan 10).</p>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={!files.length || status !== null}
        >
          {status ?? `Create PDF from ${files.length} image${files.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
