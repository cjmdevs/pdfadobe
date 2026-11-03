// Kit dialog (B7). Every modal has the same shape: title, scrolling body, footer with the
// actions on the right. A body that has its own action (Reduce File Size, Protect...)
// puts it in <ModalActions>, which renders into the footer next to Cancel, so each dialog
// has exactly one primary button and it is always in the same place.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FooterSlot = createContext<{
  el: HTMLElement | null;
  setHasActions: (on: boolean) => void;
} | null>(null);

export function Modal({
  title,
  onClose,
  children,
  wide,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Footer button text; default "Close", or "Cancel" when the body has actions. */
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [hasActions, setHasActions] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
      </header>
      <FooterSlot.Provider value={{ el: slot, setHasActions }}>
        <div className="modal-body">{children}</div>
      </FooterSlot.Provider>
      <footer className="button-row">
        <button type="button" autoFocus={!hasActions} onClick={onClose}>
          {closeLabel ?? (hasActions ? "Cancel" : "Close")}
        </button>
        <span className="modal-actions" ref={setSlot} />
      </footer>
    </dialog>
  );
}

/** The body's own buttons, shown in the dialog footer (right of Cancel). */
export function ModalActions({ children }: { children: ReactNode }) {
  const ctx = useContext(FooterSlot);
  const setHasActions = ctx?.setHasActions;
  useEffect(() => {
    setHasActions?.(true);
    return () => setHasActions?.(false);
  }, [setHasActions]);
  if (!ctx) return <div className="button-row end">{children}</div>;
  return ctx.el ? createPortal(children, ctx.el) : null;
}
