// Fonts of a PDF as qpdf sees them (no PDFium code): name, subtype, whether a font
// program is embedded, whether there is a ToUnicode map. Edit PDF tests.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qpdfBin } from "../corpus/generate.mjs";

export interface FontInfo {
  /** "/ABCDEF+Calibri", "/Helvetica". */
  base: string;
  subtype: string;
  embedded: boolean;
  toUnicode: boolean;
}

type Obj = Record<string, unknown>;

export function inspectFonts(bytes: Uint8Array): FontInfo[] {
  const dir = mkdtempSync(join(tmpdir(), "pdfwb-fonts-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, bytes);
    const json = JSON.parse(
      execFileSync(qpdfBin(), ["--json=2", "--json-key=qpdf", file], {
        maxBuffer: 256 * 1024 * 1024,
        encoding: "utf8",
      }),
    ) as { qpdf: [unknown, Record<string, { value?: Obj }>] };
    const objs = json.qpdf[1];
    const get = (v: unknown): Obj | undefined =>
      typeof v === "string" && / R$/.test(v) ? objs[`obj:${v}`]?.value : (v as Obj | undefined);
    return Object.values(objs)
      .map((o) => o.value)
      .filter((v): v is Obj => !!v && v["/Type"] === "/Font" && v["/Subtype"] !== "/CIDFontType2")
      .map((f) => {
        let desc = get(f["/FontDescriptor"]);
        const kids = get(f["/DescendantFonts"]) as unknown;
        if (Array.isArray(kids)) desc = get(get(kids[0])?.["/FontDescriptor"]);
        return {
          base: String(f["/BaseFont"]),
          subtype: String(f["/Subtype"]),
          embedded: !!desc && ("/FontFile2" in desc || "/FontFile3" in desc || "/FontFile" in desc),
          toUnicode: "/ToUnicode" in f,
        };
      });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
