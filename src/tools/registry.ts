// Tool registry (backlog B4). Every tool declares its id, name, icon, the phase it
// arrives in, what opening it does, and its toolbar actions. The workspace shell
// (Tools pane, tool toolbar, quick toolbar, Customize dialog) only reads this list:
// later phases add tools here and never change the shell.
import type { PageActions } from "../app/pageActions";
import type { PageOpDialog, WorkbenchApi } from "../app/workbench";
import type { IconName } from "../ui/Icon";
import { MARKUP_TOOLS } from "../markup/config";

/** What an action works on. */
export interface ToolContext {
  wb: WorkbenchApi;
  documentId: string | null;
  /** Organize selection when the grid is open, else the current page (0-based). */
  pages: number[];
  pageCount: number;
  /** Page operations for the active document (null when no document is open). */
  actions: PageActions | null;
  /** View commands of the active document (zoom etc.); null without a document. */
  view: ViewCommands | null;
  /** Markup tools of the active document (Phase 3); null without a document. */
  markup: MarkupCommands | null;
}

export interface MarkupCommands {
  /** EmbedPDF annotation tool that is on (e.g. "highlight"), or null. */
  activeTool: string | null;
  setTool(id: string | null): void;
}

export interface ViewCommands {
  /** Current zoom mode, for pressed buttons. */
  mode: "fit-page" | "fit-width" | "other";
  fitPage(): void;
  fitWidth(): void;
  actualSize(): void;
}

export interface ToolAction {
  id: string;
  label: string;
  icon: IconName;
  run(ctx: ToolContext): void;
  /** Shown pressed (a mode that is on). */
  pressed?(ctx: ToolContext): boolean;
  /** Disabled when false. Default: needs an open, editable document. */
  enabled?(ctx: ToolContext): boolean;
  /** Dropdown actions (stamps, tickmarks): the arrow opens these. */
  items?: { id: string; label: string; run(ctx: ToolContext): void }[];
  /** Short caption under the icon in the tool toolbar (defaults to label). */
  caption?: string;
}

export interface ToolDef {
  id: string;
  name: string;
  icon: IconName;
  /** Accent colour of the icon in the Tools pane. */
  color: string;
  description: string;
  /**
   * null: built. A number: the phase that builds it ("Coming in Phase N"). "later": not
   * scheduled yet. Unbuilt tools are hidden unless the "show coming tools" setting is on.
   */
  comingIn: number | "later" | null;
  /** "toolbar": opening shows the tool's toolbar above the page; or run once (dialogs). */
  open: "toolbar" | ((ctx: ToolContext) => void);
  /** Opening needs a document (default true). */
  needsDocument?: boolean;
  /** Document area while the tool is open ("pages" = Organize grid); reader otherwise. */
  view?: "pages";
  /** Optional panel content shown in the Tools pane while the tool is open. */
  panel?: null;
  /** The tool's own toolbar actions. Any of them can be pinned to the quick toolbar. */
  toolbar: ToolAction[];
  /** Hidden from the Tools pane (built-in commands that can only be pinned). */
  unlisted?: boolean;
}

const hasDoc = (c: ToolContext) => c.documentId !== null && c.actions !== null;
const dialog = (op: PageOpDialog) => (c: ToolContext) => {
  if (c.documentId)
    c.wb.setDialog({ kind: "pageOp", op, documentId: c.documentId, pages: c.pages });
};

/** Delete: asks first from the quick toolbar (one click would remove the page being read). */
async function deletePages(c: ToolContext) {
  if (!c.actions || !c.pages.length) return;
  if (c.pages.length >= c.pageCount) {
    c.wb.toast("You cannot delete every page of a PDF.", "error");
    return;
  }
  // In Organize the pages were picked explicitly (and Ctrl+Z undoes): no prompt there.
  if (c.documentId && c.wb.meta[c.documentId]?.activeTool === "organize") {
    void c.actions.remove(c.pages);
    return;
  }
  const what = c.pages.length === 1 ? `page ${(c.pages[0] ?? 0) + 1}` : `${c.pages.length} pages`;
  const yes = await c.wb.confirm({
    title: "Delete pages",
    message: `Delete ${what}? You can undo this (Ctrl+Z).`,
    ok: "Delete",
    danger: true,
  });
  if (yes) void c.actions.remove(c.pages);
}

