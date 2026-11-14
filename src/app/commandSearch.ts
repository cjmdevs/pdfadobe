// Command search (B8, Alt+Q): finds tools, menu commands, settings and help pages by
// words. Pure ranking, no DOM. Every word typed must match the start of a word in the
// item's name or keywords; names beat keywords, and a name that starts with the query
// comes first.

export type SearchKind = "tool" | "command" | "setting" | "help";

export interface SearchItem {
  kind: SearchKind;
  id: string;
  label: string;
  /** Where it lives ("View › Zoom", "Preferences › Page Display"). */
  where: string;
  keywords?: string | undefined;
  /** Shortcut to show ("Ctrl+K"). */
  shortcut?: string | undefined;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[…()&,./›>-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Score one item; 0 = no match. */
export function scoreItem(query: string, item: SearchItem): number {
  const q = words(query);
  if (!q.length) return 0;
  const name = words(item.label);
  const extra = words(`${item.keywords ?? ""} ${item.where}`);
  let score = 0;
  for (const t of q) {
    if (name.some((w) => w === t)) score += 6;
    else if (name.some((w) => w.startsWith(t))) score += 4;
    else if (extra.some((w) => w.startsWith(t))) score += 1;
    else if (t.length >= 3 && item.label.toLowerCase().includes(t)) score += 2;
    else return 0;
  }
  if (item.label.toLowerCase().startsWith(query.trim().toLowerCase())) score += 5;
  // Tools and commands before settings and help when equal.
  score += item.kind === "tool" ? 0.3 : item.kind === "command" ? 0.2 : 0;
  return score;
}

export function searchItems(query: string, items: SearchItem[], limit = 12): SearchItem[] {
  return items
    .map((it, i) => ({ it, i, s: scoreItem(query, it) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it);
}
