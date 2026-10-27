// Stamp Summary (Phase 4): every workpaper item in the document with page and position,
// filtered by type and author; a click jumps to it. Shown in the Tools pane while
// Workpaper Tools is open.
import { useMemo, useState } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useWorkbench } from "../../app/workbench";
import { summaryRows, type SummaryRow } from "../../flyer/items";
import { exportSummaryCsv, formatWhen } from "./flyerFiles";

export default function StampSummaryPanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { provides: scope, state } = useAnnotation(documentId);
  const { provides: scroll } = useScroll(documentId);
  const [type, setType] = useState("");
  const [author, setAuthor] = useState("");
  const rows = useMemo(
    () => summaryRows(Object.values(state.byUid).map((t) => t.object)),
    [state.byUid],
  );
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const authors = [...new Set(rows.map((r) => r.author))].sort();
  const shown = rows.filter((r) => (!type || r.type === type) && (!author || r.author === author));

  const jump = (r: SummaryRow) => {
    scroll?.scrollToPage({
      pageNumber: r.pageIndex + 1,
      pageCoordinates: { x: r.x, y: r.y },
      behavior: "instant",
      alignY: 30,
    });
    scope?.selectAnnotation(r.pageIndex, r.id);
  };

  return (
    <section className="stamp-summary" aria-label="Stamp Summary" data-testid="stamp-summary">
      <h3>Stamp Summary ({shown.length})</h3>
      <div className="filters">
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Filter by author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        >
          <option value="">All authors</option>
          {authors.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      {rows.length === 0 && <p className="hint">No tickmarks or workpaper stamps yet.</p>}
      <ul>
        {shown.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => jump(r)}>
              <span className="name">{r.name}</span>
              <span className="meta">
                Page {r.pageIndex + 1} · {r.author}
                {r.created ? ` · ${formatWhen(r.created)}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!rows.length}
        onClick={() => void exportSummaryCsv(wb, documentId)}
      >
        Export to CSV…
      </button>
    </section>
  );
}
