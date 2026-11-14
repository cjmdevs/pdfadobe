// Menu bar (B8): File, Edit, View, Window, Help, each item with its shortcut. Click a
// menu or press Alt+its underlined letter; Alt alone moves to the bar (Left/Right between
// menus, Down opens, Esc leaves). While one menu is open, pointing at another opens it.
// Items the user moved off the top bar (Customize top bar) are listed at the end of the
// menu they chose.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useActiveDocument,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import {
  EDIT_KEYS,
  MENUS,
  MENU_ROWS,
  shortcutKey,
  type MenuId,
  type MenuRow,
} from "../../app/appCommands";
import { useWorkbench } from "../../app/workbench";
import { MenuList, type MenuEntry } from "../kit/Menu";
import { HELP_TOPICS } from "../help/topics";
import { rememberFocus, useAppCommands, type AppCommands } from "./useAppCommands";

/** Builds one menu's entries (also used by the overflow menu and tests). */
export function useMenuEntries(extra?: (menu: MenuId) => MenuEntry[]) {
  const cmds = useAppCommands();
  const wb = useWorkbench();
  const { activeDocumentId } = useActiveDocument();
  const { provides: manager } = useDocumentManagerCapability();
  return (menu: MenuId): MenuEntry[] => {
    const rows = MENU_ROWS.filter((r) => r.menu === menu);
    const out: MenuEntry[] = [];
    const subs = new Map<string, MenuEntry[]>();
    for (const r of rows) {
      const entries = rowEntries(r, cmds, wb, activeDocumentId, manager);
      const sub = "id" in r ? r.sub : undefined;
      if (sub) {
        let list = subs.get(sub);
        if (!list) {
          list = [];
          subs.set(sub, list);
          out.push({ kind: "submenu", id: `sub:${sub}`, label: sub, items: list });
        }
        list.push(...entries);
      } else out.push(...entries);
    }
    const more = extra?.(menu) ?? [];
    if (more.length) out.push({ kind: "divider" }, ...more);
    return out;
  };
}

function rowEntries(
  r: MenuRow,
  cmds: AppCommands,
  wb: ReturnType<typeof useWorkbench>,
  activeId: string | null,
  manager: ReturnType<typeof useDocumentManagerCapability>["provides"],
): MenuEntry[] {
  if ("dynamic" in r) {
    if (r.dynamic === "recent") {
      const recent = wb.settings.recent.slice(0, 10);
      return [
        {
          kind: "submenu",
          id: "recent",
          label: r.label ?? "Open recent",
          disabled: recent.length === 0,
          items: recent.map((f, i) => ({
            id: `recent:${i}`,
            label: f.path.split(/[\\/]/).pop() ?? f.path,
            run: () => void wb.openPaths([f.path]),
          })),
        },
      ];
    }
    if (r.dynamic === "tabs") {
      const order = manager?.getDocumentOrder() ?? [];
      if (!order.length) return [];
      return [
        { kind: "divider" },
        ...order.map((id, i) => ({
          id: `tab:${id}`,
          label: `${i + 1}  ${wb.meta[id]?.name ?? "Document"}`,
          checked: id === activeId,
          run: () => manager?.setActiveDocument(id),
        })),
      ];
    }
    return [
      {
        kind: "submenu",
        id: "helpTopics",
        label: r.label ?? "Help by feature",
        items: HELP_TOPICS.map((t) => ({
          id: `help:${t.id}`,
          label: t.title,
          run: () => wb.setDialog({ kind: "help", topic: t.id }),
        })),
      },
    ];
  }
  const s = cmds.state(r.id);
  const entry: MenuEntry = {
    id: r.id,
    label: r.label,
    shortcut: shortcutKey(r.shortcut) ?? EDIT_KEYS[r.id],
    disabled: !s.enabled,
    checked: r.check ? !!s.checked : undefined,
    run: () => cmds.run(r.id),
  };
  return r.divider ? [{ kind: "divider" }, entry] : [entry];
}

