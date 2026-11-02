// Builds the MCP server bundle and packs it as a .mcpb (Phase 9).
//
//   node mcp-server/build.mjs            -> mcp-server/dist/pdf-workbench.mcpb
//   node mcp-server/build.mjs --no-pack  -> only mcp-server/dist/bundle/
//
// Layout inside the bundle (runtime/index.ts `bundledPaths`):
//   manifest.json
//   server/server.mjs            esbuild bundle of mcp-server/src/main.ts + src/engine
//   server/pdfium.wasm           @embedpdf/pdfium (loaded from these bytes, never a CDN)
//   server/harfbuzz-subset.wasm  harfbuzzjs (font subsetting in optimize)
//   server/bin/qpdf/             qpdf 12.4.2 sidecar (src-tauri/vendor/qpdf)
//   server/bin/tesseract/        Tesseract 5.5.4 sidecar + eng/osd tessdata
//   THIRD-PARTY-LICENSES.txt     license text of every bundled package and sidecar
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const require = createRequire(join(repo, "package.json"));

const QPDF_FILES = [
  "qpdf.exe",
  "qpdf30.dll",
  "concrt140.dll",
  "msvcp140.dll",
  "msvcp140_1.dll",
  "msvcp140_2.dll",
  "msvcp140_atomic_wait.dll",
  "msvcp140_codecvt_ids.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
  "LICENSE.html",
];

/** Bundles the server into `out` (deleted first). Returns the bundle folder. */
export async function buildBundle(out = join(here, "dist", "bundle")) {
  rmSync(out, { recursive: true, force: true });
  const server = join(out, "server");
  mkdirSync(server, { recursive: true });

  const result = await build({
    entryPoints: [join(here, "src", "main.ts")],
    outfile: join(server, "server.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    metafile: true,
    legalComments: "none",
    logLevel: "warning",
    // Some CommonJS dependencies call require() for Node built-ins.
    banner: {
      js: 'import { createRequire as __pdfwbCreateRequire } from "node:module"; const require = __pdfwbCreateRequire(import.meta.url);',
    },
  });

  cpSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"), join(server, "pdfium.wasm"));
  cpSync(
    require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"),
    join(server, "harfbuzz-subset.wasm"),
  );

  const vendor = join(repo, "src-tauri", "vendor");
  const qpdfOut = join(server, "bin", "qpdf");
  mkdirSync(qpdfOut, { recursive: true });
  for (const f of QPDF_FILES) {
    const src = join(vendor, "qpdf", f);
    if (!existsSync(src)) throw new Error(`missing ${src}: run npm run fetch-win-binaries`);
    cpSync(src, join(qpdfOut, f));
  }
  const tess = join(vendor, "tesseract");
  if (!existsSync(join(tess, "tesseract.exe")))
    throw new Error("missing tesseract.exe: run npm run build-tesseract");
  const tessOut = join(server, "bin", "tesseract");
  mkdirSync(join(tessOut, "tessdata"), { recursive: true });
  for (const f of readdirSync(tess)) {
    if (f === "tesseract.exe" || f.startsWith("LICENSE")) cpSync(join(tess, f), join(tessOut, f));
  }
  for (const f of ["eng.traineddata", "osd.traineddata", "pdf.ttf", "LICENSE.txt"]) {
    cpSync(join(tess, "tessdata", f), join(tessOut, "tessdata", f));
  }

  const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
  manifest.version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(out, "THIRD-PARTY-LICENSES.txt"), licenses(result.metafile));
  return out;
}

/** License files of every npm package that ended up in the bundle, plus the sidecars. */
function licenses(metafile) {
  const pkgs = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = input.split(/[\\/]/);
    const i = parts.lastIndexOf("node_modules");
    if (i < 0) continue;
    const name = parts[i + 1]?.startsWith("@") ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
    const dir = join(repo, ...parts.slice(0, i + 1), ...name.split("/"));
    if (!pkgs.has(name)) pkgs.set(name, dir);
  }
  for (const name of ["@embedpdf/pdfium", "harfbuzzjs"]) {
    if (!pkgs.has(name)) pkgs.set(name, join(repo, "node_modules", ...name.split("/")));
  }
  let text =
    "PDF Workbench MCP server: third-party licenses.\n\n" +
    "Sidecars: qpdf 12.4.2 (Apache-2.0, see server/bin/qpdf/LICENSE.html; ships Microsoft\n" +
    "Visual C++ runtime DLLs under Microsoft's redistributable license), Tesseract 5.5.4\n" +
    "(Apache-2.0), Leptonica 1.87.0 (BSD-2-Clause), zlib 1.3.1 (Zlib), tessdata 4.1.0\n" +
    "(Apache-2.0); license texts in server/bin/tesseract/.\n\n";
  for (const [name, dir] of [...pkgs].sort()) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
    text += `${"=".repeat(78)}\n${name} ${pkg.version} (${pkg.license ?? "see file"})\n${"=".repeat(78)}\n`;
    text += file
      ? readFileSync(join(dir, file), "utf8").trim() + "\n\n"
      : "(no license file in package)\n\n";
  }
  return text;
}

function mcpb(...args) {
  const cli = join(repo, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
  execFileSync(process.execPath, [cli, ...args], { stdio: "inherit" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await buildBundle();
  console.log(`bundle: ${relative(repo, out)}${sep}`);
  if (!process.argv.includes("--no-pack")) {
    mcpb("validate", join(out, "manifest.json"));
    const file = join(here, "dist", "pdf-workbench.mcpb");
    rmSync(file, { force: true });
    mcpb("pack", out, file);
    console.log(`packed: ${relative(repo, file)}`);
  }
}
