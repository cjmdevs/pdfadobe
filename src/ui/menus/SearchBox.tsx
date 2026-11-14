// The command search with the right tool context for the active tab (or none).
import { useLoadedDocumentId } from "../../app/Commands";
import { useDocToolContext, useNoDocToolContext } from "../../tools/useToolContext";
import { Guard } from "../Guard";
import { Modal } from "../kit/Dialog";
import { CommandSearch } from "./CommandSearch";

function DocSearch({ documentId, onDone }: { documentId: string; onDone?: () => void }) {
  const ctx = useDocToolContext(documentId);
  return <CommandSearch ctx={ctx} autoFocus={!!onDone} {...(onDone ? { onDone } : {})} />;
}

function NoDocSearch({ onDone }: { onDone?: () => void }) {
  const ctx = useNoDocToolContext();
  return <CommandSearch ctx={ctx} autoFocus={!!onDone} {...(onDone ? { onDone } : {})} />;
}

/** In the top bar. */
export function SearchBox({ documentId }: { documentId: string | null }) {
  return documentId ? (
    <Guard resetKey={documentId} fallback={<NoDocSearch />}>
      <DocSearch key={documentId} documentId={documentId} />
    </Guard>
  ) : (
    <NoDocSearch />
  );
}

/** Alt+Q when the top bar has no search box (it was removed or is in the overflow menu). */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const loadedId = useLoadedDocumentId();
  return (
    <Modal title="Search tools, commands and settings" onClose={onClose}>
      {loadedId ? (
        <Guard resetKey={loadedId} fallback={<NoDocSearch onDone={onClose} />}>
          <DocSearch documentId={loadedId} onDone={onClose} />
        </Guard>
      ) : (
        <NoDocSearch onDone={onClose} />
      )}
    </Modal>
  );
}
