// Edit PDF (B3 stage 2): the Link tool's panel (Acrobat's "Create Link" box). A link
// opens a web or email address, or goes to a page of this document; it is invisible
// or has a visible rectangle in a colour. Save, Remove and Cancel; "Remove all web
// links" clears every web link in the document (one undo step).
import { useState } from "react";
import type { LinkTarget } from "../../engine/edit/links";
import { useWorkbench } from "../../app/workbench";
import { removeAllWebLinks, removeLink, saveLink } from "./editActions";
import { linkMode, usePageLinks, type LinkEditing } from "./editStore";

const toHex = (c: [number, number, number]) =>
  `#${c
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const fromHex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

export function LinkPanel({
  documentId,
  current,
  pageCount,
}: {
  documentId: string;
  current: LinkEditing | null;
  pageCount: number;
}) {
  const wb = useWorkbench();
  const busy = wb.busy !== null;
  return (
    <section className="tool-panel" aria-label="Edit PDF" data-testid="edit-panel">
      <h3 className="tool-panel-title">Link</h3>
      {current ? (
        <LinkForm
          key={`${current.page}:${current.ref ?? "new"}:${current.rect.l}:${current.rect.t}`}
          documentId={documentId}
          link={current}
          pageCount={pageCount}
        />
      ) : (
        <p className="small" data-testid="edit-target">
          Drag a rectangle on the page to add a link, or click a link to change or remove it.
        </p>
      )}
      <div className="format-row">
        <button
          type="button"
          data-testid="remove-web-links"
          disabled={busy}
          onClick={() => void removeAllWebLinks(wb, documentId)}
        >
          Remove all web links
        </button>
        <button type="button" onClick={() => linkMode.set(documentId, false)}>
          Done
        </button>
      </div>
    </section>
  );
}

function LinkForm({
  documentId,
  link,
  pageCount,
}: {
  documentId: string;
  link: LinkEditing;
  pageCount: number;
}) {
  const wb = useWorkbench();
  const links = usePageLinks(documentId, link.page);
  const old = link.ref ? links?.find((l) => l.ref === link.ref) : undefined;
  const oldTarget = old && old.target.kind !== "other" ? old.target : null;
  const [kind, setKind] = useState<LinkTarget["kind"]>(oldTarget?.kind ?? "uri");
  const [uri, setUri] = useState(oldTarget?.kind === "uri" ? oldTarget.uri : "");
  const [page, setPage] = useState(oldTarget?.kind === "page" ? oldTarget.page + 1 : 1);
  const [visible, setVisible] = useState((old?.width ?? 0) > 0);
  const [color, setColor] = useState(toHex(old?.color ?? [0, 0, 1]));
  const busy = wb.busy !== null;

  const save = async () => {
    const target: LinkTarget =
      kind === "uri"
        ? { kind: "uri", uri }
        : { kind: "page", page: Math.min(pageCount, Math.max(1, page)) - 1 };
    const ok = await saveLink(wb, documentId, link, {
      target,
      width: visible ? 1 : 0,
      color: fromHex(color),
    });
    if (ok) linkMode.setCurrent(documentId, null);
  };

  return (
    <form
      data-testid="link-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="small">{link.ref ? "Change this link." : "New link."}</p>
      <fieldset className="format-box">
        <legend>Link action</legend>
        <label className="format-row format-check">
          <input
            type="radio"
            name="link-kind"
            checked={kind === "uri"}
            onChange={() => setKind("uri")}
          />
          <span>Open a web page or email address</span>
        </label>
        {kind === "uri" && (
          <input
            type="text"
            aria-label="Web address"
            placeholder="https://… or name@example.com"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
          />
        )}
        <label className="format-row format-check">
          <input
            type="radio"
            name="link-kind"
            checked={kind === "page"}
            onChange={() => setKind("page")}
          />
          <span>Go to a page in this document</span>
        </label>
        {kind === "page" && (
          <label className="format-row">
            <span>Page</span>
            <input
              type="number"
              aria-label="Page number"
              min={1}
              max={pageCount}
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            />
            <span className="small muted">of {pageCount}</span>
          </label>
        )}
      </fieldset>
      <fieldset className="format-box">
        <legend>Appearance</legend>
        <label className="format-row format-check">
          <input
            type="checkbox"
            data-testid="link-visible"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          <span>Visible rectangle</span>
        </label>
        {visible && (
          <label className="format-row">
            <span>Colour</span>
            <input
              type="color"
              aria-label="Link colour"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        )}
      </fieldset>
      <div className="format-row">
        <button type="submit" data-testid="link-save" disabled={busy}>
          {link.ref ? "Save link" : "Add link"}
        </button>
        {link.ref && (
          <button
            type="button"
            data-testid="link-remove"
            disabled={busy}
            onClick={() => {
              const ref = link.ref;
              if (!ref) return;
              void removeLink(wb, documentId, link.page, ref).then(
                (ok) => ok && linkMode.setCurrent(documentId, null),
              );
            }}
          >
            Remove link
          </button>
        )}
        <button type="button" onClick={() => linkMode.setCurrent(documentId, null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
