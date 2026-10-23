// One-time markup setup on top of EmbedPDF's plugins (Phase 3): the Cloud tool, the
// eraser's interaction mode, and the author name on every tool. Renders nothing.
import { useEffect } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useInteractionManagerCapability } from "@embedpdf/plugin-interaction-manager/react";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { CLOUD_INTENSITY } from "../../markup/properties";
import { CLOUD_TOOL, ERASER_MODE, STAMP_MODE, toolDefaults } from "../../markup/config";

export function MarkupBridge({ author }: { author: string }) {
  const { settings } = useWorkbench();
  const { provides: annots } = useAnnotationCapability();
  const { provides: im } = useInteractionManagerCapability();

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

  // Eraser and stamp placement: exclusive page modes (EraserLayer, StampLayer).
  useEffect(() => {
    im?.registerMode({ id: ERASER_MODE, scope: "page", exclusive: true, cursor: "cell" });
    im?.registerMode({ id: STAMP_MODE, scope: "page", exclusive: true, cursor: "copy" });
  }, [im]);

  // New markup is signed with the current author name.
  useEffect(() => {
    if (!annots) return;
    for (const t of annots.getTools()) annots.setToolDefaults(t.id, { author });
  }, [annots, author]);

  return null;
}
