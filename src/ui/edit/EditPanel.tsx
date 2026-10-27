// Edit PDF (B3): the tool's panel in the Tools pane. Step U1 shows what is selected;
// the properties (font, size, colour, B/I/U, alignment, spacing) come in step U3.
import { useAddingText, useEditSelection } from "./editStore";

export default function EditPanel({ documentId }: { documentId: string }) {
  const sel = useEditSelection(documentId);
  const adding = useAddingText(documentId);
  return (
    <section className="tool-panel" aria-label="Edit PDF" data-testid="edit-panel">
      <h3 className="tool-panel-title">Edit PDF</h3>
      {adding ? (
        <p data-testid="edit-hint">
          Click on the page to add a line of text, or drag to set the width it wraps at. Esc
          cancels.
        </p>
      ) : sel ? (
        <p data-testid="edit-selection">
          {sel.kind === "text" ? "Text box" : "Image"} on page {sel.page + 1}
          {sel.kind === "text" && <span className="muted">: {sel.label.slice(6)}</span>}
        </p>
      ) : (
        <p className="muted">
          Click text to edit it (Esc or a click elsewhere finishes), or click an image to select it.
        </p>
      )}
    </section>
  );
}
