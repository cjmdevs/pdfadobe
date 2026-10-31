// Sign with a Certificate (Phase 8): pick a certificate from the Windows store or open a
// .pfx file, add a reason and location, choose how a visible signature looks, and sign
// into a new file "<name>_Signed.pdf" (the original is never changed). PAdES
// (ETSI.CAdES.detached), SHA-256. No timestamp server: the app makes no network calls.
import { useEffect, useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { platform, type CertInfo } from "../../platform";
import { decodePng } from "../../engine/pages/png";
import { message, signToNewFile, type KeySource } from "./signActions";
import { useSavedSignatures } from "./fillSign";

const REASONS = [
  "I am the author of this document",
  "I have reviewed this document",
  "I approve this document",
  "I agree to the terms defined by this document",
];

export function CertSignDialog({
  documentId,
  box,
  field,
  onClose,
}: {
  documentId: string;
  box: { page: number; rect: { x: number; y: number; width: number; height: number } } | null;
  field: string | null;
  onClose(): void;
}) {
  const wb = useWorkbench();
  const [certs, setCerts] = useState<CertInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [pfx, setPfx] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pfxPassword, setPfxPassword] = useState("");
  const [pfxCert, setPfxCert] = useState<CertInfo | null>(null);
  const [reason, setReason] = useState(REASONS[1] ?? "");
  const [location, setLocation] = useState("");
  const [showDate, setShowDate] = useState(true);
  const [imageId, setImageId] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = useSavedSignatures().filter((s) => s.kind === "signature");
  const visible = box !== null || field !== null;

  useEffect(() => {
    let live = true;
    platform.certs.list().then(
      (list) => {
        if (!live) return;
        setCerts(list);
        // The certificate used last time, else the first.
        const last = list.find((c) => c.thumbprint === wb.settings.lastSigningCert);
        const pick = last ?? list[0];
        if (pick) setChoice(pick.thumbprint);
      },
      (e: unknown) => live && setListError(message(e)),
    );
    return () => {
      live = false;
    };
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPfx = async () => {
    const [f] = await platform.pickFiles({ pfx: true });
    if (!f) return;
    setPfx({ name: f.name, bytes: new Uint8Array(f.bytes) });
    setPfxCert(null);
    setChoice("pfx");
  };

  const openPfx = async () => {
    if (!pfx) return;
    setBusy(true);
    try {
      setPfxCert(await platform.certs.pfxOpen(pfx.bytes, pfxPassword));
    } catch (e) {
      wb.toast(message(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const source = (): KeySource | null => {
    if (choice === "pfx") {
      return pfx && pfxCert
        ? { kind: "pfx", cert: pfxCert, pfx: pfx.bytes, password: pfxPassword }
        : null;
    }
    const cert = certs?.find((c) => c.thumbprint === choice);
    return cert ? { kind: "store", cert } : null;
  };

  const sign = async () => {
    const src = source();
    if (!src) return;
    setBusy(true);
    try {
      const image = imageId ? decodePng(await platform.signatures.read(imageId)) : null;
      const path = await signToNewFile(
        wb,
        documentId,
        {
          ...(box ? { box } : {}),
          ...(field ? { field } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          appearance: { image, showDate },
        },
        src,
      );
      if (!path) return;
      if (src.kind === "store") wb.updateSettings({ lastSigningCert: src.cert.thumbprint });
      onClose();
      wb.toast("Signed. Saved as a new file; the original is unchanged.");
      await wb.openPaths([path]);
    } catch (e) {
      wb.toast(`Signing failed: ${message(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const ready = source() !== null && !busy;
  return (
    <div className="cert-sign" data-testid="cert-sign">
      <p className="hint">
        {field
          ? `Signs the field "${field}".`
          : box
            ? `Signs with a visible signature on page ${box.page + 1}.`
            : "Signs without a visible signature."}{" "}
        The signed copy is saved as a new file next to the original.
      </p>
      <fieldset disabled={busy}>
        <legend>Certificate</legend>
        {certs === null && !listError && <p className="muted">Looking for certificates…</p>}
        {listError && <p className="error">{listError}</p>}
        {certs?.length === 0 && (
          <p className="muted">
            No signing certificate in your Windows certificate store. Use a .pfx file instead.
          </p>
        )}
        {certs?.map((c) => (
          <label key={c.thumbprint} className="cert-row">
            <input
              type="radio"
              name="cert"
              checked={choice === c.thumbprint}
              onChange={() => setChoice(c.thumbprint)}
            />
            <span>
              <strong>{c.name}</strong>
              <span className="muted">
                {" "}
                Issued by {c.issuer}, expires {c.expires}
              </span>
            </span>
          </label>
        ))}
        <label className="cert-row">
          <input
            type="radio"
            name="cert"
            checked={choice === "pfx"}
            onChange={() => setChoice("pfx")}
          />
          <span>A certificate file (.pfx)</span>
        </label>
        {choice === "pfx" && (
          <div className="pfx">
            <button type="button" onClick={() => void pickPfx()}>
              {pfx ? `File: ${pfx.name}` : "Choose .pfx file…"}
            </button>
            {pfx && (
              <>
                <label>
                  Password{" "}
                  <input
                    type="password"
                    autoComplete="off"
                    value={pfxPassword}
                    onChange={(e) => {
                      setPfxPassword(e.target.value);
                      setPfxCert(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && void openPfx()}
                  />
                </label>
                <button type="button" onClick={() => void openPfx()}>
                  Open
                </button>
              </>
            )}
            {pfxCert && (
              <p>
                <strong>{pfxCert.name}</strong>{" "}
                <span className="muted">
                  Issued by {pfxCert.issuer}, expires {pfxCert.expires}
                </span>
              </p>
            )}
          </div>
        )}
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Details</legend>
        <label>
          Reason{" "}
          <input
            list="sign-reasons"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
          <datalist id="sign-reasons">
            {REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label>
          Location{" "}
          <input value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} />
        </label>
      </fieldset>

      {visible && (
        <fieldset disabled={busy}>
          <legend>Appearance</legend>
          <label>
            <input
              type="checkbox"
              checked={showDate}
              onChange={(e) => setShowDate(e.target.checked)}
            />{" "}
            Show the date
          </label>
          <label>
            Left side{" "}
            <select value={imageId} onChange={(e) => setImageId(e.target.value)}>
              <option value="">My name</option>
              {saved.map((s, i) => (
                <option key={s.id} value={s.id}>
                  Saved signature {saved.length > 1 ? i + 1 : ""}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      )}

      <div className="button-row">
        <button type="button" className="primary" disabled={!ready} onClick={() => void sign()}>
          {busy ? "Signing…" : "Sign and save as a new file"}
        </button>
      </div>
    </div>
  );
}
