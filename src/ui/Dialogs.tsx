// Modal dialogs: open errors, document properties, keyboard shortcuts, and (Phase 2)
// page operations, Combine Files and unsaved changes (PageOpsDialogs.tsx).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDocumentState } from "@embedpdf/core/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import type { PdfMetadataObject } from "@embedpdf/models";
import { SHORTCUTS, displayKey } from "../app/shortcuts";
import { useNav } from "../app/useNav";
import { describeOpenError, useForgetRecent, useWorkbench } from "../app/workbench";
import { CustomizeDialog } from "./CustomizeDialog";
import { StampPicker } from "./markup/StampPicker";
import { TickmarkLibrary } from "./flyer/TickmarkLibrary";
import { StampDetails } from "./flyer/StampDetails";
import { SettingsBody } from "./SettingsDialog";
import { FlattenBody } from "./markup/FlattenDialog";
import { BatchOcr } from "./scan/BatchOcr";
import {
  CombineDialog,
  ConfirmDialog,
  PageOpDialogView,
  QuitDialog,
  UnsavedDialog,
} from "./PageOpsDialogs";
import {
  decodePermissions,
  formatFileSize,
  formatPageSize,
  type PermissionName,
} from "../engine/properties";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
      </header>
      <div className="modal-body">{children}</div>
      <footer className="button-row">
        <button type="button" className="primary" autoFocus onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  );
}

export function Dialogs() {
  const { confirmRequest } = useWorkbench();
  return (
    <>
      <MainDialog />
      {confirmRequest && <ConfirmDialog req={confirmRequest} />}
    </>
  );
}

function MainDialog() {
  const { dialog, setDialog } = useWorkbench();
  if (!dialog) return null;
  const close = () => setDialog(null);
  switch (dialog.kind) {
    case "flatten":
      return (
        <Modal title="Flatten comments" onClose={close}>
          <FlattenBody
            documentId={dialog.documentId}
            page={dialog.page}
            selectedIds={dialog.selectedIds}
            onClose={close}
          />
        </Modal>
      );
    case "settings":
      return (
        <Modal title="Settings" onClose={close}>
          <SettingsBody />
        </Modal>
      );
    case "stamps":
      return (
        <Modal title="Custom Stamps" onClose={close}>
          <StampPicker />
        </Modal>
      );
    case "tickmarks":
      return (
        <Modal title="Workpaper library" onClose={close}>
          <TickmarkLibrary />
        </Modal>
      );
    case "workpaperStamp":
      return (
        <Modal title="Stamp details" onClose={close}>
          <StampDetails
            documentId={dialog.documentId}
            templateId={dialog.templateId}
            onClose={close}
          />
        </Modal>
      );
    case "openError":
      return (
        <OpenErrorDialog
          path={dialog.path}
          message={describeOpenError(dialog.error)}
          kind={dialog.error.kind}
          onClose={close}
        />
      );
    case "properties":
      return <PropertiesDialog documentId={dialog.documentId} onClose={close} />;
    case "shortcuts":
      return <ShortcutsDialog onClose={close} />;
    case "customize":
      return <CustomizeDialog onClose={close} />;
    case "unsaved":
      return <UnsavedDialog documentIds={dialog.documentIds} then={dialog.then} onClose={close} />;
    case "quit":
      return <QuitDialog docs={dialog.docs} onClose={close} />;
    case "pageOp":
      return (
        <PageOpDialogView
          op={dialog.op}
          documentId={dialog.documentId}
          pages={dialog.pages}
          onClose={close}
        />
      );
    case "combine":
      return <CombineDialog startWith={dialog.documentId} onClose={close} />;
    case "batchOcr":
      return (
        <Modal title="Recognize Text in a Folder" onClose={close}>
          <BatchOcr />
        </Modal>
      );
  }
}

