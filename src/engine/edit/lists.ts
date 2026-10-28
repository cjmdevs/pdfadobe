// Edit PDF (B3 stage 2): bulleted and numbered lists. A list paragraph's marker is
// generated here (numbers count up through consecutive paragraphs of the same list)
// and drawn at the paragraph's left indent, with the text on a hanging indent.

/** Bullet glyphs offered (all in WinAnsi, so the standard fonts have them too). */
export const BULLET_STYLES = ["•", "–", "o"] as const;
/** Number formats: "1." 1, 2, 3; "a." a, b, c; "i." i, ii, iii; capitals; "1)". */
export const NUMBER_STYLES = ["1.", "1)", "a.", "A.", "i.", "I."] as const;
export type NumberStyle = (typeof NUMBER_STYLES)[number];

export type ListStyle =
  { kind: "bullet"; glyph: string } | { kind: "number"; format: NumberStyle; start?: number };

/** Space from the marker to the text when a list is made (points). */
export const HANG = 18;

const roman = (n: number): string => {
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
};

const letters = (n: number): string => {
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** The marker for item `n` (1-based) of a list. */
export function markerText(list: ListStyle, n: number): string {
  if (list.kind === "bullet") return list.glyph;
  const i = (list.start ?? 1) + n - 1;
  switch (list.format) {
    case "1.":
      return `${i}.`;
    case "1)":
      return `${i})`;
    case "a.":
      return `${letters(i)}.`;
    case "A.":
      return `${letters(i).toUpperCase()}.`;
    case "i.":
      return `${roman(i)}.`;
    case "I.":
      return `${roman(i).toUpperCase()}.`;
  }
}

/** The list a marker found on the page belongs to ("3." a numbered list, "•" bullets). */
export function listOf(marker: string): ListStyle {
  const num = /^\(?(\d+|[a-z]+|[A-Z]+)([.)])$/.exec(marker);
  if (!num) return { kind: "bullet", glyph: marker };
  const [, body = "", end = "."] = num;
  if (/^\d+$/.test(body))
    return { kind: "number", format: end === ")" ? "1)" : "1.", start: Number(body) };
  // Roman numerals win over letters for i, v, x... ("c." is a letter list's 3rd item, rarely).
  if (/^[ivxl]+$/.test(body)) return { kind: "number", format: "i." };
  if (/^[IVXL]+$/.test(body)) return { kind: "number", format: "I." };
  return { kind: "number", format: body === body.toUpperCase() ? "A." : "a." };
}

/**
 * The marker of each paragraph: list paragraphs get theirs (numbers counting up while
 * the same kind of list continues), others none.
 */
export function numberLists(lists: (ListStyle | null | undefined)[]): (string | null)[] {
  let count = 0;
  let prev: ListStyle | null = null;
  return lists.map((l) => {
    if (!l) {
      prev = null;
      count = 0;
      return null;
    }
    const same =
      prev &&
      prev.kind === l.kind &&
      (l.kind === "bullet" || (prev.kind === "number" && prev.format === l.format));
    count = same ? count + 1 : 1;
    // A list keeps the start of its first item.
    const start = prev?.kind === "number" ? prev.start : undefined;
    const first: ListStyle =
      same && l.kind === "number" && start !== undefined ? { ...l, start } : l;
    prev = first;
    return markerText(first, count);
  });
}
