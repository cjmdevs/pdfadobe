// Panning (B8): the Hand tool, or holding Space, turns a drag on the page into scrolling
// in both directions, like Acrobat. Space only pans while the document area has focus
// (on a focused button it still presses the button). The Hand tool turns itself off when
// another tool starts. Shift+wheel scrolls sideways (the browser does this itself).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";

let hand = false;
let space = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const panStore = {
  hand: () => hand,
  setHand(on: boolean) {
    if (hand === on) return;
    hand = on;
    emit();
  },
  toggleHand() {
    panStore.setHand(!hand);
  },
};

export function useHandTool(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hand,
  );
}

function useSpaceHeld(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => space,
  );
}

function typingOrPressing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.matches(
      "input, textarea, select, button, a[href], summary, [role=button], [role^=menuitem], [role=option], [role=tab], [role=checkbox], [role=radio], [role=listbox], [role=tree] *",
    )
  );
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== " " || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector("dialog[open]")) return;
      if (typingOrPressing(e.target) || typingOrPressing(document.activeElement)) return;
      // Text being edited on the page (Edit PDF, a text comment) takes its keys from the
      // page itself, so focus alone cannot tell: a space typed there stays a space.
      if (
        document.querySelector(
          "[data-testid=edit-editor], .edit-layer.editing, [contenteditable=true]",
        )
      )
        return;
      // Holding Space repeats keydown: never let it page down (Acrobat: Space = hand).
      e.preventDefault();
      if (!space) {
        space = true;
        emit();
      }
    },
    true,
  );
  const up = () => {
    if (!space) return;
    space = false;
    emit();
  };
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key === " ") up();
    },
    true,
  );
  window.addEventListener("blur", up);
}

/** Mount once per document view; pans its viewport element. */
export function PanController({ documentId }: { documentId: string }) {
  const handOn = useHandTool();
  const spaceHeld = useSpaceHeld();
  const { state: im } = useInteractionManager(documentId);
  const { state: annots } = useAnnotation(documentId);
  const tool = `${im.activeMode}|${annots.activeToolId ?? ""}`;
  const toolAtHand = useRef<string | null>(null);

  // Another tool started: the Hand tool steps aside.
  useEffect(() => {
    if (!handOn) {
      toolAtHand.current = null;
      return;
    }
    if (toolAtHand.current === null) toolAtHand.current = tool;
    else if (toolAtHand.current !== tool) panStore.setHand(false);
  }, [handOn, tool]);

  const active = handOn || spaceHeld;
  useEffect(() => {
    const vp = document.querySelector<HTMLElement>("[data-testid=viewport]");
    if (!vp || !active) return;
    vp.classList.add("panning");
    let from: { x: number; y: number; left: number; top: number } | null = null;
    const end = () => {
      from = null;
      vp.classList.remove("grabbing");
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !vp.contains(e.target as Node)) return;
      // A press on the scrollbars is theirs: the browser may never send its pointerup.
      const r = vp.getBoundingClientRect();
      if (
        e.clientX - r.left - vp.clientLeft >= vp.clientWidth ||
        e.clientY - r.top - vp.clientTop >= vp.clientHeight
      )
        return;
      // Ours alone: page tools, text selection and comments never see this press.
      e.preventDefault();
      e.stopImmediatePropagation();
      from = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
      vp.classList.add("grabbing");
    };
    const move = (e: PointerEvent) => {
      if (!from) return;
      // The button was let go where no pointerup reached us (another window, a menu).
      if (!(e.buttons & 1)) return end();
      e.preventDefault();
      e.stopImmediatePropagation();
      vp.scrollLeft = from.left - (e.clientX - from.x);
      vp.scrollTop = from.top - (e.clientY - from.y);
    };
    const upHandler = (e: PointerEvent) => {
      if (!from) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      end();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", upHandler, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    return () => {
      vp.classList.remove("panning", "grabbing");
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", upHandler, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
    };
  }, [active, documentId]);
  return null;
}
