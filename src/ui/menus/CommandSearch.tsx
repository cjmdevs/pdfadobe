// Search box in the top bar (B8, Alt+Q): type a few words to find a tool, a menu
// command, a setting or a help page; Up/Down pick, Enter runs, Esc leaves. Settings open
// Preferences at that row; help pages open Help at that page.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MENUS, MENU_ROWS, shortcutKey } from "../../app/appCommands";
import { searchItems, type SearchItem } from "../../app/commandSearch";
import { PREFS, PREF_CATEGORIES } from "../../app/prefsIndex";
import { useWorkbench } from "../../app/workbench";
import { TOOLS, type ToolContext } from "../../tools/registry";
import { HELP_TOPICS } from "../help/topics";
import { useAppCommands } from "./useAppCommands";

const KIND_LABEL: Record<SearchItem["kind"], string> = {
  tool: "Tool",
  command: "Menu",
  setting: "Setting",
  help: "Help",
};

/** Everything the search can find (static parts). */
export function searchIndex(): SearchItem[] {
  const items: SearchItem[] = [];
  for (const t of TOOLS) {
    if (!t.unlisted)
      items.push({
        kind: "tool",
        id: `tool:${t.id}`,
        label: t.name,
        where: "Tools",
        keywords: t.description,
      });
    for (const a of t.toolbar)
      items.push({
        kind: "tool",
        id: `action:${t.id}.${a.id}`,
        label: a.caption ?? a.label,
        where: t.name,
        keywords: a.label,
      });
  }
  for (const r of MENU_ROWS) {
    if (!("id" in r)) continue;
    const menu = MENUS.find((m) => m.id === r.menu)?.label ?? "";
    items.push({
      kind: "command",
      id: `cmd:${r.id}`,
      label: r.label.replace(/…$/, ""),
      where: r.sub ? `${menu} › ${r.sub}` : menu,
      keywords: r.keywords,
      shortcut: shortcutKey(r.shortcut),
    });
  }
  for (const p of PREFS)
    items.push({
      kind: "setting",
      id: `pref:${p.id}`,
      label: p.label,
      where: `Preferences › ${PREF_CATEGORIES.find((c) => c.id === p.category)?.label ?? ""}`,
      keywords: p.keywords,
    });
  for (const h of HELP_TOPICS)
    items.push({
      kind: "help",
      id: `help:${h.id}`,
      label: h.title,
      where: "Help",
      keywords: h.keywords,
    });
  return items;
}

let mounted = 0;
/** Whether a search box is on screen (else Alt+Q opens the search as a dialog). */
export const commandSearchShown = () => mounted > 0;

export function CommandSearch({
  ctx,
  autoFocus,
  onDone,
}: {
  ctx: ToolContext;
  autoFocus?: boolean;
  /** Called after an item runs or Esc (the dialog form closes itself). */
  onDone?: () => void;
}) {
  const wb = useWorkbench();
  const cmds = useAppCommands();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const index = useMemo(() => searchIndex(), []);
  const hits = useMemo(() => (q.trim() ? searchItems(q, index) : []), [q, index]);

  useEffect(() => {
    mounted++;
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("pdfwb:command-search", focus);
    return () => {
      mounted--;
      document.removeEventListener("pdfwb:command-search", focus);
    };
  }, []);

  const runTool = (toolId: string, actionId?: string) => {
    const t = TOOLS.find((x) => x.id === toolId);
    if (!t) return;
    if (t.needsDocument !== false && !ctx.documentId) {
      wb.toast(`Open a PDF first to use ${t.name}.`);
      return;
    }
    if (actionId) {
      const a = t.toolbar.find((x) => x.id === actionId);
      if (!a) return;
      if (t.open === "toolbar" && ctx.documentId) wb.setActiveTool(ctx.documentId, t.id);
      a.run(ctx);
      return;
    }
    if (t.open === "toolbar") {
      if (ctx.documentId) wb.setActiveTool(ctx.documentId, t.id, ctx.pages[0]);
    } else t.open(ctx);
  };

  const run = (it: SearchItem) => {
    setQ("");
    setOpen(false);
    input.current?.blur();
    onDone?.();
    const [kind, rest = ""] = it.id.split(/:(.*)/s);
    if (kind === "tool") runTool(rest);
    else if (kind === "action") {
      const [toolId = "", actionId] = rest.split(".");
      runTool(toolId, actionId);
    } else if (kind === "cmd") cmds.run(rest);
    else if (kind === "pref") {
      const p = PREFS.find((x) => x.id === rest);
      wb.setDialog({ kind: "settings", category: p?.category, focus: rest });
    } else if (kind === "help") wb.setDialog({ kind: "help", topic: rest });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setAt((i) => Math.min(hits.length - 1, i + 1));
    else if (e.key === "ArrowUp") setAt((i) => Math.max(0, i - 1));
    else if (e.key === "Enter") {
      const it = hits[at];
      if (it) run(it);
    } else if (e.key === "Escape") {
      if (q) setQ("");
      else {
        input.current?.blur();
        onDone?.();
      }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const listId = "command-search-results";
  return (
    <div className="command-search" data-testid="command-search">
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search tools, commands and settings (Alt+Q)"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-activedescendant={hits[at] ? `cs-${at}` : undefined}
        placeholder="Search (Alt+Q)"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAt(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {open && q.trim() && (
        <ul id={listId} className="command-search-list" role="listbox" aria-label="Search results">
          {hits.map((it, i) => (
            <li
              key={it.id}
              id={`cs-${i}`}
              role="option"
              aria-selected={i === at}
              className={i === at ? "active" : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setAt(i)}
              onClick={() => run(it)}
            >
              <span className="cs-kind">{KIND_LABEL[it.kind]}</span>
              <span className="cs-label">{it.label}</span>
              <span className="cs-where">{it.where}</span>
              {it.shortcut && <kbd className="kit-key">{it.shortcut}</kbd>}
            </li>
          ))}
          {!hits.length && <li className="muted cs-none">Nothing matches “{q.trim()}”.</li>}
        </ul>
      )}
    </div>
  );
}
