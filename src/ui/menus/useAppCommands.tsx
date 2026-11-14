// What each menu command does (B8), for the menu bar, command search and the top bar.
// Keyboard-shortcut commands go through the same path as the keys (pdfwb:command), so a
// menu item and its shortcut always do the same thing.
import { useActiveDocument } from "@embedpdf/plugin-document-manager/react";
import { useDocumentState } from "@embedpdf/core/react";
import { EDIT_KEYS, appCommand } from "../../app/appCommands";
import type { Command } from "../../app/shortcuts";
import { useWorkbench } from "../../app/workbench";
import type { Theme, ViewMode } from "../../app/settings";
import { platform } from "../../platform";
import { panStore, useHandTool } from "../Pan";
import { useLoadedDocumentId } from "../../app/Commands";

export function dispatchCommand(cmd: Command) {
  document.dispatchEvent(new CustomEvent("pdfwb:command", { detail: cmd }));
}

export interface CommandState {
  enabled: boolean;
  checked?: boolean;
}

/** Where focus was before a menu opened: Edit commands act there. */
let focusBeforeMenu: Element | null = null;
export function rememberFocus() {
  const el = document.activeElement;
  if (el && !el.closest("[role=menubar], [role=menu]")) focusBeforeMenu = el;
}

function editTarget(): HTMLElement | null {
  return focusBeforeMenu instanceof HTMLElement && focusBeforeMenu.isConnected
    ? focusBeforeMenu
    : null;
}

const typing = (el: Element | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
const pageList = (el: Element | null) =>
  !!el?.closest("[data-testid=thumbs], [data-testid=organize]");

/** Cut / Copy / Paste / Delete / Select all on what had focus: pages, text, or the page. */
function runEdit(id: string) {
  const el = editTarget();
  const combo = EDIT_KEYS[id];
  if (!combo) return;
  if (el && pageList(el)) {
    el.focus();
    // The page lists handle these keys themselves (src/ui/pageMenu.tsx).
    const key = combo.split("+").pop() ?? "";
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: key.length === 1 ? key.toLowerCase() : key,
        ctrlKey: combo.startsWith("Ctrl+"),
        bubbles: true,
        cancelable: true,
      }),
    );
    return;
  }
  if (el && typing(el)) {
    el.focus();
    if (id === "edit.paste")
      void navigator.clipboard
        .readText()
        .then((t) => document.execCommand("insertText", false, t))
        .catch(() => undefined);
    else if (id === "edit.selectAll") document.execCommand("selectAll");
    else document.execCommand(id === "edit.cut" ? "cut" : id === "edit.copy" ? "copy" : "delete");
    return;
  }
  if (id === "edit.copy") dispatchCommand("copy");
  else if (id === "edit.selectAll") dispatchCommand("selectAll");
  else if (id === "edit.delete") dispatchCommand("deleteAnnotation");
}

