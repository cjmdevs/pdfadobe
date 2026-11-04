# Phase 10a TEST code signing certificate (self-signed). Build PC and Windows Sandbox
# only; never sign a real release with it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-test-codesign-cert.ps1
#     Adds "PDF Workbench Test Code Signing" to your Personal certificate store, writes
#     tests\corpus\out\test-codesign.cer (to trust in a Sandbox) and prints the
#     thumbprint to put in PDFWB_SIGN_THUMBPRINT.
#   powershell -ExecutionPolicy Bypass -File scripts\make-test-codesign-cert.ps1 -Remove
#     Removes it again.
param([switch]$Remove)

$subject = "CN=PDF Workbench Test Code Signing"
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject }

if ($Remove) {
  $existing | ForEach-Object { Remove-Item -Path "Cert:\CurrentUser\My\$($_.Thumbprint)" -DeleteKey }
  Write-Host "Removed $($existing.Count) test code signing certificate(s)."
  exit 0
}

if ($existing) {
  $cert = $existing | Select-Object -First 1
  Write-Host "Using the test code signing certificate already in your store."
} else {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(1)
  Write-Host "Added the test code signing certificate to your Personal certificate store."
}

$out = Join-Path $PSScriptRoot "..\tests\corpus\out"
New-Item -ItemType Directory -Force $out | Out-Null
Export-Certificate -Cert $cert -FilePath (Join-Path $out "test-codesign.cer") | Out-Null
Write-Host "Wrote $out\test-codesign.cer"
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Use it with:  `$env:PDFWB_SIGN_THUMBPRINT = '$($cert.Thumbprint)'"
