// A tickmark drawn for the screen (palette, menus, library): the same shapes as the PDF
// appearance in src/engine/flyer/tickmarks.ts, as SVG.
import { useMemo } from "react";
import type { TickMark, TickmarkDef } from "../../engine/flyer/tickmarks";

const PATHS: Record<TickMark, { d: string; w: number }> = {
  check: { d: "M 0.05 0.55 L 0.38 0.9 L 0.95 0.08", w: 1 },
  caretUp: { d: "M 0.05 0.9 L 0.4 0.12 L 0.75 0.9", w: 0.8 },
  caretLeft: { d: "M 0.75 0.1 L 0.1 0.5 L 0.75 0.9", w: 0.8 },
};

export function TickmarkIcon({
  def,
  size = 20,
  label,
}: {
  def: TickmarkDef;
  size?: number;
  /** The letter or number of a letter/number tickmark. */
  label?: string | undefined;
}) {
  const src = useMemo(
    () => (def.image ? `data:${def.image.mime};base64,${def.image.data}` : null),
    [def.image],
  );
  if (src) return <img src={src} alt="" style={{ height: size, maxWidth: size * 2 }} />;
  const kind = def.sequence ?? def.variable;
  const text = kind ? (label ?? (kind === "letters" ? "A" : "1")) : (def.text ?? "");
  const mark = def.mark ? PATHS[def.mark] : null;
  // Units of the symbol height; text is roughly 0.6 wide per letter.
  const textW = text.length * 0.62;
  const w = Math.max((mark?.w ?? 0) + (mark && text ? 0.1 : 0) + textW, def.circle ? 1.1 : 0.4);
  const pad = 0.25;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${w + pad * 2} ${1 + pad * 2}`}
      height={size}
      aria-hidden="true"
      style={{ color: def.color, overflow: "visible" }}
    >
      {mark && <path d={mark.d} fill="none" stroke="currentColor" strokeWidth={0.13} />}
      {text && (
        <text
          x={(mark ? mark.w + 0.1 : 0) + textW / 2}
          y={0.86}
          fontSize={1.05}
          fontFamily="Helvetica, Arial, sans-serif"
          fontWeight="bold"
          textAnchor="middle"
          fill="currentColor"
        >
          {text}
        </text>
      )}
      {def.circle && (
        <ellipse
          cx={w / 2}
          cy={0.5}
          rx={w / 2 + 0.15}
          ry={0.68}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.1}
        />
      )}
    </svg>
  );
}
