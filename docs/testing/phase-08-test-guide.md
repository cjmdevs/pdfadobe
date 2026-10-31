# Test guide: Phase 8 (signatures, certificates, security)

About 30 minutes. Synthetic files only. The test certificate is made just for this and
removed at the end.

## Setup

PowerShell in the `pdfadobe` folder, with PDF Workbench closed.

```powershell
git pull origin main
npm ci
npm run corpus -- --force
powershell -ExecutionPolicy Bypass -File scripts\make-test-cert.ps1
npm run tauri build
$g = "tests\corpus\generated"
Copy-Item -Force "$g\text-1p.pdf","$g\sign-field.pdf","$g\encrypted.pdf","$g\stamp-reviewed.png","tests\corpus\out\test-signer.pfx","tests\corpus\out\test-signer.cer" C:\PDFTest\
Remove-Item C:\PDFTest\*_Signed*.pdf,C:\PDFTest\*_Protected*.pdf,C:\PDFTest\*_Unprotected*.pdf -ErrorAction SilentlyContinue
```

Pass: the script prints "Added the test certificate…" and "Wrote …test-signer.pfx", and
`npm run tauri build` ends with `PDF Workbench_0.1.0_x64-setup.exe`. Install
`src-tauri\target\release\bundle\nsis\PDF Workbench_0.1.0_x64-setup.exe`.

**Trust the test certificate in Acrobat (once):** Acrobat > Menu > Preferences >
Signatures > Identities & Trusted Certificates **More…** > Trusted Certificates >
**Import** > Browse, pick `C:\PDFTest\test-signer.cer`, **Add to Import List**,
**Import**. Select "PDF Workbench Test Signer", click **Edit Trust**, tick **Use this
certificate as a trusted root**, OK. Without this Acrobat says "validity unknown".

## Steps

1. **Typed signature.** Open `C:\PDFTest\text-1p.pdf`. Tools pane > **Fill & Sign**.
   Click **Sign ▾ > Add Signature…**, type your name, click one of the four styles, then
   **Save and place**. Click on the page. Pass: your signature lands where you clicked,
   with handles. Drag a corner handle. Pass: it resizes and keeps its shape.

2. **Drawn initials, image, date.** Click **Sign ▾ > Add Initials…** > **Draw** tab,
   draw with the mouse (or pen), **Save and place**, click the page. Then **Sign ▾ > Add
   Signature…** > **Image** tab > **Choose image…**, pick `C:\PDFTest\stamp-reviewed.png`,
   **Save and place**, click the page. Pass: the white around the picture is see-through.
   Tick **Sign ▾ > Add the date under signatures**, then **Sign ▾ > Place signature 1**
   and click. Pass: today's date shows under it.

3. **Quick tools.** Click **Text** and click the page, type `Synthetic Co`. Then
   **Check**, **X**, **Dot** and **Date**, clicking the page after each. Pass: each mark
   appears where clicked. **Save As** `C:\PDFTest\filled.pdf`, open it in Acrobat.
   Pass: every signature, mark, the text and the date show as placed.

4. **Saved and encrypted.** Close PDF Workbench, open it again with any PDF. Click
   **Fill & Sign > Sign ▾**. Pass: your saved signatures and initials are listed. In
   PowerShell run:
   `Get-ChildItem "$env:APPDATA\com.mgrcpas.pdfworkbench\signatures"` then
   `Select-String -Path "$env:APPDATA\com.mgrcpas.pdfworkbench\signatures\*.sig" -Pattern PNG`.
   Pass: one `.sig` file per saved item, and the second command prints nothing (the
   pictures are encrypted).

5. **Certificate from the Windows store (visible).** Open `text-1p.pdf`, Tools pane >
   **Certificates**. Click **Digitally Sign** and drag a box on the page. Pass: "Sign
   with a Certificate" opens with **PDF Workbench Test Signer** selected. Type Location
   `Test office`, set Left side to your saved signature, click **Sign and save as a new
   file**. Pass: `text-1p_Signed.pdf` opens in a new tab, and the Signatures panel on
   the right says "Valid: the document has not been changed since it was signed". Open
   `C:\PDFTest\text-1p_Signed.pdf` in Acrobat. Pass: the blue bar says "Signed and all
   signatures are valid".

6. **.pfx file, signature field.** Open `sign-field.pdf` and scroll to page 2. Click the
   box that says **Click to sign**. Choose **A certificate file (.pfx)** > **Choose .pfx
   file…** > `C:\PDFTest\test-signer.pfx`. Type password `wrong`, click **Open**. Pass:
   "The password for this .pfx file is not correct." Type `test-pfx-1`, **Open**, then
   **Sign and save as a new file**. Pass: `sign-field_Signed.pdf` opens with the
   signature in the field. In Acrobat: "Signed and all signatures are valid".

7. **Second signature and "changed after signing".** In the `text-1p_Signed.pdf` tab
   click **Certificates > Invisible**, pick the test signer, **Sign and save as a new
   file**. Pass: `text-1p_Signed_Signed.pdf` opens; the panel lists 2 signatures, the
   first says "Valid for what was signed. The document was changed after this
   signature." Click **View signed version**. Pass: a tab opens with the file as first
   signed. Acrobat shows both signatures valid for the second file.

8. **Protect.** Open `text-1p.pdf`, Tools pane > **Protect > Protect**. Pass: the orange
   note says a permissions password is not real protection. Type open password
   `Open-1` twice, tick **Restrict printing, changes and copying**, type `Perm-2` twice,
   Printing **Not allowed**, then **Save a protected copy**. Pass: `text-1p_Protected.pdf`
   opens and asks for a password; `Open-1` opens it. In Acrobat it asks for the password
   too; then File > Properties > Security shows 256-bit AES and Printing: Not Allowed.

9. **Remove Security.** Open `C:\PDFTest\encrypted.pdf` (password `corpus-user`).
   **Protect > Remove Security**, type `wrong`, click **Save an unprotected copy**. Pass:
   "That password is not correct." Type `corpus-user` and save. Pass:
   `encrypted_Unprotected.pdf` opens without asking for a password.

10. **Clean up.** Close PDF Workbench, then run
    `powershell -ExecutionPolicy Bypass -File scripts\make-test-cert.ps1 -Remove`.
    Pass: "Removed 1 test certificate(s)." In Acrobat you can delete the trusted test
    certificate in the same Trusted Certificates list.

## Checklist

- [ ] 1 Typed signature, place, resize
- [ ] 2 Drawn initials, image signature, date under signature
- [ ] 3 Text, check, X, dot, date (Acrobat shows them)
- [ ] 4 Saved signatures survive a restart and are encrypted
- [ ] 5 Store certificate, visible signature (Acrobat: valid)
- [ ] 6 .pfx, wrong password message, signature field (Acrobat: valid)
- [ ] 7 Second signature, "changed after", signed version
- [ ] 8 Protect: warning, AES-256, restrictions (Acrobat)
- [ ] 9 Remove Security
- [ ] 10 Test certificate removed

## If a step fails

Send the step number, what you clicked last, what happened instead, and a screenshot.
For a setup failure, send the last 30 lines the command printed. For an Acrobat
problem, send a screenshot of Acrobat's Signature panel (the pen icon on the left) and
the signed file (it only holds synthetic content and the test certificate).
