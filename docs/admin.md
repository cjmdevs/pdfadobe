# PDF Workbench: admin guide

For whoever installs and looks after PDF Workbench at the firm. Commands are for
PowerShell. Paths in `<angle brackets>` are yours to fill in.

## What gets installed where

| What | Where |
| --- | --- |
| The app, qpdf, Tesseract (English), PDFium, THIRD-PARTY-NOTICES.txt | `%LOCALAPPDATA%\PDF Workbench\` |
| Settings, stamps, signatures | `%APPDATA%\com.cjmdevs.pdfworkbench\` |
| Thumbnails, crash reports, downloaded updates | `%LOCALAPPDATA%\com.cjmdevs.pdfworkbench\` |
| Start menu shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\PDF Workbench.lnk` |
| Uninstall entry, file type, Default apps registration | `HKCU` only |

The install is per user. It needs no admin rights, and neither do updates. Each person
who uses the PC installs it once for themselves.

WebView2 (the page engine) is part of Windows 10 and 11. If a PC is missing it, the
installer runs Microsoft's WebView2 setup, which needs internet once.

## Install

Interactive: double-click `PDF Workbench_<version>_x64-setup.exe` and click through.

Silent, for a script or remote session run as that user:

```powershell
& "\\<server>\<share>\PDF Workbench\updates\PDF Workbench_<version>_x64-setup.exe" /S
```

`/P` instead of `/S` shows a progress bar with no questions. Add `/R` to start the app
when it is done.

After the first start, each person gets a three-step setup: their name (for comments and
sign-offs), the firm library folder, and making PDF Workbench their PDF program.

### Firm library folder

One folder on the share, for example `\\<server>\<share>\PDF Workbench\library`, holding:

- `tickmarks.json`: firm tickmarks and stamps (Tickmark library > Files > save the firm file)
- `layout.json`: firm quick toolbar (Customize quick tools > Save as firm default)
- `fonts\`: firm fonts for Edit PDF

Any of the three may be missing. Everyone needs read access. Only the people who maintain
the firm defaults need write access.

## Updates

PDF Workbench looks in the firm's update folder at start (at most once a day) and when
someone clicks Settings > Check for updates. If there is a newer version it asks, then
installs in passive mode and opens again. It refuses anything not signed with the firm's
update key, and any installer whose Windows code signature isn't trusted.

### Point PCs at the update folder

The folder is set by policy registry values. HKLM wins over HKCU.

```powershell
# For every user on this PC (run as admin):
New-Item -Force "HKLM:\Software\Policies\PDF Workbench\Update" | Out-Null
Set-ItemProperty "HKLM:\Software\Policies\PDF Workbench\Update" Source "\\<server>\<share>\PDF Workbench\updates"

# Or for one user (no admin):
New-Item -Force "HKCU:\Software\Policies\PDF Workbench\Update" | Out-Null
Set-ItemProperty "HKCU:\Software\Policies\PDF Workbench\Update" Source "\\<server>\<share>\PDF Workbench\updates"
```

A build can also carry a default folder: set `PDFWB_UPDATE_SOURCE` before `npm run release`.

To turn updates off (for example while testing a version): DWORD `Disabled` = 1 in the
same key.

Everyone needs read access to the update folder. Only the person who publishes needs
write access.

### The two keys

- **Code signing certificate.** Windows trusts the installer because of it. Bought from a
  certificate authority. Thumbprint in `PDFWB_SIGN_THUMBPRINT`, or a signing tool command
  in `PDFWB_SIGN_COMMAND` (cloud or USB token certificates). `npm run release` refuses to
  build without one.
- **Update key.** PDF Workbench trusts an update because of it. Private half:
  `%USERPROFILE%\.pdfworkbench\update-signing.key` on the build PC. Public half:
  `src-tauri/update-key.pub` in the repo, built into the app.

Back up the private update key somewhere safe (not the shared drive). If it's lost,
installed copies can't take updates any more and everyone has to reinstall by hand. If it
leaks, make a new one (below), release, and reinstall by hand.

The key made in Phase 10a has no password. Before the first real release you can make a
new one with a password, since nothing installed depends on it yet:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.pdfworkbench\update-signing.key" --force
Copy-Item "$env:USERPROFILE\.pdfworkbench\update-signing.key.pub" src-tauri\update-key.pub
$env:PDFWB_UPDATE_KEY_PASSWORD = "<the password>"   # in each release session
```

