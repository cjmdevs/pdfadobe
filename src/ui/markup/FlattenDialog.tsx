// Flatten (Phase 3): which markup to draw into the pages. The result is a new file.
import { useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { flattenToNewFile } from "./markupFiles";

export function FlattenBody({
  documentId,
  page,
  selectedIds,
  onClose,
}: {
  documentId: string;
  page: number;
  selectedIds: string[];
  onClose: () => void;
}) {
  const wb = useWorkbench();
  const [scope, setScope] = useState<"selected" | "page" | "document">(
    selectedIds.length ? "selected" : "document",
  );
  const run = () => {
    onClose();
    void flattenToNewFile(
      wb,
      documentId,
      scope === "selected" ? { ids: selectedIds } : scope === "page" ? { pages: [page] } : {},
    );
  };
  return (
    <form
      className="flatten-form"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <p>
        Flattening draws comments into the page so they can no longer be edited or removed. A new
        file is created; this document is not changed. Form fields are left as they are.
      </p>
      <fieldset>
        <legend>Flatten</legend>
        <label>
          <input
            type="radio"
            name="flatten-scope"
            checked={scope === "selected"}
            disabled={!selectedIds.length}
            onChange={() => setScope("selected")}
          />{" "}
          Selected comments ({selectedIds.length})
        </label>
        <label>
          <input
            type="radio"
            name="flatten-scope"
            checked={scope === "page"}
            onChange={() => setScope("page")}
          />{" "}
          All comments on page {page + 1}
        </label>
        <label>
          <input
            type="radio"
            name="flatten-scope"
            checked={scope === "document"}
            onChange={() => setScope("document")}
          />{" "}
          All comments in the document
        </label>
      </fieldset>
      <div className="button-row">
        <button type="submit" className="primary">
          Flatten to new file
        </button>
      </div>
    </form>
  );
}
