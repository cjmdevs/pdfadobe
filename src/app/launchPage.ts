// A launch path may carry the page to show: "<path>|page=N" (1-based), added by the
// Rust side for `--page=N` (the MCP server's open_in_app). "|" cannot be in a Windows path.

const MARK = /\|page=(\d+)$/;

export function splitLaunchPage(raw: string): { path: string; page: number | null } {
  const m = MARK.exec(raw);
  if (!m) return { path: raw, page: null };
  const n = Number(m[1]);
  return { path: raw.slice(0, m.index), page: n >= 1 ? n : null };
}
