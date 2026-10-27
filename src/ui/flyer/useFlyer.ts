// Workpaper Tools commands for the active document (Phase 4), for the tool context.
import { useMemo } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { drawLegend, drawTickmark, type LegendEntry } from "../../engine/flyer/tickmarks";
import { mergeLibrary } from "../../flyer/library";
import { pwData } from "../../flyer/items";
import type { FlyerCommands } from "../../tools/registry";
import { FLYER_MODE, flyerPlacement, usePendingItem } from "./flyerStore";

export function useFlyerCommands(documentId: string, enabled: boolean): FlyerCommands | null {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const { provides: annots, state } = useAnnotation(documentId);
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const pending = usePendingItem();
  const placing = imState.activeMode === FLYER_MODE && pending?.kind === "tickmark";
  const library = useMemo(
    () => mergeLibrary(settings.firmTickmarksCache ?? [], settings.tickmarks),
    [settings.firmTickmarksCache, settings.tickmarks],
  );
  return useMemo(() => {
    if (!enabled || !annots) return null;
    const find = (id: string) => library.find((e) => e.def.id === id)?.def ?? null;
    const active = find(settings.activeTickmark) ?? library[0]?.def ?? null;
    const fail = (e: unknown) =>
      wb.toast(`Tickmark failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    return {
      library,
      active,
      recent: settings.recentTickmarks.map(find).filter((d) => d !== null),
      placing,
      arm(id) {
        const def = (id ? find(id) : null) ?? active;
        if (!def) return;
        if (def.id !== settings.activeTickmark) updateSettings({ activeTickmark: def.id });
        void drawTickmark(def, def.sequence === "numbers" ? "1" : "A").then((art) => {
          annots.setActiveTool(null);
          annots.deselectAnnotation();
          flyerPlacement.set({ kind: "tickmark", def, width: art.width, height: art.height });
          im?.activate(FLYER_MODE);
        }, fail);
      },
      stop() {
        flyerPlacement.set(null);
        im?.activateDefaultMode();
      },
      clearRecent: () => updateSettings({ recentTickmarks: [] }),
      insertLegend() {
        // Each tickmark used in this document, once, in library order.
        const used = new Map<string, LegendEntry>();
        for (const t of Object.values(state.byUid)) {
          const d = pwData(t.object);
          const def = d?.pwTick ? find(d.pwTick) : null;
          if (def && !used.has(def.id))
            used.set(def.id, {
              def,
              meaning: def.meaning,
              ...(d?.pwLabel ? { label: d.pwLabel } : {}),
            });
        }
        const entries = library.flatMap((e) => used.get(e.def.id) ?? []);
        if (!entries.length) {
          wb.toast("No tickmarks from the library are on this document yet.");
          return;
        }
        void drawLegend(entries).then((art) => {
          annots.setActiveTool(null);
          flyerPlacement.set({ kind: "legend", art, width: art.width, height: art.height });
          im?.activate(FLYER_MODE);
          wb.toast("Click on the page to place the tickmark legend (Esc cancels).");
        }, fail);
      },
    };
  }, [enabled, annots, im, library, settings, updateSettings, placing, state.byUid, wb]);
}
