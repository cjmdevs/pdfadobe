// Signatures panel (Phase 8): every certificate signature in the document, whether its
// signed bytes still match, and whether the document changed after it. No trust check
// (v1): the signer's certificate is not checked against a trust list, so a valid
// signature means "unchanged since signed by this certificate", not "trusted".
import { useEffect, useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { listSignatures, type SignatureInfo } from "../../engine/sign";
import { message } from "./signActions";

export default function SignaturePanel({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const storeId = wb.meta[documentId]?.storeId;
  const [loaded, setState] = useState<
    ({ list: SignatureInfo[]; bytes: Uint8Array } | { error: string }) & { key: string }
  >();
  // Stale until the check for this revision arrives.
  const key = `${documentId}:${storeId}`;
  const state = loaded?.key === key ? loaded : null;

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const bytes = await wb.contentBytes(documentId);
        if (!live) return;
        if (!bytes) {
          setState({ key, error: "Password-protected documents cannot be checked." });
          return;
        }
        const list = await listSignatures(bytes);
        if (live) setState({ key, list, bytes });
      } catch (e) {
        if (live) setState({ key, error: message(e) });
      }
    })();
    return () => {
      live = false;
    };
    // Re-check when the document's bytes change (a new store revision).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const openSigned = (s: SignatureInfo, bytes: Uint8Array) => {
    const name = (wb.meta[documentId]?.name ?? "Document.pdf").replace(/\.pdf$/i, "");
    const part = bytes.slice(0, s.revisionLength);
    wb.openFiles([
      {
        source: { kind: "memory", name: `${name} (signed version ${s.index}).pdf` },
        name: `${name} (signed version ${s.index}).pdf`,
        bytes: part.buffer,
      },
    ]);
  };

  return (
    <section className="signature-panel" aria-label="Signatures" data-testid="signature-panel">
      <h3>Signatures</h3>
      {state === null && <p className="muted">Checking…</p>}
      {state && "error" in state && <p className="error">{state.error}</p>}
      {state && "list" in state && state.list.length === 0 && (
        <p className="muted">This document has no certificate signatures.</p>
      )}
      {state && "list" in state && (
        <ol>
          {state.list.map((s) => (
            <li key={s.index} data-testid="signature-row" className={s.intact ? "ok" : "bad"}>
              <div>
                <strong>{s.signer}</strong>
                {s.time && <span className="muted"> {pdfTime(s.time)}</span>}
              </div>
              <div className="sig-status">
                {s.intact
                  ? s.changedAfter
                    ? "Valid for what was signed. The document was changed after this signature."
                    : "Valid: the document has not been changed since it was signed."
                  : (s.problem ?? "Not valid.")}
              </div>
              {s.reason && <div className="muted">Reason: {s.reason}</div>}
              {s.location && <div className="muted">Location: {s.location}</div>}
              {s.changedAfter && s.intact && (
                <button type="button" onClick={() => openSigned(s, state.bytes)}>
                  View signed version
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="hint">
        Only checks that the signed content is unchanged. Whether the signer&apos;s certificate is
        trusted is not checked here.
      </p>
    </section>
  );
}

/** "D:20261031140509-07'00'" -> "2026-10-31 14:05". */
function pdfTime(t: string): string {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(t);
  if (!m) return t;
  return `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5] ?? "00"}` : ""}`;
}
