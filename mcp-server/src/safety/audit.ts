// Audit log: one JSON line per tool call in
// `<root>\_workspace\_audit\mcp-audit-YYYY-MM.jsonl`, in the configured folder the call
// worked in (the first configured folder when it named none, or only refused paths).
//
// Logged: tool, tier, file paths, page ranges, output paths, time, Windows user, and
// whether it worked. Never logged: document text, form values, tool output text, or
// error messages (they can quote document data); a failure records the error's name.
import { appendFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { isInside, realpathNative, type Root } from "./roots";
import { AUDIT, ensureDir, WORKSPACE } from "./writer";

export interface AuditEntry {
  time: string;
  user: string;
  tool: string;
  /** "B" marks a call that returned document content to Claude. */
  tier: "A" | "B";
  files: string[];
  pages?: string;
  outputs?: string[];
  result: "ok" | "error";
  error?: string;
}

export function windowsUser(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USERNAME ?? "unknown";
  }
}

export async function writeAudit(root: Root, entry: AuditEntry): Promise<void> {
  const dir = await ensureDir(root, [WORKSPACE, AUDIT]);
  const file = join(dir, `mcp-audit-${entry.time.slice(0, 7)}.jsonl`);
  // A pre-existing log that is a link to somewhere else is refused.
  const real = await realpathNative(file).catch(() => file);
  if (!isInside(real, dir)) throw new Error("the audit log is a link to another place");
  await appendFile(real, JSON.stringify(entry) + "\n", { encoding: "utf8" });
}
