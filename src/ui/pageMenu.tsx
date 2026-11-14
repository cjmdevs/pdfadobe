// Page commands shared by the thumbnail panel and the Organize view (B8): Copy, Cut,
// Paste before/after on the page clipboard (shared by every tab and window), the
// right-click menu, and Ctrl+C / Ctrl+X / Ctrl+V / Delete while either has focus.
// Every change is one undo step (Workbench.edit); Cut is a copy plus a delete.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { usePageActions } from "../app/pageActions";
import { useWorkbench } from "../app/workbench";
import { platform, type PageClipInfo } from "../platform";
import { plural } from "./kit/text";
import type { MenuEntry } from "./kit/Menu";

const CLIP_EVENT = "pdfwb:pageclip";

/** What is on the page clipboard; refreshed after a copy and when the window gets focus. */
export function useClipInfo(): PageClipInfo | null {
  const [info, setInfo] = useState<PageClipInfo | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void platform.pageClipboard
        .info()
        .then((i) => live && setInfo(i))
        .catch(() => undefined);
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener(CLIP_EVENT, refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener(CLIP_EVENT, refresh);
    };
  }, []);
  return info;
}

export function usePageCommands(documentId: string, pageCount: number, current: number) {
  const wb = useWorkbench();
  const actions = usePageActions(documentId);
  const clip = useClipInfo();
  return useMemo(() => {
    const busy = () => wb.busy !== null;
    const copy = async (pages: number[]) => {
      const ok = await actions.copy(pages);
      if (ok) document.dispatchEvent(new Event(CLIP_EVENT));
      return ok;
    };
    const cut = async (pages: number[]) => {
      if (!pages.length || busy()) return;
      if (pages.length >= pageCount) {
        wb.toast("You cannot cut every page of a PDF. Use Copy instead.", "error");
        return;
      }
      if (await copy(pages)) await actions.remove(pages);
    };
    const remove = (pages: number[]) => {
      if (!pages.length || busy()) return;
      if (pages.length >= pageCount) {
        wb.toast("You cannot delete every page of a PDF.", "error");
        return;
      }
      void actions.remove(pages);
    };
    /** Before the first selected page, or after the last; no selection: after the current page. */
    const paste = (where: "before" | "after", pages: number[]) => {
      if (busy()) return;
      const at = pages.length
        ? where === "before"
          ? Math.min(...pages)
          : Math.max(...pages) + 1
        : where === "before"
          ? current
          : current + 1;
      void actions.paste(at);
    };
    const op = (op: "insert" | "replace" | "blank" | "crop" | "pageSize", pages: number[]) =>
      wb.setDialog({ kind: "pageOp", op, documentId, pages });

    const menu = (pages: number[]): MenuEntry[] => {
      const has = pages.length > 0;
      const what =
        pages.length === 1 ? `page ${(pages[0] ?? 0) + 1}` : plural(pages.length, "page");
      const target = has ? pages : [current];
      const pasteLabel = clip ? ` (${plural(clip.count, "page")})` : "";
      return [
        { id: "cut", label: "Cut", shortcut: "Ctrl+X", disabled: !has, run: () => void cut(pages) },
        {
          id: "copy",
          label: "Copy",
          shortcut: "Ctrl+C",
          disabled: !has,
          run: () => void copy(pages),
        },
        {
          id: "pasteBefore",
          label: `Paste before${pasteLabel}`,
          disabled: !clip,
          run: () => paste("before", pages),
        },
        {
          id: "pasteAfter",
          label: `Paste after${pasteLabel}`,
          shortcut: "Ctrl+V",
          disabled: !clip,
          run: () => paste("after", pages),
        },
        { kind: "divider" },
        {
          kind: "submenu",
          id: "insert",
          label: "Insert",
          items: [
            { id: "blank", label: "Blank page…", run: () => op("blank", target) },
            { id: "file", label: "Pages from a file…", run: () => op("insert", target) },
          ],
        },
        {
          id: "delete",
          label: has ? `Delete ${what}` : "Delete",
          shortcut: "Delete",
          disabled: !has,
          danger: true,
          run: () => remove(pages),
        },
        {
          id: "extract",
          label: "Extract to new file",
          disabled: !has,
          run: () => void actions.extract(pages),
        },
        {
          id: "replace",
          label: "Replace…",
          disabled: !has,
          run: () => op("replace", pages),
        },
        {
          kind: "submenu",
          id: "rotate",
          label: "Rotate",
          disabled: !has,
          items: [
            { id: "left", label: "Rotate left", run: () => void actions.rotate(pages, 3) },
            { id: "right", label: "Rotate right", run: () => void actions.rotate(pages, 1) },
            { id: "half", label: "Rotate 180°", run: () => void actions.rotate(pages, 2) },
          ],
        },
        { kind: "divider" },
        {
          id: "properties",
          label: "Page properties…",
          disabled: pages.length > 1,
          run: () =>
            wb.setDialog({ kind: "pageProperties", documentId, page: pages[0] ?? current }),
        },
      ];
    };

    /** Ctrl+C / Ctrl+X / Ctrl+V / Delete on the focused list. True when handled. */
    const onKey = (e: KeyboardEvent, pages: number[]): boolean => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && !e.shiftKey && !e.altKey && k === "c") void copy(pages);
      else if (ctrl && !e.shiftKey && !e.altKey && k === "x") void cut(pages);
      else if (ctrl && !e.shiftKey && !e.altKey && k === "v") paste("after", pages);
      else if (!ctrl && e.key === "Delete") remove(pages);
      else return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    };

    return { copy, cut, paste, remove, menu, onKey };
  }, [wb, actions, clip, documentId, pageCount, current]);
}
