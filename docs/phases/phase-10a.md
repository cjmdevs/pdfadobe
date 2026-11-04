# Phase 10a: Packaging

Spec as given by the owner on 2026-11-04 (plan approved the same day with the
recommended answers listed under "Decisions").

## Spec

- Tauri Windows installer (check current Tauri docs for MSI vs NSIS; recommend one).
- Bundle qpdf and Tesseract sidecars with English language data; WebView2 bootstrap.
- Code signing hook (certificate supplied later); build fails if unsigned in release.
- Auto-update from a firm-controlled location with signed update manifests.
- First-run setup: author name, firm library path, file association prompt (Windows
  doesn't allow apps to silently become default; walk the user through it).
- Generate THIRD-PARTY-NOTICES.txt from npm and cargo metadata at build time and ship it
  with the installer; fail the build if any dependency lacks license text.
- Crash reporting to a local file only; "Open in Acrobat" escape hatch on every error
  dialog.
- Admin guide in docs/admin.md: install, update, set default app, uninstall, rollback.

## Decisions (owner, 2026-11-04)

0. Installer: NSIS only (`targets: ["nsis"]`). WebView2 `embedBootstrapper`.
1. Updates come from a firm share folder (UNC), read by our own checker (not
   tauri-plugin-updater, which needs https). The manifest and the installer are both
   checked against an ed25519 (minisign) public key built into the app
   (`minisign-verify`, MIT), and the installer's Authenticode signature is checked too.
   A downgrade only happens when the signed manifest says `"rollback": true`.
2. Per-user install (`installMode: currentUser`): no admin for install or update.
3. Update check at startup (at most once a day) and Help > Check for updates; an HKLM
   policy can turn it off.
4. Firm library = one folder with fixed names (`tickmarks.json`, `layout.json`,
   `fonts\`) that fills the existing firm paths.
5. Tier B MCP policy is not set by the installer; documented in `docs/admin.md`.
6. Build PC testing uses the self-signed cert (`scripts/make-test-cert.ps1`),
   `\\localhost\<share>` and Windows Sandbox. Real certificate and real share: Phase 10b.

## Gate

`npm run check`, `npm run test:e2e`, `npm run release` with the test certificate (signed,
notices generated, payload check passes), owner test guide
`docs/testing/phase-10a-test-guide.md` passes; tag `phase-10a-done`.
