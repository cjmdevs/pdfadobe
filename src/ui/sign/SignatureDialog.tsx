// Add Signature / Add Initials (Phase 8): type (script fonts), draw (mouse or pen), or
// import an image; saved per user (Windows: DPAPI-encrypted) and then placed. Also lists
// the saved ones so they can be deleted.
import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../../app/workbench";
import { platform, type SavedSignature, type SignatureKind } from "../../platform";
import {
  cropToPng,
  imageSignature,
  INK,
  SCRIPT_FONTS,
  typedSignature,
  type ScriptFont,
} from "./signatureArt";
import { savedSignatures, useSavedSignatures } from "./fillSign";
import { placeRequest } from "./placeRequest";

type Mode = "type" | "draw" | "image";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SignatureDialog({
  kind: initialKind,
  documentId,
  onClose,
}: {
  kind: SignatureKind;
  documentId: string | null;
  onClose(): void;
}) {
  const wb = useWorkbench();
  const [kind, setKind] = useState<SignatureKind>(initialKind);
  const [mode, setMode] = useState<Mode>("type");
  const [text, setText] = useState(() =>
    initialKind === "initials" ? initialsOf(wb.author) : wb.author,
  );
  const [font, setFont] = useState<ScriptFont>("dancing");
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<DrawPadHandle>(null);
  const list = useSavedSignatures();

  // Preview of an imported image after its background was removed.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const save = async () => {
    setBusy(true);
    try {
      let png: Uint8Array;
      if (mode === "type") {
        if (!text.trim()) throw new Error("type your name first");
        png = await typedSignature(text.trim(), font);
      } else if (mode === "draw") {
        const c = pad.current?.canvas();
        if (!c || pad.current?.empty()) throw new Error("draw your signature first");
        png = await cropToPng(c);
      } else {
        if (!image) throw new Error("choose an image first");
        png = image;
      }
      const sig = await platform.signatures.add(kind, png);
      await savedSignatures.refresh();
      onClose();
      if (documentId) placeRequest.set({ documentId, signature: sig });
    } catch (e) {
      wb.toast(`Could not save the ${kind}: ${message(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async () => {
    const files = await platform.pickFiles({ pictures: true });
    const f = files[0];
    if (!f) return;
    try {
      const png = await imageSignature(new Uint8Array(f.bytes));
      setImage(png);
      setPreview(URL.createObjectURL(new Blob([png.slice().buffer], { type: "image/png" })));
    } catch (e) {
      wb.toast(`That image could not be used: ${message(e)}`, "error");
    }
  };

  return (
    <div className="signature-dialog" data-testid="signature-dialog">
      <div className="sig-kind">
        {(["signature", "initials"] as const).map((k) => (
          <label key={k}>
            <input type="radio" name="sig-kind" checked={kind === k} onChange={() => setKind(k)} />{" "}
            {k === "signature" ? "Signature" : "Initials"}
          </label>
        ))}
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["type", "Type"],
            ["draw", "Draw"],
            ["image", "Image"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "type" && (
        <div className="sig-type">
          <label>
            {kind === "initials" ? "Initials" : "Name"}{" "}
            <input
              aria-label="Signature text"
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="sig-fonts" role="radiogroup" aria-label="Style">
            {SCRIPT_FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={font === f.id}
                aria-label={f.label}
                title={f.label}
                className={font === f.id ? "selected" : ""}
                style={{ fontFamily: f.family, color: INK }}
                onClick={() => setFont(f.id)}
              >
                {text || f.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === "draw" && <DrawPad ref={pad} />}
      {mode === "image" && (
        <div className="sig-image">
          <button type="button" onClick={() => void pickImage()}>
            Choose image…
          </button>
          <p className="hint">
            A photo or scan of a signature on white paper. The paper is made see-through.
          </p>
          {preview && <img src={preview} alt="Imported signature" className="sig-preview" />}
        </div>
      )}

      <div className="button-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          {documentId ? "Save and place" : "Save"}
        </button>
      </div>

      <SavedList list={list} />
      <p className="hint">
        Saved signatures stay on this computer, encrypted for your Windows account.
      </p>
    </div>
  );
}

function SavedList({ list }: { list: SavedSignature[] }) {
  const wb = useWorkbench();
  if (!list.length) return null;
  return (
    <div className="sig-saved">
      <h4>Saved</h4>
      <ul>
        {list.map((s) => (
          <li key={s.id}>
            <SavedThumb sig={s} />
            <span>{s.kind === "initials" ? "Initials" : "Signature"}</span>
            <button
              type="button"
              onClick={() =>
                void platform.signatures
                  .remove(s.id)
                  .then(() => savedSignatures.refresh())
                  .catch((e: unknown) => wb.toast(`Could not delete it: ${message(e)}`, "error"))
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SavedThumb({ sig }: { sig: SavedSignature }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    void platform.signatures
      .read(sig.id)
      .then((b) => {
        if (!live) return;
        u = URL.createObjectURL(new Blob([b.slice().buffer], { type: "image/png" }));
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [sig.id]);
  return url ? <img src={url} alt="" className="sig-thumb" /> : <span className="sig-thumb" />;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
}

interface DrawPadHandle {
  canvas(): HTMLCanvasElement | null;
  empty(): boolean;
}

/** A drawing area: mouse, touch or pen (pen pressure widens the line). */
function DrawPad({ ref }: { ref: React.Ref<DrawPadHandle> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const h: DrawPadHandle = { canvas: () => canvas.current, empty: () => !drawn.current };
    if (typeof ref === "function") ref(h);
    else if (ref) (ref as React.RefObject<DrawPadHandle | null>).current = h;
  }, [ref]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
  };
  return (
    <div className="sig-draw">
      <canvas
        ref={canvas}
        width={900}
        height={280}
        aria-label="Draw your signature here"
        data-testid="signature-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = at(e);
        }}
        onPointerMove={(e) => {
          const from = last.current;
          if (!from) return;
          const to = at(e);
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
          ctx.strokeStyle = INK;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.lineWidth = 2 + pressure * 5;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
          last.current = to;
          drawn.current = true;
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      />
      <button type="button" onClick={clear}>
        Clear
      </button>
    </div>
  );
}
