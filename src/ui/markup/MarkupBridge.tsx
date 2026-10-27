// One-time markup setup on top of EmbedPDF's plugins (Phase 3): the Cloud tool, the
// eraser's interaction mode, and the author name on every tool. Renders nothing.
import { useEffect } from "react";
import { useAnnotationCapability, useAnnotationPlugin } from "@embedpdf/plugin-annotation/react";
import { installCommitRaceGuard } from "../../markup/commitRaceGuard";
import { useInteractionManagerCapability } from "@embedpdf/plugin-interaction-manager/react";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { CLOUD_INTENSITY } from "../../markup/properties";
import { CLOUD_TOOL, ERASER_MODE, STAMP_MODE, toolDefaults } from "../../markup/config";
import { EDIT_MODE } from "../edit/editStore";
import { FLYER_MODE } from "../flyer/flyerStore";

/** Stand-in pointer event for the cancel call (handlers release capture on it). */
const NO_EVENT = {
  clientX: 0,
  clientY: 0,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  target: null,
  currentTarget: null,
  stopImmediatePropagation: () => undefined,
  isImmediatePropagationStopped: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
};

/** Handler factories already given the cancel-on-tool-off behaviour. */
const CANCEL_WRAPPED = new WeakSet<object>();

export function MarkupBridge({ author }: { author: string }) {
  const { settings } = useWorkbench();
  const { provides: annots } = useAnnotationCapability();
  const { provides: im } = useInteractionManagerCapability();
  const { plugin } = useAnnotationPlugin();

  // Changes made while a commit runs must not be marked saved (see commitRaceGuard).
  useEffect(() => {
    if (plugin && !installCommitRaceGuard(plugin))
      console.warn("annotation commit guard not installed: plugin internals changed");
  }, [plugin]);

  // Cloud: EmbedPDF's polygon tool with a cloudy border (Acrobat's Cloud tool).
  useEffect(() => {
    if (!annots || annots.getTool(CLOUD_TOOL)) return;
    const polygon = annots.getTool("polygon");
    if (!polygon) return;
    annots.addTool({
      ...polygon,
      id: CLOUD_TOOL,
      name: "Cloud",
      matchScore: (a: PdfAnnotationObject) =>
        a.type === PdfAnnotationSubtype.POLYGON &&
        ((a as { cloudyBorderIntensity?: number }).cloudyBorderIntensity ?? 0) > 0
          ? 20
          : 0,
      defaults: {
        ...polygon.defaults,
        strokeStyle: PdfAnnotationBorderStyle.CLOUDY,
        cloudyBorderIntensity: CLOUD_INTENSITY,
        intent: "PolygonCloud",
        ...toolDefaults(settings, CLOUD_TOOL),
      },
    });
    // Once: later "Make default" changes go through setToolDefaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annots]);

  // A shape drawn by clicks (polygon, polyline, cloud, callout) or a drag in progress is
  // dropped when its tool goes off (Esc, another tool): EmbedPDF's handlers keep their
  // half-made shape otherwise and continue it next time. Ink is left alone (its strokes
  // are committed on a timer).
  useEffect(() => {
    if (!annots) return;
    for (const t of annots.getTools()) {
      const ph = t.pointerHandler;
      if (!ph || t.id === "ink" || t.id === "inkHighlighter" || CANCEL_WRAPPED.has(ph)) continue;
      const wrapped: typeof ph = {
        ...ph,
        create(ctx) {
          const h = ph.create(ctx);
          return {
            ...h,
            onHandlerActiveEnd(mode: string) {
              h.onHandlerActiveEnd?.(mode);
              h.onPointerCancel?.({ x: 0, y: 0 }, NO_EVENT, mode);
            },
          };
        },
      };
      CANCEL_WRAPPED.add(wrapped);
      annots.addTool({ ...t, pointerHandler: wrapped });
    }
  }, [annots]);

  // Eraser and stamp placement: exclusive page modes (EraserLayer, StampLayer).
  useEffect(() => {
    im?.registerMode({ id: ERASER_MODE, scope: "page", exclusive: true, cursor: "cell" });
    im?.registerMode({ id: STAMP_MODE, scope: "page", exclusive: true, cursor: "copy" });
    // Workpaper Tools (Phase 4): tickmarks and legend boxes (FlyerLayer).
    im?.registerMode({ id: FLYER_MODE, scope: "page", exclusive: true, cursor: "copy" });
    // Edit PDF (B3): EditLayer handles the pointer while the Edit tool is open.
    im?.registerMode({ id: EDIT_MODE, scope: "page", exclusive: true, cursor: "default" });
  }, [im]);

  // New markup is signed with the current author name.
  useEffect(() => {
    if (!annots) return;
    for (const t of annots.getTools()) annots.setToolDefaults(t.id, { author });
  }, [annots, author]);

  return null;
}
