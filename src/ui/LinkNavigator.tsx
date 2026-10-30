// Links in the viewer: a click on a link goes where it points. Link annotations are
// locked (App.tsx), so the annotation plugin draws them as click targets instead of
// movable markup; a page link scrolls there by itself. A web or email link is handed
// to us: we ask first, then open it in the default browser or mail program (the app
// itself makes no network call). Anything else (a file, a program) is not opened.
import { useEffect } from "react";
import { useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useWorkbench } from "../app/workbench";
import { platform } from "../platform";

/** Web and email addresses only. */
export const OPENABLE = /^(https?:\/\/|mailto:)/i;

export function LinkNavigator() {
  const wb = useWorkbench();
  const { provides } = useAnnotationCapability();
  useEffect(() => {
    if (!provides) return;
    return provides.onNavigate((e) => {
      if (e.result.outcome !== "uri") return;
      const uri = e.result.uri.trim();
      if (!OPENABLE.test(uri)) {
        wb.toast(
          "This link points to something other than a web or email address. It was not opened.",
          "error",
        );
        return;
      }
      void wb
        .confirm({
          title: "Open link",
          message: `Open ${uri} in your ${uri.toLowerCase().startsWith("mailto:") ? "email program" : "web browser"}?`,
          ok: "Open",
        })
        .then((yes) => (yes ? platform.openUrl(uri) : undefined))
        .catch((err: unknown) =>
          wb.toast(err instanceof Error ? err.message : String(err), "error"),
        );
    });
  }, [provides, wb]);
  return null;
}