### Publish an update

On the build PC:

```powershell
# 1. Raise the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
# 2. Optional: what's new, shown to people before they install
Set-Content release\notes-<version>.txt "Fixes ..."
# 3. Build, sign, check and package
$env:PDFWB_SIGN_THUMBPRINT = "<certificate thumbprint>"
$env:PDFWB_SIGN_TIMESTAMP_URL = "<your CA's timestamp URL>"
npm run release
# 4. Publish to the firm's update folder
npm run update:package -- --publish "\\<server>\<share>\PDF Workbench\updates"
```

`npm run release` fails if any file isn't signed, if qpdf, Tesseract, the English OCR data,
PDFium or the notices are missing from the installer, or if any dependency has no license
text. The finished package is in `release\<version>\`.

Publishing copies the installer first and writes `latest.json` last, so a PC never sees a
version whose installer isn't there yet. Keep older installers in the folder: rollback
needs them.

## Make PDF Workbench the default PDF program

Windows only lets each person choose their own default. Apps can't do it themselves.

**One person:** first-run setup step 3, or Settings > Choose default PDF program. It opens
Settings > Apps > Default apps at PDF Workbench. Next to `.pdf`, click the current program,
pick PDF Workbench, then Set default.

**Everyone, by policy (domain PCs):**

1. Set it by hand on one PC as above.
2. Export the associations: `Dism /Online /Export-DefaultAppAssociations:C:\Temp\assoc.xml`
3. Edit `assoc.xml` down to the `.pdf` line:
   `<Association Identifier=".pdf" ProgId="PDFWorkbench.Document" ApplicationName="PDF Workbench" />`
4. Group Policy: Computer Configuration > Administrative Templates > Windows Components >
   File Explorer > **Set a default associations configuration file** = the XML on a share.
   It applies at each sign-in.

The app must already be installed for that user, or Windows skips the line. Adobe Acrobat
stays installed, and every error message in PDF Workbench has an "Open in Acrobat" button.

## Uninstall

Settings > Apps > Installed apps > PDF Workbench > Uninstall. The uninstaller asks whether
to delete app data too (settings, stamps, saved signatures, thumbnails, crash reports).
Leave it unticked to keep them for a reinstall.

Silent, as that user:

```powershell
& "$env:LOCALAPPDATA\PDF Workbench\uninstall.exe" /S
```

Uninstalling removes the Default apps registration. PDFs then open in whatever Windows
picks next (usually Edge, or Acrobat if installed).

## Roll back to an older version

**Everyone:** point the update folder back to a version that's still in it. The manifest
is signed and marked as a rollback, so PCs on a newer version accept going back:

```powershell
npm run update:package -- --rollback <older version> --folder "\\<server>\<share>\PDF Workbench\updates"
```

Each PC offers it at its next start (or Check for updates). When the fix is ready, publish
a version higher than the broken one as usual.

**One PC:** run the older installer by hand. It installs over the newer one. Settings are
kept.

## Crash reports

Kept only on the PC, in `%LOCALAPPDATA%\com.cjmdevs.pdfworkbench\crashes\` (newest 20).
Settings > Crash reports > Show folder opens it. They hold the time, version, where in the
code it happened and the error type. They never hold document text or file names. Nothing
is sent anywhere: ask the person to email the file if you need it.

To check that reports are written, press Ctrl+Alt+Shift+F11 in PDF Workbench. It
throws a harmless test error and a new report appears in the folder.

## Claude (MCP) content access

The Tier B tools that let Claude read document content are off unless an admin turns
them on per PC. The installer never sets this:

```powershell
# As admin. 1 = on; delete the value or set 0 for off.
New-Item -Force "HKLM:\Software\Policies\PDF Workbench\MCP" | Out-Null
Set-ItemProperty "HKLM:\Software\Policies\PDF Workbench\MCP" AllowContentToClaude 1 -Type DWord
```

Through Group Policy Preferences > Registry, it's the same key and value. Decide with the
partners before turning it on: it's an IRC 7216 use/disclosure question.

## Third-party licenses

`THIRD-PARTY-NOTICES.txt` is in the install folder (Settings > Third-party notices) and in
each `release\<version>\` folder. It's regenerated by every build from the npm packages
in the app, the Rust crates, and the bundled programs.
