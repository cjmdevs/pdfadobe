// Protect with Passwords / Remove Security (Phase 8, qpdf, AES-256 only). Both save a
// new file beside the original ("<name>_Protected.pdf" / "<name>_Unprotected.pdf"),
// which is never changed, and open it.
import { useState } from "react";
import { useWorkbench, type WorkbenchApi } from "../../app/workbench";
import { dirName, platform, safeFileName } from "../../platform";
import {
  protectPdf,
  removeSecurity,
  type ChangesAllowed,
  type PrintAllowed,
} from "../../engine/security";
import { listSignatures } from "../../engine/sign";
import { message } from "./signActions";

const stem = (name: string) => name.replace(/\.pdf$/i, "");

async function saveNew(wb: WorkbenchApi, documentId: string, suffix: string, bytes: Uint8Array) {
  const m = wb.meta[documentId];
  if (!m) return null;
  const name = safeFileName(`${stem(m.name)}_${suffix}.pdf`);
  if (m.source.kind === "path") return platform.writeNewFile(dirName(m.source.path), name, bytes);
  const path = await platform.pickSavePath(name);
  if (path) await platform.saveAs(path, null, bytes);
  return path;
}

export function ProtectDialog({ documentId, onClose }: { documentId: string; onClose(): void }) {
  const wb = useWorkbench();
  const [openPw, setOpenPw] = useState("");
  const [openPw2, setOpenPw2] = useState("");
  const [permPw, setPermPw] = useState("");
  const [permPw2, setPermPw2] = useState("");
  const [useOpen, setUseOpen] = useState(true);
  const [usePerm, setUsePerm] = useState(false);
  const [print, setPrint] = useState<PrintAllowed>("full");
  const [changes, setChanges] = useState<ChangesAllowed>("none");
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);

  const problem =
    !useOpen && !usePerm
      ? "Choose an open password, a permissions password, or both."
      : useOpen && !openPw
        ? "Type the open password."
        : useOpen && openPw !== openPw2
          ? "The two open passwords do not match."
          : usePerm && !permPw
            ? "Type the permissions password."
            : usePerm && permPw !== permPw2
              ? "The two permissions passwords do not match."
              : useOpen && usePerm && openPw === permPw
                ? "The two passwords must be different."
                : null;

  const run = async () => {
    setBusy(true);
    try {
      const bytes = await wb.docBytes(documentId);
      if (!bytes) throw new Error("this document is already password-protected");
      const signed = (await listSignatures(bytes)).length > 0;
      if (
        signed &&
        !(await wb.confirm({
          title: "Signed document",
          message:
            "This document has certificate signatures. The protected copy is rewritten, so those signatures will no longer be valid in it. Continue?",
          ok: "Protect anyway",
        }))
      )
        return;
      const out = await protectPdf(platform.qpdf, bytes, {
        openPassword: useOpen ? openPw : "",
        permissionsPassword: usePerm ? permPw : "",
        print,
        changes,
        copy,
      });
      const path = await saveNew(wb, documentId, "Protected", out);
      if (!path) return;
      onClose();
      wb.toast("Saved a protected copy (AES-256). The original is unchanged.");
      await wb.openPaths([path]);
    } catch (e) {
      wb.toast(`Could not protect it: ${message(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="protect" data-testid="protect">
      <fieldset disabled={busy}>
        <label>
          <input type="checkbox" checked={useOpen} onChange={(e) => setUseOpen(e.target.checked)} />{" "}
          <strong>Require a password to open the document</strong>
        </label>
        {useOpen && (
          <div className="pw-pair">
            <input
              type="password"
              aria-label="Open password"
              placeholder="Open password"
              autoComplete="new-password"
              value={openPw}
              onChange={(e) => setOpenPw(e.target.value)}
            />
            <input
              type="password"
              aria-label="Confirm open password"
              placeholder="Type it again"
              autoComplete="new-password"
              value={openPw2}
              onChange={(e) => setOpenPw2(e.target.value)}
            />
          </div>
        )}
        <p className="hint">
          This is the real protection: the content is encrypted (AES-256) and cannot be read without
          the password. If the password is lost, the document cannot be opened. Send it to the
          recipient separately (by phone, not in the same email).
        </p>
      </fieldset>

      <fieldset disabled={busy}>
        <label>
          <input type="checkbox" checked={usePerm} onChange={(e) => setUsePerm(e.target.checked)} />{" "}
          <strong>Restrict printing, changes and copying</strong>
        </label>
        <p className="warning" role="note" data-testid="permissions-warning">
          A permissions password is not real protection. Anyone who can open the document can remove
          these restrictions with free tools in seconds. Do not rely on it to keep anything
          confidential: use an open password for that.
        </p>
        {usePerm && (
          <>
            <div className="pw-pair">
              <input
                type="password"
                aria-label="Permissions password"
                placeholder="Permissions password"
                autoComplete="new-password"
                value={permPw}
                onChange={(e) => setPermPw(e.target.value)}
              />
              <input
                type="password"
                aria-label="Confirm permissions password"
                placeholder="Type it again"
                autoComplete="new-password"
                value={permPw2}
                onChange={(e) => setPermPw2(e.target.value)}
              />
            </div>
            <label>
              Printing{" "}
              <select value={print} onChange={(e) => setPrint(e.target.value as PrintAllowed)}>
                <option value="full">Allowed</option>
                <option value="low">Low resolution only</option>
                <option value="none">Not allowed</option>
              </select>
            </label>
            <label>
              Changes{" "}
              <select
                value={changes}
                onChange={(e) => setChanges(e.target.value as ChangesAllowed)}
              >
                <option value="none">None</option>
                <option value="assembly">Inserting, deleting and rotating pages</option>
                <option value="form">Filling in forms and signing</option>
                <option value="annotate">Commenting, filling in forms and signing</option>
                <option value="all">Any except extracting pages</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />{" "}
              Allow copying text and images
            </label>
          </>
        )}
      </fieldset>

      {problem && <p className="muted">{problem}</p>}
      <div className="button-row">
        <button
          type="button"
          className="primary"
          disabled={busy || problem !== null}
          onClick={() => void run()}
        >
          {busy ? "Protecting…" : "Save a protected copy"}
        </button>
      </div>
    </div>
  );
}

export function RemoveSecurityDialog({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose(): void;
}) {
  const wb = useWorkbench();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const bytes = await wb.fileBytes(documentId);
      if (!bytes) throw new Error("the document's bytes are not available");
      const out = await removeSecurity(platform.qpdf, bytes, pw);
      const path = await saveNew(wb, documentId, "Unprotected", out);
      if (!path) return;
      onClose();
      wb.toast("Saved a copy without security. The original is unchanged.");
      await wb.openPaths([path]);
    } catch (e) {
      wb.toast(`Could not remove security: ${message(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="protect" data-testid="remove-security">
      <p>
        Saves a copy with no passwords and no restrictions. Type the document&apos;s open password
        or its permissions password.
      </p>
      <input
        type="password"
        aria-label="Password"
        autoComplete="off"
        value={pw}
        disabled={busy}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && pw && void run()}
      />
      <div className="button-row">
        <button type="button" className="primary" disabled={busy || !pw} onClick={() => void run()}>
          {busy ? "Removing…" : "Save an unprotected copy"}
        </button>
      </div>
    </div>
  );
}
