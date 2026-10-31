// Tool registry (backlog B4). Every tool declares its id, name, icon, the phase it
// arrives in, what opening it does, and its toolbar actions. The workspace shell
// (Tools pane, tool toolbar, quick toolbar, Customize dialog) only reads this list:
// later phases add tools here and never change the shell.
import type { ComponentType } from "react";
import type { PageActions } from "../app/pageActions";
import type { PageOpDialog, WorkbenchApi } from "../app/workbench";
import type { IconName } from "../ui/Icon";
import { MARKUP_TOOLS } from "../markup/config";
import type { TickmarkDef } from "../engine/flyer/tickmarks";
import type { LibraryEntry } from "../flyer/library";
import { TICK_SECTIONS } from "../engine/flyer/tickmarks";
import { pickLabel, type TickPick, type TickSectionPicks } from "../flyer/sections";
import type { StampTemplate } from "../engine/flyer/userStamps";
import type { ConnectorStyle } from "../flyer/connectors";
import type { SanitizeOptions } from "../engine/redact/sanitize";
import { ALL_SANITIZE } from "../engine/redact/sanitize";
/** File commands load the platform layer; imported on use so this list stays Node-safe. */
const markupFiles = () => import("../ui/markup/markupFiles");
const flyerFiles = () => import("../ui/flyer/flyerFiles");
const formActions = () => import("../ui/forms/formActions");
const scanActions = () => import("../ui/scan/scanActions");
const formDataFiles = () => import("../ui/forms/formDataFiles");
const prepareStore = () => import("../ui/forms/prepareStore");
const prepareActions = () => import("../ui/forms/prepareActions");

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
  /** Edit PDF mode (backlog B3); null without an editable document. */
  edit: EditCommands | null;
  /** Workpaper Tools (Phase 4); null without a document that takes markup. */
  flyer: FlyerCommands | null;
  /** Redact (Phase 5); null without a document that takes markup. */
  redact: RedactCommands | null;
}

export interface RedactCommands {
  /** "Draw box" is on: a drag on a page makes a redaction mark. */
  drawing: boolean;
  setDrawing(on: boolean): void;
  /** Marks the selected text. */
  markSelection(): void;
  /** Marks whole pages (0-based). */
  markPages(pages: number[]): void;
  /** Marks in the document, and how many of them are accepted. */
  marks: number;
  accepted: number;
  /** Apply or Sanitize is running. */
  working: boolean;
  /** Applies the accepted marks into a new file, optionally with Sanitize. */
  apply(sanitize?: SanitizeOptions | null): Promise<void>;
  sanitize(opt: SanitizeOptions): Promise<void>;
}

export interface FlyerCommands {
  /** Built-in, firm and personal tickmarks, in that order. */
  library: LibraryEntry[];
  /** What the active-tickmark button places. */
  active: TickmarkDef | null;
  /** Its pick ("letter:A") and letter or number, if it has one. */
  activeRef: string | null;
  activeLabel: string | undefined;
  recent: TickPick[];
  /** Toolbar sections (Letters, Numbers, Checks...), each with its last pick. */
  sections: (TickSectionPicks & { last: TickPick | null })[];
  /** A tickmark is armed: each click on a page places one, until Esc. */
  placing: boolean;
  /** Makes a pick ("footed", "letter:A"; default: the active one) active and arms it. */
  arm(ref?: string): void;
  stop(): void;
  clearRecent(): void;
  /** Arms a legend box of the tickmarks used in the document. */
  insertLegend(): void;
  /** User and status stamp templates: built-in, firm, mine. */
  stamps: { def: StampTemplate; source: "built-in" | "firm" | "mine" }[];
  /** Template id of the stamp being placed, or null. */
  placingStamp: string | null;
  /** Arms a stamp (asks for its reference and fields first when it has them). */
  pickStamp(id: string): void;
  connectorStyles: readonly ConnectorStyle[];
  /** Last style used (id). */
  connectorStyle: string;
  /** Drawing connectors: two clicks each, until Esc. */
  connecting: boolean;
  connect(styleId?: string): void;
  /** The workpaper note tool is on. */
  noting: boolean;
  setNoting(on: boolean): void;
}

