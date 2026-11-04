// "Open in Acrobat" escape hatch (Phase 10a): every error a person sees about a file on
// disk offers to open that file in Adobe Acrobat or Acrobat Reader instead. Acrobat
// opens the file as saved on disk; unsaved changes in PDF Workbench are not in it.
import { useState } from "react";
import { useCoreState } from "@embedpdf/core/react";
import { PlatformError, platform } from "../../platform";
import { useWorkbench } from "../../app/workbench";

/** The active tab's file on disk, or null (no tab, or an unsaved new document). */
export function useActiveFilePath(): string | null {
  const core = useCoreState();
  const { meta } = useWorkbench();
  const id = core?.activeDocumentId;
  const src = id ? meta[id]?.source : undefined;
  return src?.kind === "path" ? src.path : null;
}

export function AcrobatButton({
  path,
  dirty = false,
  className,
}: {
  /** The file on disk; nothing is shown without one (unsaved new documents). */
  path: string | null | undefined;
  /** The open document has unsaved changes. */
  dirty?: boolean;
  className?: string;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  if (!path) return null;
  const open = async () => {
    setProblem(null);
    try {
      await platform.openInAcrobat(path);
    } catch (e) {
      setProblem(
        e instanceof PlatformError && e.kind === "acrobatMissing"
          ? "Adobe Acrobat or Acrobat Reader is not installed on this computer."
          : `Could not open Acrobat: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  return (
    <span className={`acrobat-escape ${className ?? ""}`}>
      <button
        type="button"
        data-testid="open-in-acrobat"
        title={
          dirty
            ? "Opens the file as last saved. Your unsaved changes here are not in it."
            : "Opens this file in Adobe Acrobat or Acrobat Reader."
        }
        onClick={() => void open()}
      >
        Open in Acrobat
      </button>
      {dirty && <span className="hint"> Opens the last saved version.</span>}
      {problem && (
        <span className="hint error-text" role="status">
          {" "}
          {problem}
        </span>
      )}
    </span>
  );
}
