Read CLAUDE.md. This is Phase 8. Plan first.
Visual signatures and initials:

- Create from typed name (choice of script fonts), drawn (mouse/pen), or image
- Saved per user locally (encrypted at rest with Windows DPAPI); place, resize,
  date stamp option; Fill & Sign style quick tools (text, check, X, date)

Certificate signatures (@signpdf or a license-safe alternative; verify current
version and maintenance first):

- Sign with a certificate from the Windows certificate store or a .pfx file
- Visible or invisible signature, reason, location; PAdES (ETSI.CAdES.detached)
- Signing always produces a new file
- Signature panel: list signatures in an opened file and show whether the document
  was modified after signing; full trust validation is out of scope for v1

Security (qpdf):

- Password protect: open password and/or permissions password, AES-256 only
- Remove security (with the password)
- Clear warnings that permission passwords are not real protection

Tests: sign a corpus file and verify the signature is reported valid by Acrobat;
encrypt/decrypt round-trip; saved signature images never appear in logs.

Test guide: exact steps, but kept at a basic overview level.

## Decisions (owner approved the plan 2026-10-31)

1. No @signpdf (4.0.0, 2026-10-19; it rewrites the file with pdf-lib, breaking earlier
   signatures, and its only signer needs an exportable key through node-forge). Own
   incremental-update writer (`src/engine/sign/`), CMS built with pkijs 3.4.3 /
   asn1js (BSD-3-Clause), the signature itself made by Windows CNG in Rust for both
   store certificates and .pfx files (the .pfx is imported into memory only).
2. pkijs pinned to 3.4.3 (the established 3.x line), not 4.0.1.
3. Visual signatures and Fill & Sign marks are stamp/free text annotations like all
   other markup (the existing Flatten tool flattens them).
4. No timestamp server (no network): PAdES baseline B-B, no LTV. Signing an encrypted
   file is refused (remove security first). A script makes a self-signed test
   certificate; Acrobat shows "validity unknown" until it is trusted once.
5. Script fonts: Dancing Script, Great Vibes, Allura, Caveat (OFL-1.1).

## Gate

`npm run check`, `npm run test:e2e`, the signing and encryption tests above, and the
owner check of `docs/testing/phase-08-test-guide.md`. Then tag `phase-08-done`.
