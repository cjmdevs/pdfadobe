# mcp-server

Local MCP server for Claude (Phase 9). Official TypeScript SDK v2
(`@modelcontextprotocol/server`), stdio only, packaged as a `.mcpb` for Claude Desktop.
It imports `src/engine/` directly: there is no second copy of any PDF logic.

## Commands

- `npm run mcp:build` builds `dist/bundle/` and packs `dist/pdf-workbench.mcpb`
- `npm run mcp:inspect` runs every Tier A tool of the built bundle through the MCP Inspector CLI
- `npx vitest run tests/unit/mcp-` runs the server tests (tools, safety, no network, stdio bundle)

## Safety rules (enforced in code)

| Rule                                                                                                                                                                                                               | Where                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Only configured folders are reachable (real path via Windows, junctions/ADS/device paths refused)                                                                                                                  | `src/safety/roots.ts`                                    |
| Changes work on a copy in `<folder>\_workspace\<YYYY-MM-DD>_<task>\`; results go to `<folder>\Outputs\`; nothing is overwritten; nothing is written elsewhere (qpdf/Tesseract job folders live in the task folder) | `src/safety/writer.ts`, `src/runtime/`                   |
| SSN/EIN/account-like numbers in created names are masked                                                                                                                                                           | `maskIds` in `src/safety/writer.ts`                      |
| No send/email/upload/share code; no network (WASM from local bytes, `fontFallback: null`)                                                                                                                          | `src/runtime/index.ts`, `tests/unit/mcp-network.test.ts` |
| Every call audited (tool, tier, paths, pages, outputs, time, Windows user; never text) in `<folder>\_workspace\_audit\`                                                                                            | `src/safety/audit.ts`                                    |
| Tier B tools exist only with the machine policy `HKLM\Software\Policies\PDF Workbench\MCP`, DWORD `AllowContentToClaude` = 1                                                                                       | `src/config.ts`, `src/tools/content.ts`                  |
| Text only via `pageText` (getPageGlyphs guard); ESLint bans `extractText` here                                                                                                                                     | `eslint.config.js`                                       |

## Settings (manifest `user_config`)

- **Shared folders** (required, several allowed): the only folders the server may use.
- **PDF Workbench program** (optional): for `open_in_app`; empty = usual install folders.

Turn Tier B on for a PC (administrator PowerShell), then restart Claude Desktop:

```powershell
New-Item -Path 'HKLM:\Software\Policies\PDF Workbench\MCP' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\Software\Policies\PDF Workbench\MCP' -Name AllowContentToClaude -Value 1 -Type DWord
```
