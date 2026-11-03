// B7: capture UI screenshots into a folder (default docs/ui/audit).
// npm run ui:shots -- docs/ui/after
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? "docs/ui/audit");
const r = spawnSync("npx", ["playwright", "test", "tests/e2e/ui-shots.spec.ts", "--workers=4"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, UI_SHOTS: out },
});
process.exit(r.status ?? 1);
