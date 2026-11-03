// B7: WCAG AA contrast for the design tokens (src/ui/theme/tokens.css), both themes.
// Text pairs need 4.5:1, UI parts (outlines, icons, focus ring) 3:1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(import.meta.dirname, "..", "..", "src", "ui", "theme", "tokens.css"),
  "utf8",
);

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]!] = m[2]!;
  return out;
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const SURFACES = ["bg", "bg-chrome", "bg-panel", "bg-field"];
const TEXT: [string, string[]][] = [
  ["fg", [...SURFACES, "bg-active", "bg-sunken"]],
  ["fg-muted", [...SURFACES, "bg-active"]],
  ["fg-subtle", ["bg-panel", "bg-field", "bg-chrome"]],
  ["accent-ink", ["bg-active"]],
  ["accent-fg", ["accent"]],
  ["accent", ["bg-panel", "bg-chrome", "bg-field"]],
  ["danger", ["bg-panel", "bg-field", "danger-bg"]],
  ["warning", ["bg-panel", "warning-bg"]],
  ["success", ["bg-panel", "success-bg"]],
  ["fg", ["mark"]],
];
const UI: [string, string[]][] = [
  ["border-strong", SURFACES],
  ["focus", [...SURFACES, "bg-active"]],
  ["tickmark", ["bg-chrome", "bg-panel"]],
  ...["green", "violet", "slate", "rose", "amber", "orange", "teal", "blue"].map(
    (t): [string, string[]] => [`tint-${t}`, ["bg-panel", "bg-active"]],
  ),
];

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const)
  describe(`${name} theme contrast`, () => {
    for (const [min, pairs] of [
      [4.5, TEXT],
      [3, UI],
    ] as const)
      for (const [fg, bgs] of pairs)
        for (const bg of bgs)
          it(`--${fg} on --${bg} >= ${min}`, () => {
            expect(theme[fg], `--${fg}`).toBeDefined();
            expect(theme[bg], `--${bg}`).toBeDefined();
            expect(ratio(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(min);
          });
  });
