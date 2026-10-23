# Retained local macOS signing

Atelier's previous ad-hoc signature identified one particular build. The retained local certificate gives subsequent builds the same certificate-pinned designated requirement for `com.atelier.bim`. This stabilizes the application's signing requirement, but it does **not** provide full Keychain continuity across rebuilds: the local signer has no Apple `TeamIdentifier`, and macOS still identifies its Keychain partition by the build's `CDHash`. A changed build can therefore require another authorization even when the same certificate signs it. OS-protected project encryption remains enabled; no Keychain access controls are bypassed.

For local development on macOS, explicitly provision once:

```sh
node scripts/local-signing.mjs --provision
node scripts/local-signing.mjs --check
```

The helper creates a dedicated private keychain and retained self-signed code-signing certificate under `~/Library/Application Support/Atelier Build Signing`. It keeps an encrypted private-key archive and owner-only configuration there. Do not copy, publish, commit, or bundle this directory. The helper never prints its passwords or private key and does not automatically write trust-policy entries or change System/login certificates, existing item permissions, or the user's keychain search list during provisioning. The new signing key grants signing access to `/usr/bin/codesign`; its partition configuration is limited to that private signing key in the dedicated keychain. Builds unlock only that keychain. macOS identity lookup also requires its temporary registration in the user keychain search list, even when `--keychain` names it explicitly. The build preserves every existing entry, adds only its dedicated signing keychain, then removes only that entry in `finally` if the build added it. Entries already present, and other entries added during the build, are retained. The keychain is locked after signing and on setup failure. Unknown list output fails closed. Avoid overlapping local packaging runs.

Current macOS can reject an imported self-signed identity as `CSSMERR_TP_NOT_TRUSTED` even when its certificate and private key match. Apple's [certificate guidance](https://developer.apple.com/documentation/technotes/tn3161-inside-code-signing-certificates) explains that `codesign` searches for an identity with a trusted certificate chain. In that case, provisioning alone does not make it usable for signing.

An **optional, separately approved** local workaround is to trust only the newly retained public certificate for the user-domain `codeSign` policy, constrained to `/usr/bin/codesign`:

```sh
signing_directory="$HOME/Library/Application Support/Atelier Build Signing"
security add-trusted-cert -r trustRoot -p codeSign -a /usr/bin/codesign \
  -k "$signing_directory/atelier-local-signing.keychain-db" \
  "$signing_directory/certificate.pem"
```

This writes a user trust-policy entry for that certificate. It may require a one-time macOS authorization. It is not automatic provisioning: obtain approval for this exact change before running it. It does not modify System/login certificates, existing Keychain items or TLS trust. The separate temporary build-time search-list registration is described above. An Apple-issued signing identity is the alternative if this local policy exception is not desired. Keep the retained certificate; regenerating it changes the application's identity. After an approved configuration has passed a native signing probe, build with `npm run desktop:build`.

Packaged macOS builds automatically reuse a configured local identity. To require it rather than allowing the existing ad-hoc CI/release-candidate fallback:

```sh
ATELIER_MAC_LOCAL_SIGNING=1 npm run desktop:build
```

An explicit `ATELIER_MAC_SIGN_IDENTITY` still takes priority and uses the existing hardened Developer ID/notarization configuration. A local self-signed build is labelled `local-development`, contains only its public certificate fingerprint, uses no notarization/timestamp service, and is **not** a Developer ID distribution build. It retains the existing local build's runtime baseline; renderer sandboxing, context isolation and encrypted storage remain enabled. Public distribution requires an Apple-issued Developer ID and notarization.

Do not delete or regenerate an established signing identity between builds. The provision command reuses it; incomplete setup resumes with the retained certificate. Invalid or missing retained material causes an error instead of silently generating a replacement. Back up the whole private signing directory securely if the same certificate-pinned requirement must be retained on another build machine. This preserves the signer, not existing Keychain permissions or cross-update partition approval. It is separate from the app's project vault and portable project backups.

macOS checks two separate permissions for the **existing** Safe Storage item: its trusted-application/decryption ACL and its signature partition ACL. Approving one gate does not necessarily approve the other; temporary Allow and persistent Always Allow also differ. Targeted macOS audit logs and item metadata confirmed both gates had been saved for the installed 0.3.3 build. Two subsequent native relaunches of that unchanged build completed without SecurityAgent prompts. This verifies unchanged-build relaunch behavior, not authorization continuity for a rebuilt application.

Keep the existing app name, bundle ID, Safe Storage item and vault files. Do not delete the item, extract its secret, allow all applications, or broadly change its ACL to suppress prompts. Denying authorization must leave encrypted projects intact. A locked Keychain, a changed build's CDHash, a changed certificate or a different runtime can still require authorization. For supported identity continuity across application updates, use a genuine Apple-issued Developer ID with its Apple TeamIdentifier. The local certificate is not a substitute. `desktop:dev` still uses the development Electron runtime; verify relaunch behavior with the same signed packaged binary.

Tests exercise signing-policy selection, production-profile preservation, certificate-pinned verification, scoped key access and sanitized process errors without provisioning any real Keychain or reading the user's app vault. Native unchanged-build verification requires approving the relevant existing-item gates, then fully quitting and relaunching the same packaged binary at least twice. Test changed-build behavior separately; local certificate reuse alone is not evidence of partition continuity.

References: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Apple Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html), [Apple private-keychain search-list implementation](https://raw.githubusercontent.com/apple-oss-distributions/Security/main/OSX/libsecurity_keychain/lib/StorageManager.cpp).

Explicit provisioning also repairs a previously interrupted setup using the same retained certificate. It checks the imported private-key label and applies the access rule before recording completion. Builds reject an incomplete setup; retry `--provision` to resume without replacing the identity.
