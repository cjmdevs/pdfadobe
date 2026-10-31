// Certificate signing actions (Phase 8): sign the current document into a new file
// "<name>_Signed.pdf" beside the original (which is never changed) and open it.
import type { WorkbenchApi } from "../../app/workbench";
import { dirName, platform, safeFileName, type CertInfo } from "../../platform";
import { PdfObjects } from "../../engine/redact/objects";
import {
  emptySignatureFields,
  signPdf,
  type CertSigner,
  type SignRequest,
} from "../../engine/sign";

const stem = (name: string) => name.replace(/\.pdf$/i, "");
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Where the private key lives: the Windows store, or a .pfx opened for this signing. */
export type KeySource =
  | { kind: "store"; cert: CertInfo }
  | { kind: "pfx"; cert: CertInfo; pfx: Uint8Array; password: string };

export function signerFor(src: KeySource): CertSigner {
  return {
    certificates: src.cert.chain,
    sign: (data) =>
      src.kind === "store"
        ? platform.certs.sign(src.cert.thumbprint, data)
        : platform.certs.pfxSign(src.pfx, src.password, data),
  };
}

/** Signs and saves a new file; returns its path (null when the user cancelled). */
export async function signToNewFile(
  wb: WorkbenchApi,
  documentId: string,
  req: Omit<SignRequest, "signer">,
  src: KeySource,
): Promise<string | null> {
  const m = wb.meta[documentId];
  if (!m) return null;
  const bytes = await wb.docBytes(documentId);
  if (!bytes) {
    throw new Error("this document is password-protected: remove its security, then sign");
  }
  const signed = await signPdf(platform.qpdf, bytes, { ...req, signer: signerFor(src) });
  const name = safeFileName(`${stem(m.name)}_Signed.pdf`);
  let path: string | null;
  if (m.source.kind === "path")
    path = await platform.writeNewFile(dirName(m.source.path), name, signed);
  else {
    path = await platform.pickSavePath(name);
    if (path) await platform.saveAs(path, null, signed);
  }
  return path;
}

/** A click on a signature field outside Prepare Form: sign it, or show the signatures. */
export async function clickSignatureField(wb: WorkbenchApi, documentId: string, name: string) {
  try {
    const bytes = await wb.docBytes(documentId);
    if (!bytes) {
      wb.toast("This document is password-protected. Remove its security to sign it.", "error");
      return;
    }
    const empty = emptySignatureFields(await PdfObjects.read(platform.qpdf, bytes));
    if (empty.includes(name)) {
      wb.setDialog({ kind: "certSign", documentId, box: null, field: name });
    } else {
      wb.setActiveTool(documentId, "certificates");
    }
  } catch (e) {
    wb.toast(`Could not read the signature field: ${message(e)}`, "error");
  }
}
