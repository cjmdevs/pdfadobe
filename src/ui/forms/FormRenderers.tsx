// Registers the form plugin's field renderers with our text field in place of its own
// (see TextFill.tsx). The annotation renderer registry keeps one entry per id, the last
// registered wins, so this re-registers whenever the plugin's entry is the one in use.

import { useEffect, useMemo } from "react";
import {
  useRegisteredRenderers,
  useRendererRegistry,
  type BoxedAnnotationRenderer,
} from "@embedpdf/plugin-annotation/react";
import { formRenderers } from "@embedpdf/plugin-form/react";
import { TextFill } from "./TextFill";

const TEXT_ID = "formTextField";

export function FormRenderers() {
  const register = useRendererRegistry();
  const current = useRegisteredRenderers();
  const ours = useMemo<BoxedAnnotationRenderer[]>(
    () =>
      formRenderers.map((r) =>
        r.id === TEXT_ID ? { ...r, renderLocked: (p) => <TextFill {...p} /> } : r,
      ),
    [],
  );
  const inUse = current.find((r) => r.id === TEXT_ID)?.renderLocked;
  const mine = ours.find((r) => r.id === TEXT_ID)?.renderLocked;
  useEffect(() => {
    if (register && inUse !== mine) register(ours);
  }, [register, inUse, mine, ours]);
  return null;
}
