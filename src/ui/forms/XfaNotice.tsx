// XFA-only forms (Phase 6): a dynamic XFA form has no AcroForm fields, only a template
// that needs Adobe's XFA engine (our PDFium has none). Instead of a blank "please wait"
// page with nothing to fill, say so plainly and offer to open the file in Acrobat.
import { useEffect, useState } from "react";
import { pageOp } from "../../app/pages";
import { useWorkbench } from "../../app/workbench";
import { PlatformError, platform } from "../../platform";

export function XfaNotice({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const m = wb.meta[documentId];
  const storeId = m?.storeId;
  const [xfaOnly, setXfaOnly] = useState(false);

  useEffect(() => {
    let live = true;
    void wb.docBytes(documentId).then(async (bytes) => {
      if (!bytes || !live) return;
      const kind = await pageOp("formKind", bytes).catch(() => null);
      if (live) setXfaOnly(kind === "xfa-only");
    });
    return () => {
      live = false;
    };
    // Once per document in the store (an edit gives the tab a new id, same document).
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!xfaOnly || !m) return null;
  const path = m.source.kind === "path" ? m.source.path : null;
  const open = async () => {
    if (!path) return;
    try {
      await platform.openInAcrobat(path);
    } catch (e) {
      wb.toast(
        e instanceof PlatformError && e.kind === "acrobatMissing"
          ? "Adobe Acrobat or Acrobat Reader is not installed on this computer."
          : `Could not open Acrobat: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  };
  return (
    <div className="xfa-notice" role="alert" data-testid="xfa-notice">
      <p>
        <strong>This form only works in Adobe Acrobat.</strong> It is an XFA form (Adobe LiveCycle
        Designer): its fields live in an XFA template that PDF Workbench cannot show or fill. Open
        it in Acrobat or Acrobat Reader to fill it.
      </p>
      <button type="button" className="primary" disabled={!path} onClick={() => void open()}>
        Open in Acrobat
      </button>
      {!path && <span className="forms-page"> Save the file first.</span>}
    </div>
  );
}
