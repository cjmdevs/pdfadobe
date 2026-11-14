// Page properties (B8): one page's size, orientation, rotation and comments, with
// buttons to the existing Crop, Page size and Rotate operations. Read from the open
// document; lengths in the unit picked in Preferences > Page Display.
import { useDocumentState } from "@embedpdf/core/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { usePageActions } from "../app/pageActions";
import { formatLength } from "../app/units";
import { useWorkbench } from "../app/workbench";
import { Modal } from "./kit/Dialog";

const NAMED: { name: string; w: number; h: number }[] = [
  { name: "Letter", w: 612, h: 792 },
  { name: "Legal", w: 612, h: 1008 },
  { name: "Tabloid", w: 792, h: 1224 },
  { name: "A4", w: 595, h: 842 },
  { name: "A3", w: 842, h: 1191 },
];

/** "Letter", "A4"... when the size is within 2 points of a standard one (either way up). */
export function paperName(w: number, h: number): string | null {
  const [a, b] = w <= h ? [w, h] : [h, w];
  return NAMED.find((n) => Math.abs(n.w - a) <= 2 && Math.abs(n.h - b) <= 2)?.name ?? null;
}

export function PagePropertiesDialog({
  documentId,
  page,
  onClose,
}: {
  documentId: string;
  page: number;
  onClose: () => void;
}) {
  const wb = useWorkbench();
  const actions = usePageActions(documentId);
  const doc = useDocumentState(documentId)?.document ?? null;
  const { state } = useAnnotation(documentId);
  const p = doc?.pages[page];
  if (!doc || !p) return null;
  const turns = (((p.rotation as number) % 4) + 4) % 4;
  // Size as shown on screen (rotation swaps width and height).
  const [w, h] = turns % 2 ? [p.size.height, p.size.width] : [p.size.width, p.size.height];
  const units = wb.settings.units;
  const comments = (state.pages[page] ?? [])
    .map((uid) => state.byUid[uid]?.object)
    .filter(
      (a) =>
        a !== undefined &&
        a.type !== PdfAnnotationSubtype.LINK &&
        a.type !== PdfAnnotationSubtype.WIDGET &&
        a.type !== PdfAnnotationSubtype.POPUP,
    ).length;
  const named = paperName(w, h);
  const op = (op: "crop" | "pageSize") =>
    wb.setDialog({ kind: "pageOp", op, documentId, pages: [page] });
  return (
    <Modal title={`Page ${page + 1} properties`} onClose={onClose}>
      <dl className="props" data-testid="page-properties">
        <dt>Page</dt>
        <dd>
          {page + 1} of {doc.pageCount}
        </dd>
        <dt>Size</dt>
        <dd>
          {formatLength(w, units)} × {formatLength(h, units)}
          {named ? ` (${named})` : ""}
        </dd>
        <dt>Orientation</dt>
        <dd>{w > h ? "Landscape" : w < h ? "Portrait" : "Square"}</dd>
        <dt>Rotation</dt>
        <dd>{turns * 90}°</dd>
        <dt>Comments and marks</dt>
        <dd>{comments}</dd>
      </dl>
      <div className="button-row">
        <button type="button" onClick={() => void actions.rotate([page], 3)}>
          Rotate left
        </button>
        <button type="button" onClick={() => void actions.rotate([page], 1)}>
          Rotate right
        </button>
        <button type="button" onClick={() => op("crop")}>
          Crop…
        </button>
        <button type="button" onClick={() => op("pageSize")}>
          Page size…
        </button>
      </div>
    </Modal>
  );
}