export function useAppCommands() {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const { activeDocumentId } = useActiveDocument();
  const loadedId = useLoadedDocumentId();
  const doc = useDocumentState(loadedId ?? "")?.document ?? null;
  const hand = useHandTool();
  const st = loadedId ? wb.editState(loadedId) : null;
  const busy = wb.busy !== null;
  const hasDoc = loadedId !== null;

  const view = (m: ViewMode) => updateSettings({ viewMode: m });
  const theme = (t: Theme) => updateSettings({ theme: t });

  const state = (id: string): CommandState => {
    const on = (enabled: boolean, checked?: boolean) =>
      checked === undefined ? { enabled } : { enabled, checked };
    switch (id) {
      case "file.save":
        return on(hasDoc && !!st?.dirty && !busy);
      case "file.saveAs":
      case "file.export":
      case "file.print":
      case "file.properties":
      case "edit.find":
      case "edit.findNext":
      case "edit.findPrev":
        return on(hasDoc);
      case "file.close":
        return on(activeDocumentId !== null);
      case "file.closeAll":
        return on(activeDocumentId !== null);
      case "file.quit":
      case "window.moveTab":
        return on(!!platform.windows && (id === "file.quit" || hasDoc));
      case "edit.undo":
        return on(!!st?.undoLabel && !busy);
      case "edit.redo":
        return on(!!st?.redoLabel && !busy);
      case "edit.cut":
      case "edit.paste": {
        const el = editTarget();
        return on(!!el && (pageList(el) || typing(el)));
      }
      case "view.single":
        return on(hasDoc, settings.viewMode === "single");
      case "view.continuous":
        return on(hasDoc, settings.viewMode === "continuous");
      case "view.twoUp":
        return on(hasDoc, settings.viewMode === "twoUp");
      case "view.cover":
        return on(hasDoc && settings.viewMode === "twoUp", settings.coverPage);
      case "view.hand":
        return on(hasDoc, hand);
      case "view.navPane":
        return on(hasDoc, settings.sidebarOpen);
      case "view.toolsPane":
        return on(true, settings.toolsPaneOpen);
      case "view.comments":
        return on(hasDoc, settings.commentsOpen);
      case "view.themeSystem":
        return on(true, settings.theme === "system");
      case "view.themeLight":
        return on(true, settings.theme === "light");
      case "view.themeDark":
        return on(true, settings.theme === "dark");
      case "window.nextTab":
      case "window.prevTab":
        return on(activeDocumentId !== null);
      case "window.calculator":
        return on(hasDoc, settings.calcOpen);
      case "window.tickmarks":
        return on(hasDoc, settings.tickmarkPaletteOpen);
      case "window.stamps":
        return on(hasDoc, settings.stampsPaletteOpen);
      default: {
        const d = appCommand(id);
        // Page commands need a document; the rest always work.
        return on(!(d?.menu === "view" && d.shortcut) || (hasDoc && !!doc));
      }
    }
  };

  const run = (id: string) => {
    const d = appCommand(id);
    if (id in EDIT_KEYS && id !== "edit.copy") return runEdit(id);
    if (id === "edit.copy") return runEdit(id);
    switch (id) {
      case "file.home":
        return wb.setHome(true);
      case "file.createPdf":
        return wb.setDialog({ kind: "createPdf" });
      case "file.combine":
        return wb.setDialog({ kind: "combine", documentId: loadedId });
      case "file.export":
        return loadedId && wb.setDialog({ kind: "exportPdf", documentId: loadedId });
      case "view.single":
        return view("single");
      case "view.continuous":
        return view("continuous");
      case "view.twoUp":
        return view("twoUp");
      case "view.cover":
        return updateSettings({ coverPage: !settings.coverPage });
      case "view.hand":
        return panStore.toggleHand();
      case "view.toolsPane":
        return updateSettings({ toolsPaneOpen: !settings.toolsPaneOpen });
      case "view.comments":
        return updateSettings({ commentsOpen: !settings.commentsOpen });
      case "view.themeSystem":
        return theme("system");
      case "view.themeLight":
        return theme("light");
      case "view.themeDark":
        return theme("dark");
      case "window.moveTab":
        return loadedId && void wb.moveToNewWindow(loadedId);
      case "window.calculator":
        return updateSettings({ calcOpen: !settings.calcOpen });
      case "window.tickmarks":
        return updateSettings({ tickmarkPaletteOpen: !settings.tickmarkPaletteOpen });
      case "window.stamps":
        return updateSettings({ stampsPaletteOpen: !settings.stampsPaletteOpen });
      case "window.customize":
        return wb.setDialog({ kind: "customize" });
      case "window.resetTop":
        return document.dispatchEvent(new Event("pdfwb:reset-top-bar"));
      case "help.shortcuts":
        return wb.setDialog({ kind: "shortcuts" });
      case "help.updates":
        return wb.setDialog({ kind: "about", check: true });
      case "help.defaultApp":
        return wb.setDialog({ kind: "firstRun", startAt: 3 });
      case "help.crash":
        return void platform.app.openCrashFolder();
      case "help.notices":
        return void platform.app.openNotices();
      case "help.about":
        return wb.setDialog({ kind: "about" });
    }
    if (d?.shortcut) dispatchCommand(d.shortcut);
  };

  return { state, run };
}

export type AppCommands = ReturnType<typeof useAppCommands>;
