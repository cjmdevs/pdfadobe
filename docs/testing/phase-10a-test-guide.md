# Test guide: Phase 10a packaging

About 40 minutes on the build PC (two release builds take most of it). All test files are
synthetic. Windows Sandbox isn't available on Windows 11 Home, so this installs on the
build PC itself and uninstalls at the end. A share on this PC stands in for the firm's
update folder. The real certificate and the real share: Phase 10b.

## Setup (PowerShell as administrator, in the repo)

```powershell
cd "C:\Users\carso\Claude Projects\code\pdfadobe"
npm ci
npm run corpus
# Test code signing certificate (prints a thumbprint)
powershell -ExecutionPolicy Bypass -File scripts\make-test-codesign-cert.ps1
$env:PDFWB_SIGN_THUMBPRINT = "<thumbprint it printed>"
# Let this PC trust the test certificate (needed for the update check). Click Yes.
Import-Certificate tests\corpus\out\test-codesign.cer -CertStoreLocation Cert:\CurrentUser\Root
# Update folder, shared as \\localhost\PW10Updates
New-Item -ItemType Directory -Force C:\PW10Updates, C:\PW10Test | Out-Null
New-SmbShare -Name PW10Updates -Path C:\PW10Updates -FullAccess Everyone
Copy-Item tests\corpus\generated\text-1p.pdf, tests\corpus\generated\no-print.pdf, tests\corpus\generated\scanned-image-only.pdf C:\PW10Test\
New-Item -Force "HKCU:\Software\Policies\PDF Workbench\Update" | Out-Null
Set-ItemProperty "HKCU:\Software\Policies\PDF Workbench\Update" Source "\\localhost\PW10Updates"
```

If PDF Workbench is already installed from an earlier phase, uninstall it first (Settings >
Apps > Installed apps).

## Steps

1. **Release build gates.** Run `$env:PDFWB_SIGN_THUMBPRINT = $null; npm run release`.
   Pass: it stops at once with "set PDFWB_SIGN_THUMBPRINT or PDFWB_SIGN_COMMAND". Set
   the thumbprint again and run `npm run release -- --test-cert`. Pass: it ends with
   `check-payload: installer has all 15 required files`, `verify-signed: all 16 files
   signed (test certificate)`, `update-package: ...release\0.1.0` and `release: done`.
   Lines saying "SignTool Error: A certificate chain processed, but terminated in a root"
   are expected with the test certificate.