export const TOOLS: ToolDef[] = [
  {
    id: "organize",
    name: "Organize Pages",
    icon: "organize",
    color: "#2e9e44",
    description: "Reorder, rotate, insert, extract, replace, split, crop pages",
    comingIn: null,
    open: "toolbar",
    view: "pages",
    toolbar: [
      {
        id: "insert",
        label: "Insert pages from a file…",
        caption: "Insert",
        icon: "insert",
        run: dialog("insert"),
      },
      {
        id: "extract",
        label: "Extract to new file",
        caption: "Extract",
        icon: "extract",
        run: (c) => void c.actions?.extract(c.pages),
      },
      {
        id: "replace",
        label: "Replace pages…",
        caption: "Replace",
        icon: "replace",
        run: dialog("replace"),
      },
      {
        id: "split",
        label: "Split document…",
        caption: "Split",
        icon: "split",
        run: dialog("split"),
      },
      {
        id: "rotateLeft",
        label: "Rotate left",
        caption: "Rotate left",
        icon: "rotateCcw",
        run: (c) => void c.actions?.rotate(c.pages, 3),
      },
      {
        id: "rotateRight",
        label: "Rotate right",
        caption: "Rotate right",
        icon: "rotateCw",
        run: (c) => void c.actions?.rotate(c.pages, 1),
      },
      {
        id: "delete",
        label: "Delete pages",
        caption: "Delete",
        icon: "trash",
        run: (c) => void deletePages(c),
      },
      {
        id: "duplicate",
        label: "Duplicate pages",
        caption: "Duplicate",
        icon: "duplicate",
        run: (c) => void c.actions?.duplicate(c.pages),
      },
      {
        id: "blank",
        label: "Insert blank page…",
        caption: "Blank page",
        icon: "blank",
        run: dialog("blank"),
      },
      { id: "crop", label: "Crop pages…", caption: "Crop", icon: "crop", run: dialog("crop") },
      {
        id: "pageSize",
        label: "Page size…",
        caption: "Page size",
        icon: "pageSize",
        run: dialog("pageSize"),
      },
    ],
  },
  {
    id: "combine",
    name: "Combine Files",
    icon: "combine",
    color: "#6f4fd8",
    description: "Merge PDFs and scans into one PDF, with a bookmark per file",
    comingIn: null,
    needsDocument: false,
    open: (c) => c.wb.setDialog({ kind: "combine", documentId: c.documentId }),
    toolbar: [],
  },
  {
    id: "view",
    name: "View",
    icon: "fitPage",
    color: "#555",
    description: "Zoom commands",
    comingIn: null,
    unlisted: true,
    open: "toolbar",
    toolbar: [
      {
        id: "fitPage",
        label: "Fit page (Ctrl+0)",
        icon: "fitPage",
        run: (c) => c.view?.fitPage(),
        enabled: (c) => c.view !== null,
        pressed: (c) => c.view?.mode === "fit-page",
      },
      {
        id: "fitWidth",
        label: "Fit width (Ctrl+2)",
        icon: "fitWidth",
        run: (c) => c.view?.fitWidth(),
        enabled: (c) => c.view !== null,
        pressed: (c) => c.view?.mode === "fit-width",
      },
      {
        id: "actualSize",
        label: "Actual size (Ctrl+1)",
        icon: "actual",
        run: (c) => c.view?.actualSize(),
        enabled: (c) => c.view !== null,
      },
    ],
  },
  {
    id: "comment",
    name: "Comment",
    icon: "comment",
    color: "#d39e00",
    description: "Sticky notes, highlights, text boxes, shapes, drawing",
    comingIn: null,
    open: "toolbar",
    toolbar: MARKUP_TOOLS.map((m): ToolAction => ({
      id: m.id,
      label: m.label,
      icon: m.icon,
      // A second click turns the tool off again (back to selecting).
      run: (c) => c.markup?.setTool(c.markup.activeTool === m.id ? null : m.id),
      pressed: (c) => c.markup?.activeTool === m.id,
      enabled: (c) => hasDoc(c) && c.markup !== null,
    })),
  },
  // ---- Not built yet: hidden unless "Show tools that are coming later" is on. ----
  planned(
    "flyer",
    "Workpaper Tools",
    "tickmark",
    "#e3a400",
    "Tickmarks, connectors, calculator tape (PDFlyer-style)",
    [
      { id: "tickmarks", label: "Tickmarks", icon: "tickmark", dropdown: true },
      { id: "calculator", label: "Calculator", icon: "calculator" },
    ],
  ),
  planned("stamp", "Stamp", "stamp", "#7b5cd6", "Reviewed / approved stamps", [
    { id: "stamps", label: "Stamps", icon: "stamp", dropdown: true },
  ]),
  planned("redact", "Redact", "redact", "#d0336c", "Permanently remove sensitive content", []),
  planned("forms", "Fill Forms", "form", "#8a4fd8", "Fill and create form fields", []),
  planned("ocr", "Scan & OCR", "ocr", "#2e9e44", "Make scanned pages searchable", []),
  planned("protect", "Protect", "protect", "#3a6fd8", "Passwords and permissions", []),
];

