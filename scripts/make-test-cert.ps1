# Phase 8 test certificate (synthetic, for testing only; never sign real documents with it).
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-test-cert.ps1
#     Adds "PDF Workbench Test Signer" to your Personal certificate store and writes
#     tests\corpus\out\test-signer.cer (to trust in Acrobat) and test-signer.pfx
#     (password: test-pfx-1).
#   powershell -ExecutionPolicy Bypass -File scripts\make-test-cert.ps1 -Remove
#     Removes it from the store again.
param([switch]$Remove)

$subject = "CN=PDF Workbench Test Signer"
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject }

if ($Remove) {
  $existing | ForEach-Object { Remove-Item -Path "Cert:\CurrentUser\My\$($_.Thumbprint)" -DeleteKey }
  Write-Host "Removed $($existing.Count) test certificate(s)."
  exit 0
}

$out = Join-Path $PSScriptRoot "..\tests\corpus\out"
New-Item -ItemType Directory -Force $out | Out-Null

if ($existing) {
  $cert = $existing | Select-Object -First 1
  Write-Host "Using the test certificate already in your store."
} else {
  # Key usage: digital signature + non-repudiation. Extended key usage: Document Signing
  # and Email Protection (what Acrobat accepts for signing).
  $cert = New-SelfSignedCertificate -Subject $subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature, NonRepudiation `
    -KeyExportPolicy Exportable `
    -TextExtension @("2.5.29.37={text}1.3.6.1.4.1.311.10.3.12,1.3.6.1.5.5.7.3.4") `
    -NotAfter (Get-Date).AddYears(1)
  Write-Host "Added the test certificate to your Personal certificate store."
}

Export-Certificate -Cert $cert -FilePath (Join-Path $out "test-signer.cer") | Out-Null
$pw = ConvertTo-SecureString -String "test-pfx-1" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath (Join-Path $out "test-signer.pfx") -Password $pw | Out-Null
Write-Host "Wrote $out\test-signer.cer and test-signer.pfx (password: test-pfx-1)."