function Label({ text, mnemonic }: { text: string; mnemonic: string }) {
  const i = text.toLowerCase().indexOf(mnemonic);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <u>{text[i]}</u>
      {text.slice(i + 1)}
    </>
  );
}

export function MenuBar({ extra }: { extra?: (menu: MenuId) => MenuEntry[] }) {
  const entries = useMenuEntries(extra);
  const [open, setOpen] = useState<MenuId | null>(null);
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  useEffect(() => {
    const showItem = (e: Event) => {
      const { menu, id } = (e as CustomEvent<{ menu: MenuId; id: string }>).detail;
      rememberFocus();
      setHighlight(id);
      setOpen(menu);
    };
    document.addEventListener("pdfwb:show-menu-item", showItem);
    return () => document.removeEventListener("pdfwb:show-menu-item", showItem);
  }, []);
  /** The bar has keyboard focus without a menu open (after Alt). */
  const [armed, setArmed] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const focusTop = (id: MenuId) =>
    bar.current?.querySelector<HTMLElement>(`[data-menu="${id}"]`)?.focus();
  const step = (from: MenuId, by: number) => {
    const i = MENUS.findIndex((m) => m.id === from);
    return MENUS[(i + by + MENUS.length) % MENUS.length]?.id ?? from;
  };
  const show = (id: MenuId | null) => {
    if (id && !open) rememberFocus();
    setHighlight(undefined);
    setOpen(id);
  };

  // Alt alone arms the bar; Alt+letter opens that menu.
  useEffect(() => {
    let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Alt") {
        altAlone = !e.repeat;
        return;
      }
      altAlone = false;
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      const m = MENUS.find((x) => x.mnemonic === e.key.toLowerCase());
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      rememberFocus();
      setOpen(m.id);
      setArmed(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (bar.current?.contains(document.activeElement)) {
        setOpen(null);
        setArmed(false);
        (document.activeElement as HTMLElement).blur();
        return;
      }
      rememberFocus();
      setArmed(true);
      focusTop("file");
    };
    const pointer = () => (altAlone = false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, []);

  // A click outside closes the open menu.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const away = () => setOpen(null);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", away);
    };
  }, [open]);

  return (
    <div
      ref={bar}
      className="menubar"
      role="menubar"
      aria-label="Menu bar"
      data-testid="menubar"
      onKeyDown={(e) => {
        const t = (e.target as HTMLElement).dataset.menu as MenuId | undefined;
        if (!t) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          focusTop(step(t, e.key === "ArrowRight" ? 1 : -1));
          e.preventDefault();
        } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          show(t);
          e.preventDefault();
        } else if (e.key === "Escape") {
          setArmed(false);
          (e.target as HTMLElement).blur();
          e.preventDefault();
        }
      }}
    >
      {MENUS.map((m) => (
        <div key={m.id} className="menubar-item">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m.id}
            data-menu={m.id}
            tabIndex={armed || open === m.id ? 0 : -1}
            className={open === m.id ? "open" : undefined}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              show(open === m.id ? null : m.id);
            }}
            onPointerEnter={() => open && open !== m.id && setOpen(m.id)}
            onClick={(e) => {
              // Keyboard activation (pointer presses are handled on pointerdown).
              if (e.detail === 0) show(open === m.id ? null : m.id);
            }}
          >
            <Label text={m.label} mnemonic={m.mnemonic} />
          </button>
          {open === m.id && (
            <Dropdown>
              <MenuList
                key={highlight ?? ""}
                items={entries(m.id)}
                label={m.label}
                highlight={highlight}
                onClose={(why) => {
                  setHighlight(undefined);
                  setOpen(null);
                  setArmed(false);
                  if (why === "escape") focusTop(m.id);
                }}
                onLeft={() => setOpen(step(m.id, -1))}
                onRight={() => setOpen(step(m.id, 1))}
              />
            </Dropdown>
          )}
        </div>
      ))}
    </div>
  );
}

function Dropdown({ children }: { children: ReactNode }) {
  return <div className="menubar-dropdown">{children}</div>;
}
