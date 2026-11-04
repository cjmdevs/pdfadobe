// Phase 10a: every error a person sees about a file offers "Open in Acrobat".
// Error toasts get it centrally (workbench toast + Toasts). This test finds every other
// error element in the UI (role="alert", class error / error-text) and requires the
// file to use <AcrobatButton>, unless it is listed below with the reason it is not an
// error about the file (input checks, notes).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

const NOT_FILE_ERRORS: Record<string, string> = {
  "src/ui/convert/ConvertDialogs.tsx": "'needs Microsoft Word' note on a source row",
  "src/ui/decorate/DecorateDialog.tsx": "page-range input check",
  "src/ui/scan/ScanPanel.tsx": "page-range input check",
  "src/ui/redact/RedactPanel.tsx": "search pattern input check",
  "src/ui/edit/BoxFields.tsx": "text does not fit the box (editing note)",
  "src/ui/edit/EditPanel.tsx": "text does not fit the box (editing note)",
  "src/ui/forms/XfaNotice.tsx": "has its own Open in Acrobat button",
  "src/ui/kit/AcrobatButton.tsx": "the button itself",
  "src/ui/UpdateDialog.tsx": "update problems are not about a document",
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ERROR_UI = /role="alert"|className="[^"]*\berror(-text)?\b[^"]*"/;

describe("Open in Acrobat escape hatch", () => {
  it("every file with error UI uses AcrobatButton or says why not", () => {
    const missing: string[] = [];
    for (const f of [...tsxFiles(join(root, "src", "ui")), ...tsxFiles(join(root, "src", "app"))]) {
      const rel = relative(root, f).replaceAll("\\", "/");
      const text = readFileSync(f, "utf8");
      if (!ERROR_UI.test(text) || rel in NOT_FILE_ERRORS) continue;
      if (!text.includes("<AcrobatButton")) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("error toasts render the button", () => {
    const toasts = readFileSync(join(root, "src", "ui", "StartPage.tsx"), "utf8");
    expect(toasts).toMatch(/t\.tone === "error"[\s\S]*<AcrobatButton path=\{t\.path\}/);
  });
});