export interface EditCommands {
  /** Edit mode is on: outlines shown, clicks select text boxes and images. */
  on: boolean;
  setOn(on: boolean): void;
  /** Add Text is armed: the next click (or drag) on a page places new text. */
  adding: boolean;
  setAdding(on: boolean): void;
  /** Picks a JPEG or PNG; the next click (or drag) on a page places it. */
  addImage(): void;
  /** A picked image is waiting to be placed. */
  placingImage: boolean;
  /** The Link tool is on: links shown; click one to edit it, drag to add one. */
  linking: boolean;
  setLinking(on: boolean): void;
  /** Removes every web link in the document (one undo step). */
  removeWebLinks(): void;
}

/** A tool's panel in the Tools pane, loaded on first use (keeps this list Node-safe). */
export type ToolPanel = () => Promise<{
  default: ComponentType<{ documentId: string }>;
}>;

export interface MarkupCommands {
  /** EmbedPDF annotation tool that is on (e.g. "highlight"), or null. */
  activeTool: string | null;
  setTool(id: string | null): void;
  /** The ink eraser is on. */
  erasing: boolean;
  setErasing(on: boolean): void;
  /** Arms a stamp for the next click on a page: "b:approved" (built-in, or a bare
   * src/engine/stamps.ts id) or "c:<id>" (custom). */
  pickStamp(ref: string): void;
  /** Arms the picture on the clipboard as a stamp (Paste Clipboard Image as Stamp Tool). */
  pasteStamp(): void;
  /** Acrobat's Stamp menu (stampLibrary.ts). */
  stampMenu(): MenuItem[];
  /** Ids (/NM) of the selected annotations. */
  selectedIds: string[];
  /** Picks an XFDF file and adds its comments (undoable). */
  importXfdf(): Promise<void>;
}

const openStamps = (c: ToolContext) => {
  if (c.documentId) c.wb.setDialog({ kind: "stamps", documentId: c.documentId });
};

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
  items?: MenuItem[] | ((ctx: ToolContext) => MenuItem[]);
  /** The button itself opens the dropdown (no separate arrow). */
  menuOnly?: boolean;
  /** The dropdown is a grid of short items (letters, numbers). */
  grid?: boolean;
  /** Text drawn in place of the icon (a tickmark section's symbol), in red. */
  glyph?: string;
  /**
   * Shown only while this is true (an action that belongs to a later phase's tool
   * appears once that tool is built). Default: always.
   */
  shown?(): boolean;
  /** Short caption under the icon in the tool toolbar (defaults to label). */
  caption?: string;
  /** A line before this action in the tool toolbar. */
  divider?: boolean;
}

/** A stamp's picture in a menu: drawn like the stamp, or a custom stamp's image. */
export type StampPreview =
  { title: string; color: string; detail?: string; above?: boolean } | { url: string };

export interface MenuItem {
  id: string;
  label: string;
  run(ctx: ToolContext): void;
  /** Shown with a tick (the active choice). */
  checked?: boolean;
  /** A setting turned on and off (a checkbox item) rather than a choice. */
  check?: boolean;
  /** Greyed out. */
  disabled?: boolean;
  /** A submenu that opens beside this item (its run is not used). */
  items?: MenuItem[];
  /** Drawn as a stamp picture instead of its label. */
  stamp?: StampPreview;
  /** A line above this item. */
  separator?: boolean;
  /** Tooltip (grid items show only a letter or number). */
  title?: string;
}

