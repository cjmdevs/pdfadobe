// Workpaper Tools commands for the active document (Phase 4), for the tool context.
import { useMemo } from "react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useInteractionManager } from "@embedpdf/plugin-interaction-manager/react";
import { useWorkbench } from "../../app/workbench";
import { drawLegend, drawTickmark, type LegendEntry } from "../../engine/flyer/tickmarks";
import { drawUserStamp, type StampTemplate } from "../../engine/flyer/userStamps";
import { CONNECTOR_STYLES } from "../../flyer/connectors";
import { mergeLibrary, mergeStamps } from "../../flyer/library";
import { pwData } from "../../flyer/items";
import type { FlyerCommands } from "../../tools/registry";
import { FLYER_MODE, flyerPlacement, usePendingItem } from "./flyerStore";
import { stampValues } from "./FlyerLayer";

/** EmbedPDF tool for workpaper notes (a free-text box tagged as a Note; MarkupBridge). */
export const NOTE_TOOL = "workpaperNote";

type Annots = NonNullable<ReturnType<typeof useAnnotation>["provides"]>;
type Im = ReturnType<typeof useInteractionManager>["provides"];

/** Arms a user/status stamp with its reference and custom field values. */
export async function armStamp(
  wb: ReturnType<typeof useWorkbench>,
  annots: Annots | null | undefined,
  im: Im,
  template: StampTemplate,
  ref: string,
  fields: Record<string, string>,
) {
  const sample = await drawUserStamp(template, stampValues(wb, ref, fields));
  annots?.setActiveTool(null);
  annots?.deselectAnnotation();
  flyerPlacement.set({
    kind: "stamp",
    template,
    ref,
    fields,
    width: sample.width,
    height: sample.height,
  });
  im?.activate(FLYER_MODE);
  wb.toast(`Click on the page to place "${template.title}" (Esc stops).`);
}

export function useFlyerCommands(documentId: string, enabled: boolean): FlyerCommands | null {
  const wb = useWorkbench();
  const { settings, updateSettings } = wb;
  const { provides: annots, state } = useAnnotation(documentId);
  const { provides: im, state: imState } = useInteractionManager(documentId);
  const pending = usePendingItem();
  const flyerOn = imState.activeMode === FLYER_MODE;
  const placing = flyerOn && pending?.kind === "tickmark";
  const placingStamp = flyerOn && pending?.kind === "stamp" ? pending.template.id : null;
  const connecting = flyerOn && pending?.kind === "connector";
  const noting = state.activeToolId === NOTE_TOOL;
  const stamps = useMemo(
    () => mergeStamps(settings.firmStampsCache ?? [], settings.stampTemplates),
    [settings.firmStampsCache, settings.stampTemplates],
  );
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
      stamps,
      placingStamp,
      pickStamp(id) {
        const t = stamps.find((e) => e.def.id === id)?.def;
        if (!t) return;
        // A reference or custom fields: asked for first (StampDetails dialog).
        if ((t.kind === "status" && t.showRef) || t.fields.length)
          wb.setDialog({ kind: "workpaperStamp", documentId, templateId: t.id });
        else void armStamp(wb, annots, im, t, "", {}).catch(fail);
      },
      connectorStyles: CONNECTOR_STYLES,
      connectorStyle: settings.connectorStyle,
      connecting,
      connect(styleId) {
        const style =
          CONNECTOR_STYLES.find((c) => c.id === (styleId ?? settings.connectorStyle)) ??
          CONNECTOR_STYLES.find((c) => c.id === "arrow");
        if (!style) return;
        if (style.id !== settings.connectorStyle) updateSettings({ connectorStyle: style.id });
        annots.setActiveTool(null);
        annots.deselectAnnotation();
        flyerPlacement.set({ kind: "connector", style, width: 0, height: 0 });
        im?.activate(FLYER_MODE);
        wb.toast(
          "Click where the connector starts, then where it ends (a tickmark or other mark attaches it). Esc stops.",
        );
      },
      noting,
      setNoting(on) {
        if (on) {
          flyerPlacement.set(null);
          im?.activateDefaultMode();
        }
        annots.setActiveTool(on ? NOTE_TOOL : null);
      },
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
  }, [
    enabled,
    annots,
    im,
    library,
    stamps,
    settings,
    updateSettings,
    placing,
    placingStamp,
    connecting,
    noting,
    state.byUid,
    wb,
    documentId,
  ]);
}
