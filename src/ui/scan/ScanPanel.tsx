// Scan & OCR panel (Phase 7), shown in the Tools pane while Scan & OCR is open:
// Recognize Text settings and button, progress with Cancel, the last outcome, and
// Recognize Text in a folder. The page image is never changed by OCR.
import { useState } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useWorkbench } from "../../app/workbench";
import { useNav } from "../../app/useNav";
import { parseRanges, RangeSyntaxError } from "../../engine/pages/ranges";
import { recognize } from "./scanActions";
import { scan, useScan, type PageScope } from "./scanStore";

export default function ScanPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const s = useScan();
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? 0;
  const { page } = useNav(documentId);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const run = s.run;
  const outcome = s.last[wb.meta[documentId]?.storeId ?? documentId];

  const start = () => {
    let pages: number[] | undefined;
    try {
      if (s.scope === "page") pages = [page];
      else if (s.scope === "range") pages = parseRanges(s.range, pageCount);
    } catch (e) {
      setRangeError(e instanceof RangeSyntaxError ? e.message : String(e));
      return;
    }
    setRangeError(null);
    void recognize(wb, documentId, pages);
  };

  const scopes: [PageScope, string][] = [
    ["page", `Current page (${page + 1})`],
    ["range", "Pages"],
    ["all", `All pages (${pageCount})`],
  ];

  return (
    <section className="redact-panel scan-panel" aria-label="Scan & OCR" data-testid="scan-panel">
      <details open>
        <summary>Recognize Text</summary>
        <fieldset disabled={run !== null}>
          {scopes.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="ocr-scope"
                checked={s.scope === value}
                onChange={() => scan.set({ scope: value })}
              />
              {label}
            </label>
          ))}
          {s.scope === "range" && (
            <label>
              Page range
              <input
                type="text"
                value={s.range}
                placeholder="e.g. 1-3, 5"
                aria-invalid={rangeError !== null}
                onChange={(e) => scan.set({ range: e.target.value })}
              />
            </label>
          )}
          {rangeError && <p className="hint error">{rangeError}</p>}
          <label>
            <input
              type="checkbox"
              checked={s.skipText}
              onChange={(e) => scan.set({ skipText: e.target.checked })}
            />
            Skip pages that already have text
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.straighten}
              onChange={(e) => scan.set({ straighten: e.target.checked })}
            />
            Detect rotation and straighten before reading
          </label>
        </fieldset>
        <p className="hint">
          The scan stays exactly as it is: an invisible, searchable text layer is added on top. Use
          Enhance &gt; Straighten Pages to straighten what you see.
        </p>
        {run ? (
          <div className="scan-progress" data-testid="ocr-progress" role="status">
            <progress max={Math.max(1, run.total)} value={run.done} />
            <span>
              {run.kind === "batch"
                ? `File ${Math.min(run.done + 1, run.total)} of ${run.total}`
                : run.total
                  ? `Page ${run.page === null ? run.done : run.page + 1}: ${run.done} of ${run.total} done`
                  : "Starting…"}
            </span>
            <button type="button" onClick={run.cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="primary" onClick={start} disabled={pageCount === 0}>
            Recognize Text
          </button>
        )}
        {outcome && (
          <p className="hint" data-testid="ocr-outcome">
            {outcome}
          </p>
        )}
      </details>
      <details open>
        <summary>Multiple files</summary>
        <p className="hint">
          Reads every PDF in a folder and saves each as a new file named &lt;name&gt;_OCR.pdf beside
          it. The originals are not changed.
        </p>
        <button
          type="button"
          disabled={run !== null}
          onClick={() => wb.setDialog({ kind: "batchOcr" })}
        >
          Recognize Text in a Folder…
        </button>
      </details>
    </section>
  );
}