export function menuItems(a: ToolAction, ctx: ToolContext): MenuItem[] {
  return typeof a.items === "function" ? a.items(ctx) : (a.items ?? []);
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
  /** Optional panel shown in the Tools pane while the tool is open. */
  panel?: ToolPanel;
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

/** Organize Pages' actions; some also appear in Scan & OCR's toolbar. */
const ORGANIZE_TOOLBAR: ToolAction[] = [
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
];

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
    toolbar: ORGANIZE_TOOLBAR,
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
    id: "edit",
    name: "Edit PDF",
    icon: "editPdf",
    color: "#c2338a",
    description: "Edit text and images on the page",
    comingIn: null,
    open: "toolbar",
    panel: () => import("../ui/edit/EditPanel"),
    toolbar: [
      {
        id: "edit",
        label: "Edit text and images",
        caption: "Edit",
        icon: "editPdf",
        run: (c) => {
          if (!c.documentId || !c.edit) return;
          // From the quick toolbar the tool may be closed: open it (Edit mode follows).
          if (c.wb.meta[c.documentId]?.activeTool !== "edit")
            c.wb.setActiveTool(c.documentId, "edit");
          else c.edit.setOn(!c.edit.on);
        },
        pressed: (c) => (c.edit?.on ?? false) && !c.edit?.adding,
        enabled: (c) => hasDoc(c) && c.edit !== null,
      },
      {
        id: "addText",
        label: "Add text (click to place, drag to set the width)",
        caption: "Add Text",
        icon: "addText",
        run: (c) => {
          if (!c.documentId || !c.edit) return;
          if (c.wb.meta[c.documentId]?.activeTool !== "edit")
            c.wb.setActiveTool(c.documentId, "edit");
          c.edit.setAdding(!c.edit.adding);
        },
        pressed: (c) => c.edit?.adding ?? false,
        enabled: (c) => hasDoc(c) && c.edit !== null,
      },
      {
        id: "addImage",
        label: "Add image (JPEG or PNG; click to place, drag to set the width)",
        caption: "Add Image",
        icon: "addImage",
        run: (c) => {
          if (!c.documentId || !c.edit) return;
          if (c.wb.meta[c.documentId]?.activeTool !== "edit")
            c.wb.setActiveTool(c.documentId, "edit");
          c.edit.addImage();
        },
        pressed: (c) => c.edit?.placingImage ?? false,
        enabled: (c) => hasDoc(c) && c.edit !== null,
      },
      {
        id: "link",
        label: "Link: add, edit or remove links (drag to add, click a link to edit it)",
        caption: "Link",
        icon: "link",
        run: (c) => {
          if (!c.documentId || !c.edit) return;
          if (c.wb.meta[c.documentId]?.activeTool !== "edit")
            c.wb.setActiveTool(c.documentId, "edit");
          c.edit.setLinking(!c.edit.linking);
        },
        pressed: (c) => c.edit?.linking ?? false,
        enabled: (c) => hasDoc(c) && c.edit !== null,
        items: [
          {
            id: "linkTool",
            label: "Add or edit links",
            run: (c) => {
              if (!c.documentId || !c.edit) return;
              if (c.wb.meta[c.documentId]?.activeTool !== "edit")
                c.wb.setActiveTool(c.documentId, "edit");
              c.edit.setLinking(true);
            },
          },
          {
            id: "removeWebLinks",
            label: "Remove all web links",
            separator: true,
            run: (c) => c.edit?.removeWebLinks(),
          },
        ],
      },
      {
        id: "cropPages",
        label: "Crop pages…",
        caption: "Crop Pages",
        icon: "crop",
        run: dialog("crop"),
      },
      // Phase 7's tools, shown here (like Acrobat's Edit toolbar) once they are built.
      phase7Action("headerFooter", "Header & Footer", "headerFooter"),
      phase7Action("watermark", "Watermark", "watermark"),
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
    })).concat(
      {
        id: "eraser",
        label: "Eraser",
        icon: "eraser",
        run: (c) => c.markup?.setErasing(!c.markup.erasing),
        pressed: (c) => c.markup?.erasing ?? false,
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "stamps",
        label: "Stamp",
        icon: "stamp",
        run: () => {},
        menuOnly: true,
        items: (c) => c.markup?.stampMenu() ?? [],
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "flatten",
        label: "Flatten comments into a new file…",
        caption: "Flatten",
        icon: "flatten",
        run: (c) =>
          c.documentId &&
          c.wb.setDialog({
            kind: "flatten",
            documentId: c.documentId,
            page: c.pages[0] ?? 0,
            selectedIds: c.markup?.selectedIds ?? [],
          }),
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "exportXfdf",
        label: "Export comments (XFDF)…",
        caption: "Export",
        icon: "exportFile",
        run: (c) => {
          const id = c.documentId;
          if (id) void markupFiles().then((m) => m.exportXfdfFile(c.wb, id));
        },
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "importXfdf",
        label: "Import comments (XFDF)…",
        caption: "Import",
        icon: "importFile",
        run: (c) => void c.markup?.importXfdf(),
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "summary",
        label: "Summarize comments into a printable PDF",
        caption: "Summary",
        icon: "summary",
        run: (c) => {
          const id = c.documentId;
          if (id) void markupFiles().then((m) => m.summaryToNewFile(c.wb, id));
        },
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "commentsList",
        label: "Comments list",
        caption: "List",
        icon: "comments",
        run: (c) => c.wb.updateSettings({ commentsOpen: !c.wb.settings.commentsOpen }),
        pressed: (c) => c.wb.settings.commentsOpen,
        enabled: (c) => c.documentId !== null,
      },
    ),
  },
  {
    id: "stamp",
    name: "Stamp",
    icon: "stamp",
    color: "#7b5cd6",
    description: "Dynamic, Sign Here and Standard Business stamps, and your own image stamps",
    comingIn: null,
    open: "toolbar",
    toolbar: [
      // Acrobat's Stamp toolbar (B6): the Stamp menu, the palette, custom stamps.
      {
        id: "stampMenu",
        label: "Stamp",
        icon: "stamp",
        run: () => {},
        menuOnly: true,
        items: (c) => c.markup?.stampMenu() ?? [],
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "stampsPalette",
        label: "Stamps Palette",
        icon: "stamp",
        run: (c) => c.wb.updateSettings({ stampsPaletteOpen: !c.wb.settings.stampsPaletteOpen }),
        pressed: (c) => c.wb.settings.stampsPaletteOpen,
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
      {
        id: "customStamps",
        label: "Custom Stamps",
        icon: "stamp",
        run: () => {},
        menuOnly: true,
        items: [
          { id: "create", label: "Create Custom Stamp…", run: openStamps },
          { id: "manage", label: "Manage Stamps…", run: openStamps },
        ],
        enabled: (c) => hasDoc(c) && c.markup !== null,
      },
    ],
  },
  // ---- Not built yet: hidden unless "Show tools that are coming later" is on. ----
  {
    id: "flyer",
    name: "Workpaper Tools",
    icon: "tickmark",
    color: "#e3a400",
    description: "Tickmarks, sign-off stamps, connectors, notes, calculator tape (PDFlyer-style)",
    comingIn: null,
    open: "toolbar",
    panel: () => import("../ui/flyer/StampSummaryPanel"),
    toolbar: [
      {
        id: "tickmark",
        label: "Place the active tickmark (click the page for each one, Esc stops)",
        caption: "Tickmark",
        icon: "tickmark",
        run: (c) => (c.flyer?.placing ? c.flyer.stop() : c.flyer?.arm()),
        pressed: (c) => c.flyer?.placing ?? false,
        enabled: (c) => hasDoc(c) && c.flyer !== null,
        items: (c) =>
          (c.flyer?.library ?? []).map((e) => ({
            id: e.def.id,
            label: e.source === "built-in" ? e.def.name : `${e.def.name} (${e.source})`,
            checked: e.def.id === c.flyer?.active?.id,
            run: (cc: ToolContext) => cc.flyer?.arm(e.def.id),
          })),
      },
      // One button per section, like PDFlyer: places the section's last pick; the arrow
      // lists the section (a grid of letters or numbers for those two).
      ...TICK_SECTIONS.map((sec): ToolAction => ({
        id: `sec-${sec.id}`,
        label: `${sec.label} tickmarks`,
        caption: sec.label,
        icon: "tickmark",
        glyph: sec.glyph,
        grid: sec.id === "letters" || sec.id === "numbers",
        run: (c) => {
          const s = c.flyer?.sections.find((x) => x.id === sec.id);
          if (!s?.last) return;
          if (c.flyer?.placing && c.flyer.activeRef === s.last.ref) c.flyer.stop();
          else c.flyer?.arm(s.last.ref);
        },
        pressed: (c) =>
          (c.flyer?.placing ?? false) && (c.flyer?.active?.section ?? "mine") === sec.id,
        enabled: (c) =>
          hasDoc(c) &&
          c.flyer !== null &&
          (c.flyer.sections.find((x) => x.id === sec.id)?.picks.length ?? 0) > 0,
        items: (c) =>
          (c.flyer?.sections.find((x) => x.id === sec.id)?.picks ?? []).map((p) => ({
            id: p.ref,
            label:
              sec.id === "letters" || sec.id === "numbers"
                ? (p.label ?? pickLabel(p))
                : pickLabel(p),
            ...(p.label ? { title: pickLabel(p) } : {}),
            checked: p.ref === c.flyer?.activeRef,
            run: (cc: ToolContext) => cc.flyer?.arm(p.ref),
          })),
      })),
      {
        id: "recent",
        label: "Recent tickmarks",
        caption: "Recent",
        icon: "history",
        menuOnly: true,
        run: () => undefined,
        enabled: (c) => hasDoc(c) && c.flyer !== null,
        items: (c) => [
          ...(c.flyer?.recent ?? []).map((p) => ({
            id: p.ref,
            label: pickLabel(p),
            run: (cc: ToolContext) => cc.flyer?.arm(p.ref),
          })),
          {
            id: "clearRecent",
            label: "Clear Recent Stamps",
            separator: true,
            run: (cc: ToolContext) => cc.flyer?.clearRecent(),
          },
        ],
      },
      {
        id: "signoff",
        label: "Place a sign-off or initials stamp (click the page for each one, Esc stops)",
        caption: "Sign-off",
        icon: "stamp",
        run: (c) =>
          c.flyer?.placingStamp
            ? c.flyer.stop()
            : c.flyer?.pickStamp(c.flyer.stamps[0]?.def.id ?? ""),
        pressed: (c) => c.flyer?.placingStamp != null,
        enabled: (c) => hasDoc(c) && c.flyer !== null,
        items: (c) =>
          (c.flyer?.stamps ?? []).map((e) => ({
            id: e.def.id,
            label: e.source === "built-in" ? e.def.title : `${e.def.title} (${e.source})`,
            checked: e.def.id === c.flyer?.placingStamp,
            run: (cc: ToolContext) => cc.flyer?.pickStamp(e.def.id),
          })),
      },
      {
        id: "connector",
        label: "Draw a connector (click the start, then the end; Esc stops)",
        caption: "Connector",
        icon: "arrow",
        run: (c) => (c.flyer?.connecting ? c.flyer.stop() : c.flyer?.connect()),
        pressed: (c) => c.flyer?.connecting ?? false,
        enabled: (c) => hasDoc(c) && c.flyer !== null,
        items: (c) =>
          (c.flyer?.connectorStyles ?? []).map((st) => ({
            id: st.id,
            label: st.label,
            checked: st.id === c.flyer?.connectorStyle,
            run: (cc: ToolContext) => cc.flyer?.connect(st.id),
          })),
      },
      {
        id: "note",
        label: "Workpaper note (drag a box, type; Esc ends)",
        caption: "Note",
        icon: "textbox",
        run: (c) => c.flyer?.setNoting(!c.flyer.noting),
        pressed: (c) => c.flyer?.noting ?? false,
        enabled: (c) => hasDoc(c) && c.flyer !== null,
      },
      {
        id: "calculator",
        label: "Calculator: 10-key or standard, click amounts, foot/cross-foot, tape",
        caption: "Calculator",
        icon: "calculator",
        run: (c) => c.wb.updateSettings({ calcOpen: !c.wb.settings.calcOpen }),
        pressed: (c) => c.wb.settings.calcOpen,
        enabled: (c) => hasDoc(c) && c.flyer !== null,
      },
      {
        id: "palette",
        label: "Tickmark palette (number keys pick a tickmark while placing)",
        caption: "Palette",
        icon: "palette",
        run: (c) =>
          c.wb.updateSettings({ tickmarkPaletteOpen: !c.wb.settings.tickmarkPaletteOpen }),
        pressed: (c) => c.wb.settings.tickmarkPaletteOpen,
        enabled: (c) => c.documentId !== null,
      },
      {
        id: "legend",
        label: "Insert a legend of the tickmarks used in this document",
        caption: "Legend",
        icon: "legend",
        run: (c) => c.flyer?.insertLegend(),
        enabled: (c) => hasDoc(c) && c.flyer !== null,
      },
      {
        id: "library",
        label: "Tickmark and stamp library, workpaper settings…",
        caption: "Library",
        icon: "library",
        run: (c) => c.wb.setDialog({ kind: "tickmarks" }),
        enabled: () => true,
      },
      {
        id: "summaryCsv",
        label: "Export the Stamp Summary to CSV…",
        caption: "Export CSV",
        icon: "exportFile",
        run: (c) => {
          const id = c.documentId;
          if (id) void flyerFiles().then((m) => m.exportSummaryCsv(c.wb, id));
        },
        enabled: (c) => c.documentId !== null && c.flyer !== null,
      },
    ],
  },
  {
    id: "redact",
    name: "Redact",
    icon: "redact",
    color: "#d0336c",
    description: "Permanently remove sensitive content",
    comingIn: null,
    open: "toolbar",
    panel: () => import("../ui/redact/RedactPanel"),
    toolbar: [
      {
        id: "drawBox",
        label: "Mark an area: drag a box over what to remove",
        caption: "Draw Box",
        icon: "redact",
        run: (c) => {
          if (!c.documentId || !c.redact) return;
          if (c.wb.meta[c.documentId]?.activeTool !== "redact")
            c.wb.setActiveTool(c.documentId, "redact");
          c.redact.setDrawing(!c.redact.drawing);
        },
        pressed: (c) => c.redact?.drawing ?? false,
        enabled: (c) => c.redact !== null,
      },
      {
        id: "markSelection",
        label: "Mark the selected text for redaction",
        caption: "Mark Text",
        icon: "text",
        run: (c) => c.redact?.markSelection(),
        enabled: (c) => c.redact !== null,
      },
      {
        id: "markPages",
        label: "Mark the current page (or the pages selected in Organize) for redaction",
        caption: "Mark Page",
        icon: "pages",
        run: (c) => c.redact?.markPages(c.pages),
        enabled: (c) => c.redact !== null && c.pages.length > 0,
      },
      {
        id: "apply",
        label: "Apply the accepted marks: writes <name>_Redacted.pdf, the original is unchanged",
        caption: "Apply",
        icon: "save",
        run: (c) => void c.redact?.apply(),
        enabled: (c) => (c.redact?.accepted ?? 0) > 0 && !c.redact?.working,
      },
      {
        id: "sanitize",
        label:
          "Sanitize Document: remove metadata, attachments, scripts and hidden data into a new file",
        caption: "Sanitize",
        icon: "protect",
        run: (c) => void c.redact?.sanitize(ALL_SANITIZE),
        enabled: (c) => c.redact !== null && !c.redact.working,
      },
    ],
  },
  {
    id: "forms",
    name: "Fill Forms",
    icon: "form",
    color: "#8a4fd8",
    description: "Fill, check and reset form fields",
    comingIn: null,
    open: "toolbar",
    panel: () => import("../ui/forms/FormsPanel"),
    toolbar: [
      {
        id: "highlight",
        label: "Highlight fields: tint fillable fields, outline required ones",
        caption: "Highlight",
        icon: "fieldHighlight",
        run: (c) => c.wb.updateSettings({ formHighlight: !c.wb.settings.formHighlight }),
        pressed: (c) => c.wb.settings.formHighlight,
        enabled: () => true,
      },
      {
        id: "resetForm",
        label: "Reset form: every field back to its default value (Ctrl+Z undoes)",
        caption: "Reset",
        icon: "resetForm",
        run: (c) => {
          const id = c.documentId;
          if (id) void formActions().then((m) => m.resetForm(c.wb, id));
        },
        enabled: (c) => hasDoc(c),
      },
      {
        id: "flattenForm",
        label:
          "Flatten form into a new file: fields become part of the page, the original is unchanged",
        caption: "Flatten",
        icon: "flatten",
        run: (c) => {
          const id = c.documentId;
          if (id) void formDataFiles().then((m) => m.flattenFormToNewFile(c.wb, id));
        },
        enabled: (c) => c.documentId !== null,
      },
      {
        id: "importData",
        label: "Import form data from an FDF, XFDF, JSON or CSV file (Ctrl+Z undoes)",
        caption: "Import",
        icon: "importFile",
        run: (c) => {
          const id = c.documentId;
          if (id) void formDataFiles().then((m) => m.importFormData(c.wb, id));
        },
        enabled: (c) => hasDoc(c),
      },
      {
        id: "exportData",
        label: "Export the form's field values",
        caption: "Export",
        icon: "exportFile",
        run: (c) => {
          const id = c.documentId;
          if (id) void formDataFiles().then((m) => m.exportFormData(c.wb, id, "fdf"));
        },
        enabled: (c) => c.documentId !== null,
        items: () =>
          (["fdf", "xfdf", "json", "csv"] as const).map((f) => ({
            id: f,
            label: `Export to ${f.toUpperCase()}…`,
            run: (cc: ToolContext) => {
              const id = cc.documentId;
              if (id) void formDataFiles().then((m) => m.exportFormData(cc.wb, id, f));
            },
          })),
      },
    ],
  },
  {
    id: "prepareForm",
    name: "Prepare Form",
    icon: "form",
    color: "#6b3fc0",
    description: "Add, move and set up form fields",
    comingIn: null,
    open: "toolbar",
    panel: () => import("../ui/forms/PreparePanel"),
    toolbar: [
      {
        id: "detectFields",
        label: "Detect fields: find blank lines, underscores and boxes and add fields there",
        caption: "Detect",
        icon: "search",
        run: (c: ToolContext) => {
          const id = c.documentId;
          if (id) void prepareActions().then((m) => m.detectAndAdd(c.wb, id));
        },
        enabled: (c: ToolContext) => hasDoc(c),
      },
      ...(
        [
          ["text", "Text field", "fieldHighlight"],
          ["checkbox", "Check box", "checkRequired"],
          ["radio", "Radio button", "checkRequired"],
          ["dropdown", "Dropdown", "form"],
          ["date", "Date field", "form"],
          ["signature", "Signature field", "form"],
        ] as const
      ).map(([kind, label, icon]) => ({
        id: `add-${kind}`,
        label: `Add a ${label.toLowerCase()}: click on the page to place it (Esc cancels)`,
        caption: label,
        icon,
        run: (c: ToolContext) => {
          const id = c.documentId;
          if (id) void prepareStore().then((m) => m.prepare.arm(id, kind));
        },
        enabled: (c: ToolContext) => hasDoc(c),
      })),
    ],
  },
  {
    id: "ocr",
    name: "Scan & OCR",
    icon: "ocr",
    color: "#2e9e44",
    description: "Make scanned pages searchable, straighten scans, Bates numbers",
    comingIn: null,
    open: "toolbar",
    panel: () => import("../ui/scan/ScanPanel"),
    // Like Acrobat's Scan & OCR toolbar (docs/reference/image_5.png).
    toolbar: [
      {
        id: "insert",
        label: "Insert pages",
        caption: "Insert",
        icon: "insert",
        menuOnly: true,
        run: () => undefined,
        items: [
          { id: "file", label: "From File (PDF or images)…", run: dialog("insert") },
          { id: "blank", label: "Blank Page…", run: dialog("blank") },
        ],
      },
      {
        id: "enhance",
        label: "Enhance scanned pages",
        caption: "Enhance",
        icon: "enhance",
        menuOnly: true,
        run: () => undefined,
        items: (c) => {
          const go = (how: "straighten" | "upright", pages: number[]) => (ctx: ToolContext) => {
            const id = ctx.documentId;
            if (id) void scanActions().then((m) => m.enhance(ctx.wb, id, how, pages));
          };
          const all = Array.from({ length: c.pageCount }, (_, i) => i);
          return [
            { id: "straighten", label: "Straighten All Pages", run: go("straighten", all) },
            {
              id: "straightenPage",
              label: "Straighten This Page",
              run: go("straighten", c.pages.slice(0, 1)),
            },
            { id: "upright", label: "Turn Pages Upright", run: go("upright", all) },
          ];
        },
      },
      {
        id: "recognize",
        label: "Recognize Text: add a searchable text layer to scanned pages",
        caption: "Recognize Text",
        icon: "text",
        menuOnly: true,
        run: () => undefined,
        items: [
          {
            id: "file",
            label: "In This File",
            run: (c) => {
              const id = c.documentId;
              if (id) void scanActions().then((m) => m.recognize(c.wb, id));
            },
          },
          {
            id: "page",
            label: "On This Page",
            run: (c) => {
              const id = c.documentId;
              if (id) void scanActions().then((m) => m.recognize(c.wb, id, c.pages.slice(0, 1)));
            },
          },
          {
            id: "folder",
            label: "In Multiple Files (a folder)…",
            run: (c) => c.wb.setDialog({ kind: "batchOcr" }),
          },
        ],
      },
      phase7Action("bates", "Bates Numbering", "bates"),
      { ...organizeAction("extract"), divider: true },
      organizeAction("rotateLeft"),
      organizeAction("rotateRight"),
      organizeAction("delete"),
    ],
  },
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

/** One of Organize Pages' actions, also shown in another tool's toolbar (Scan & OCR). */
function organizeAction(id: string): ToolAction {
  const a = ORGANIZE_TOOLBAR.find((x) => x.id === id);
  if (!a) throw new Error(`no Organize action ${id}`);
  return a;
}

/**
 * An Edit toolbar button for a later phase's tool (`toolId`): hidden until that tool
 * is built; then it opens the tool, and its arrow lists the tool's own actions.
 */
function phase7Action(toolId: string, caption: string, icon: IconName): ToolAction {
  const target = () => TOOLS.find((t) => t.id === toolId && isBuilt(t));
  return {
    id: toolId,
    label: caption,
    caption,
    icon,
    shown: () => target() !== undefined,
    run: (c) => {
      if (c.documentId && target()) c.wb.setActiveTool(c.documentId, toolId);
    },
    items: () =>
      (target()?.toolbar ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        run: (ctx) => {
          if (ctx.documentId) ctx.wb.setActiveTool(ctx.documentId, toolId);
          a.run(ctx);
        },
      })),
  };
}

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
/** A divider between quick tools (Customize Quick Tools: Add divider). */
export const QUICK_DIVIDER = "|";

export function cleanQuickToolbar(refs: unknown): string[] | null {
  if (!Array.isArray(refs)) return null;
  const out: string[] = [];
  for (const r of refs) {
    if (r === QUICK_DIVIDER) {
      // Never first or twice in a row.
      if (out.length && out.at(-1) !== QUICK_DIVIDER) out.push(r);
      continue;
    }
    if (typeof r !== "string" || out.includes(r)) continue;
    const hit = resolveAction(r);
    if (hit && isBuilt(hit.tool)) out.push(r);
  }
  if (out.at(-1) === QUICK_DIVIDER) out.pop();
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
