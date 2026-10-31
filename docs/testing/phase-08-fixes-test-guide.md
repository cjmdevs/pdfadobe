# Re-check: Phase 8 fixes

About 10 minutes. Fixes from the owner check of 2026-10-31:

- Step 5: "Sign with a Certificate" picked `localhost` (a website certificate). Now only
  certificates allowed to sign documents are listed, and the one you used last is
  picked.
- Step 4: the two PowerShell commands are now separate.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed.

```powershell
git pull origin main
npm ci
powershell -ExecutionPolicy Bypass -File scripts\make-test-cert.ps1
npm run tauri build
Copy-Item -Force tests\corpus\generated\text-1p.pdf C:\PDFTest\
Remove-Item C:\PDFTest\*_Signed*.pdf -ErrorAction SilentlyContinue
```

Install `src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`. The
test certificate should still be trusted in Acrobat from last time. If you removed it
there, redo "Trust the test certificate" in `phase-08-test-guide.md`.

## Steps

1. **Only signing certificates.** Open `C:\PDFTest\text-1p.pdf`, Tools pane >
   **Certificates > Invisible**. Pass: the list shows **PDF Workbench Test Signer**,
   already selected, and no `localhost`. Click **Sign and save as a new file**. Pass:
   `text-1p_Signed.pdf` opens and the Signatures panel says Valid.

2. **Remembers the last one.** Close the dialog if it's open. In the `text-1p.pdf` tab
   click **Certificates > Invisible** again. Pass: PDF Workbench Test Signer is selected.

3. **Saved signatures are encrypted.** Make sure you have at least one saved signature
   (Fill & Sign > Sign ▾ lists one). Run this command:

   ```powershell
   Get-ChildItem "$env:APPDATA\com.mgrcpas.pdfworkbench\signatures"
   ```

   Pass: one `.sig` file per saved signature. Then run this one:

   ```powershell
   Select-String -Path "$env:APPDATA\com.mgrcpas.pdfworkbench\signatures\*.sig" -Pattern PNG
   ```

   Pass: it prints nothing.

4. **Clean up.** Close PDF Workbench and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\make-test-cert.ps1 -Remove
   ```

   Pass: "Removed 1 test certificate(s)."

## Checklist

- [ ] 1 Only signing certificates, test signer selected, signs valid
- [ ] 2 Last certificate remembered
- [ ] 3 Saved signatures encrypted
- [ ] 4 Test certificate removed

## If a step fails

Send the step number, what happened instead, and a screenshot. For step 1, also send
the output of this command:

```powershell
Get-ChildItem Cert:\CurrentUser\My | Format-List Subject, HasPrivateKey, EnhancedKeyUsageList
```