2. **Installer.** Right-click `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`
   > Properties > Digital Signatures. Pass: "PDF Workbench Test Code Signing". Double-click
   it. Pass: no admin (UAC) prompt; it installs to `%LOCALAPPDATA%\PDF Workbench` (paste
   that into Explorer: `qpdf\`, `tesseract\tessdata\eng.traineddata`, `pdfium\` and
   `THIRD-PARTY-NOTICES.txt` are there).
3. **First run.** Start PDF Workbench. Pass: "Set up PDF Workbench", step 1 of 3. Type
   your name and click **Next**. Type `\\localhost\nothing-here` and click **Next**. Pass:
   it says the folder can't be reached. Clear the box and click **Next**.
4. **Default PDF program.** Step 3 says PDFs open in another program. Click **Open Windows
   Settings**. Pass: Settings opens at PDF Workbench's Default apps page. Next to `.pdf`,
   pick PDF Workbench and click **Set default**. Go back to PDF Workbench. Pass: "Done: PDF
   files now open in PDF Workbench." Click **Done**. Double-click `C:\PW10Test\text-1p.pdf`
   in Explorer. Pass: it opens in PDF Workbench. Restart the app. Pass: no setup this time.
5. **Settings > About.** Open Settings (gear). Pass: "Version 0.1.0", "PDF Workbench
   opens PDF files". Click **Third-party notices**. Pass: Notepad opens a long list
   starting "PDF Workbench: third-party notices" with qpdf, Tesseract, PDFium, React,
   tauri. Click **Check for updates**. Pass: "The firm's update folder can't be reached
   right now" (nothing is published yet).
6. **Sidecars work in the installed app.** Open `C:\PW10Test\scanned-image-only.pdf`,
   run **Scan & OCR > Recognize text**, then Ctrl+F for a word on the page. Pass: it's
   found. Use **Organize Pages** to rotate page 1 and Save As `C:\PW10Test\rotated.pdf`.
   Pass: it saves (qpdf ran). Open `rotated.pdf` in Adobe Acrobat: page 1 is rotated.
7. **Open in Acrobat.** Open `C:\PW10Test\no-print.pdf` and press Ctrl+P. Pass: a red
   message "do not allow printing" with **Open in Acrobat** and **Close**. Click **Open in
   Acrobat**. Pass: Acrobat opens `no-print.pdf`.
8. **Crash report.** In PDF Workbench press Ctrl+Alt+Shift+F11. Open Settings > **Show
   folder** (Crash reports). Pass: a `crash-....txt` file holds "Message: (message withheld
   ...)", the version, and no file names or document text.
9. **Update.** Publish 0.1.0: `npm run update:package -- --publish \\localhost\PW10Updates`.
   Then raise the version to `0.1.1` in `package.json`, `src-tauri\tauri.conf.json` and
   `src-tauri\Cargo.toml`, and run `npm run release -- --test-cert`, then
   `npm run update:package -- --publish \\localhost\PW10Updates`. Close and start PDF
   Workbench. Pass: "Update available", "PDF Workbench 0.1.1 is ready (you have 0.1.0)". Click **Install
   now**. Pass: the app closes, a small progress window shows, the app opens again, and
   Settings shows "Version 0.1.1". PDFs still open in PDF Workbench from Explorer.
10. **Tampered update is refused.** Open `C:\PW10Updates\latest.json` in Notepad, change
    `0.1.1` to `0.1.2`, save. In Settings click **Check for updates**. Pass: "The update
    was refused: update manifest: the signature does not match the firm's update key".
11. **Rollback.** Run `npm run update:package -- --rollback 0.1.0 --folder \\localhost\PW10Updates`.
    In Settings click **Check for updates** (the automatic check runs once a day). Pass:
    "The firm is going back a version". Click **Install
    now**. Pass: after it reopens, Settings shows "Version 0.1.0" and your name is still
    set (step 3).
12. **Uninstall.** Settings > Apps > Installed apps > PDF Workbench > Uninstall, leave
    "delete app data" unticked. Pass: `%LOCALAPPDATA%\PDF Workbench` is gone; Settings >
    Apps > Default apps no longer lists PDF Workbench; `%APPDATA%\com.mgrcpas.pdfworkbench`
    is still there.

## Clean up

```powershell
git checkout package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml   # back to 0.1.0
Remove-SmbShare -Name PW10Updates -Force
Remove-Item -Recurse C:\PW10Updates, C:\PW10Test
Remove-Item -Recurse "HKCU:\Software\Policies\PDF Workbench"
Get-ChildItem Cert:\CurrentUser\Root | Where-Object Subject -eq "CN=PDF Workbench Test Code Signing" | Remove-Item
powershell -ExecutionPolicy Bypass -File scripts\make-test-codesign-cert.ps1 -Remove
```

## Checklist

- [ ] 1 Release refuses without a certificate; passes all gates with the test one
- [ ] 2 Signed installer, no UAC, sidecars and notices installed
- [ ] 3 First run: name, unreachable library refused, blank library OK
- [ ] 4 Default app walkthrough works; double-click opens in PDF Workbench; shown once
- [ ] 5 Settings: version, default status, notices, update check message
- [ ] 6 OCR and qpdf work in the installed app; Acrobat shows the rotated page
- [ ] 7 Open in Acrobat from an error message
- [ ] 8 Crash report written without file names or text
- [ ] 9 Update 0.1.0 to 0.1.1 installs and reopens
- [ ] 10 Tampered manifest refused
- [ ] 11 Rollback to 0.1.0 keeps settings
- [ ] 12 Uninstall removes the app and its Default apps entry, keeps app data

## If a step fails

Send the step number, what you saw (a screenshot of any message), and:
- steps 1, 9: the last 40 lines of the `npm run release` output
- steps 9 to 11: `Get-ChildItem C:\PW10Updates` and `Get-Content C:\PW10Updates\latest.json`
- step 8 or any crash: the newest file in `%LOCALAPPDATA%\com.mgrcpas.pdfworkbench\crashes`
- step 4 or 12: `reg query HKCU\Software\RegisteredApplications`
