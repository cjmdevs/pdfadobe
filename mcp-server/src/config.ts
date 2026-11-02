// Start-up settings. The extension's manifest passes them on the command line:
//
//   node server.mjs [--app=<PDF Workbench.exe>] <folder> <folder> ...
//
// (mcpb expands the "folders" setting into one argument per folder.)
//
// Whether Tier B tools exist is NOT a command-line or extension setting, because any
// user could change those. It comes from a machine policy only an administrator can
// write: HKLM\Software\Policies\PDF Workbench\MCP, DWORD AllowContentToClaude = 1.
import { execFile } from "node:child_process";

export interface Config {
  folders: string[];
  /** PDF Workbench.exe from settings, or null to look in the usual install folders. */
  appPath: string | null;
}

export function parseArgs(argv: string[]): Config {
  const folders: string[] = [];
  let appPath: string | null = null;
  for (const a of argv) {
    // An unset optional setting may arrive empty or as the raw "${user_config...}".
    if (a.startsWith("--app="))
      appPath =
        a
          .slice(6)
          .trim()
          .replace(/^\$\{.*\}$/, "") || null;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (a.trim()) folders.push(a);
  }
  return { folders, appPath };
}

export const POLICY_KEY = "HKLM\\Software\\Policies\\PDF Workbench\\MCP";
export const POLICY_VALUE = "AllowContentToClaude";

/** `reg query` output -> the DWORD is 1. Anything else (missing, 0, a string) is off. */
export function parsePolicy(stdout: string): boolean {
  const m = new RegExp(`${POLICY_VALUE}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, "i").exec(stdout);
  return !!m && parseInt(m[1] ?? "0", 16) === 1;
}

/** Reads the firm's policy. Any failure (no key, no reg.exe) means Tier B stays off. */
export function readContentPolicy(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", POLICY_KEY, "/v", POLICY_VALUE],
      { windowsHide: true, timeout: 10_000 },
      (err, stdout) => resolve(!err && parsePolicy(stdout)),
    );
  });
}
