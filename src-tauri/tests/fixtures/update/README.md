Synthetic update fixtures for `src-tauri/src/update.rs` tests (Phase 10a).

- `test-key.pub`, `other-key.pub`: public halves of two throwaway `tauri signer generate`
  keys made for these tests only. The private keys were not kept.
- `latest.json` + `latest.json.sig`: a manifest signed with the test key. Do not
  reformat `latest.json`: the signature covers its exact bytes.

The firm's real update key is `src-tauri/update-key.pub` (public half only).
