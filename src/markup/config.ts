// EmbedPDF annotation plugin setup (Phase 3). No React here.

import type { AnnotationPluginConfig } from "@embedpdf/plugin-annotation";
import type { Settings } from "../app/settings";

/** Used until the Windows display name arrives (and in the browser build). */
export const FALLBACK_AUTHOR = "Reviewer";

export function markupConfig(settings: Settings): Partial<AnnotationPluginConfig> {
  return {
    autoCommit: true,
    annotationAuthor: settings.authorName ?? FALLBACK_AUTHOR,
    colorPresets: settings.markupColors,
    selectAfterCreate: true,
    deactivateToolAfterCreate: false,
    // Links open only through the viewer's own handling (no network calls).
    autoOpenLinks: false,
  };
}