function OpenErrorDialog({
  path,
  message,
  kind,
  onClose,
}: {
  path: string;
  message: string;
  kind: string;
  onClose: () => void;
}) {
  const forget = useForgetRecent();
  const { openPaths } = useWorkbench();
  return (
    <Modal title="Can't open file" onClose={onClose}>
      {path && <p className="path">{path}</p>}
      <p data-testid="open-error-message" data-kind={kind}>
        {message}
      </p>
      <div className="button-row">
        {(kind === "locked" || kind === "network") && (
          <button
            type="button"
            onClick={() => {
              onClose();
              void openPaths([path]);
            }}
          >
            Try again
          </button>
        )}
        {kind === "notFound" && path && (
          <button
            type="button"
            onClick={() => {
              forget(path);
              onClose();
            }}
          >
            Remove from recent files
          </button>
        )}
      </div>
    </Modal>
  );
}

const PERMISSION_LABELS: Record<PermissionName, string> = {
  print: "Printing",
  printHighQuality: "High-quality printing",
  modifyContents: "Changing the document",
  copyContents: "Content copying",
  modifyAnnotations: "Commenting",
  fillForms: "Filling form fields",
  extractForAccessibility: "Content copying for accessibility",
  assembleDocument: "Document assembly",
};

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleString() : "—";
}

function PropertiesDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { engine, meta } = useWorkbench();
  const doc = useDocumentState(documentId)?.document ?? null;
  const nav = useNav(documentId);
  const { rotation } = useRotate(documentId);
  const [md, setMd] = useState<PdfMetadataObject | null>(null);
  const m = meta[documentId];

  useEffect(() => {
    if (!doc) return;
    let live = true;
    engine.getMetadata(doc).wait(
      (r) => live && setMd(r),
      () => live && setMd(null),
    );
    return () => {
      live = false;
    };
  }, [engine, doc]);

  if (!doc || !m) return null;
  const page = doc.pages[nav.page];
  const perms = decodePermissions(doc.permissions, doc.isEncrypted);
  const rows: [string, ReactNode][] = [
    ["File", m.source.kind === "path" ? m.source.path : m.name],
    ["Title", md?.title || "—"],
    ["Author", md?.author || "—"],
    ["Subject", md?.subject || "—"],
    ["Keywords", md?.keywords || "—"],
    ["Created", fmtDate(md?.creationDate ?? null)],
    ["Modified", fmtDate(md?.modificationDate ?? null)],
    ["Application", md?.creator || "—"],
    ["PDF producer", md?.producer || "—"],
    ["PDF version", m.pdfVersion ?? "Unknown"],
    ["File size", formatFileSize(m.fileSize)],
    ["Page count", String(doc.pageCount)],
    [
      "Page size",
      page ? `${formatPageSize(page.size.width, page.size.height)} (page ${nav.page + 1})` : "—",
    ],
    ["Fast web view", m.linearized ? "Yes" : "No"],
  ];
  return (
    <Modal title="Document Properties" onClose={onClose}>
      <h3>Description</h3>
      <dl className="props" data-testid="properties">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd data-field={k}>{v}</dd>
          </div>
        ))}
      </dl>
      <h3>Security</h3>
      <dl className="props" data-testid="security">
        <div>
          <dt>Security method</dt>
          <dd data-field="Security method">
            {doc.isEncrypted ? "Password security" : "No security"}
          </dd>
        </div>
        {doc.isEncrypted &&
          (Object.keys(PERMISSION_LABELS) as PermissionName[]).map((k) => (
            <div key={k}>
              <dt>{PERMISSION_LABELS[k]}</dt>
              <dd>{perms[k] ? "Allowed" : "Not allowed"}</dd>
            </div>
          ))}
      </dl>
      {rotation !== 0 && (
        <p className="muted small">The view is rotated; this does not change the file.</p>
      )}
    </Modal>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <table className="shortcuts">
        <thead>
          <tr>
            <th>Action</th>
            <th>Keys</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.command}>
              <td>{s.label}</td>
              <td>
                {s.keys.map((k) => (
                  <kbd key={k}>{displayKey(k)}</kbd>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