function planned(
  id: string,
  name: string,
  icon: IconName,
  color: string,
  description: string,
  actions: { id: string; label: string; icon: IconName; dropdown?: boolean }[],
): ToolDef {
  return {
    id,
    name,
    icon,
    color,
    description,
    comingIn: "later",
    open: "toolbar",
    toolbar: actions.map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      run: () => undefined,
      enabled: () => false,
      ...(a.dropdown ? { items: [] } : {}),
    })),
  };
}

export const isBuilt = (t: ToolDef) => t.comingIn === null;

export function comingLabel(t: ToolDef): string {
  return typeof t.comingIn === "number"
    ? `Coming in Phase ${t.comingIn}`
    : "Coming in a later phase";
}

export function tool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** "organize.rotateLeft" -> the tool and action, if both exist. */
export function resolveAction(ref: string): { tool: ToolDef; action: ToolAction } | null {
  const [toolId, actionId] = ref.split(".");
  const t = TOOLS.find((x) => x.id === toolId);
  const a = t?.toolbar.find((x) => x.id === actionId);
  return t && a ? { tool: t, action: a } : null;
}

export function actionEnabled(t: ToolDef, a: ToolAction, ctx: ToolContext): boolean {
  if (!isBuilt(t)) return false;
  return a.enabled ? a.enabled(ctx) : hasDoc(ctx) && ctx.pages.length > 0;
}

/** Every action that can be pinned, as "tool.action" references. */
export function pinnableActions(): string[] {
  return TOOLS.flatMap((t) => t.toolbar.map((a) => `${t.id}.${a.id}`));
}

/** Built-in quick toolbar (after page navigation and zoom), like the reference screenshot. */
export const DEFAULT_QUICK_TOOLBAR = [
  "view.fitPage",
  "view.fitWidth",
  "view.actualSize",
  "organize.insert",
  "organize.extract",
  "organize.rotateLeft",
  "organize.rotateRight",
  "organize.delete",
];

/**
 * Keeps known, built action references, without duplicates. Unknown or unbuilt ones
 * (from an older or newer firm layout file) are dropped, not errors.
 */
export function cleanQuickToolbar(refs: unknown): string[] | null {
  if (!Array.isArray(refs)) return null;
  const out: string[] = [];
  for (const r of refs) {
    if (typeof r !== "string" || out.includes(r)) continue;
    const hit = resolveAction(r);
    if (hit && isBuilt(hit.tool)) out.push(r);
  }
  return out;
}

/** The firm default layout file on the network share. */
export interface FirmLayout {
  version: 1;
  quickToolbar: string[];
}

export function parseFirmLayout(text: string): string[] {
  const j = JSON.parse(text) as Partial<FirmLayout>;
  if (j.version !== 1) throw new Error("unknown layout file version");
  const q = cleanQuickToolbar(j.quickToolbar);
  if (!q) throw new Error("the file has no quick toolbar");
  return q;
}
