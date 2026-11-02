// Entry point: `node server.mjs [--app=<exe>] <folder> ...`, stdio transport only.
// stdout carries MCP messages, so nothing else may print there; problems go to stderr
// without document data.
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readContentPolicy } from "./config";
import { findPaths, loadRuntime } from "./runtime";
import { Roots } from "./safety/roots";
import { createServer, ToolError } from "./server";

/** Usual install places of PDF Workbench (NSIS per-user, MSI per-machine). */
export function appCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const base of [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (!base) continue;
    out.push(join(base, "PDF Workbench", "PDF Workbench.exe"));
    out.push(join(base, "PDF Workbench", "pdf-workbench.exe"));
  }
  return out;
}

export function launcher(appPath: string | null) {
  return async (file: string, page: number): Promise<void> => {
    const exe = appPath ?? appCandidates().find((c) => existsSync(c));
    if (!exe || !existsSync(exe)) {
      throw new ToolError(
        "PDF Workbench was not found. Set its location in the extension settings.",
      );
    }
    const child = spawn(exe, [file, `--page=${page}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.on("error", () => undefined);
    child.unref();
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const roots = await Roots.create(config.folders);
  const here = dirname(fileURLToPath(import.meta.url));
  const rt = await loadRuntime(findPaths(here));
  const allowContent = await readContentPolicy();
  const deps = { roots, rt, allowContent, openInApp: launcher(config.appPath) };
  serveStdio(() => createServer(deps), {
    onerror: (e) => process.stderr.write(`pdf-workbench mcp: ${e.name}\n`),
  });
}

main().catch((e: unknown) => {
  process.stderr.write(`pdf-workbench mcp could not start: ${(e as Error).message}\n`);
  process.exit(1);
});
