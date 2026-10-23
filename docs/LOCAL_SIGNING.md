# Persistent local macOS signing

Atelier's previous ad-hoc signature identified one particular build. Rebuilding changed that identity, so macOS could ask again for permission to the app's existing Keychain item. A retained signing certificate identifies subsequent local builds consistently. This preserves OS-protected project encryption; it does not bypass Keychain access controls.

For local development on macOS, explicitly provision once:

```sh
node scripts/local-signing.mjs --provision
node scripts/local-signing.mjs --check
```

The helper creates a dedicated private keychain and retained self-signed code-signing certificate under `~/Library/Application Support/Atelier Build Signing`. It keeps an encrypted private-key archive and owner-only configuration there. Do not copy, publish, commit, or bundle this directory. The helper never prints its passwords or private key and does not automatically write trust-policy entries or change System/login certificates, existing item permissions, or the user's keychain search list. The new signing key grants signing access to `/usr/bin/codesign`; its partition configuration is limited to that private signing key in the dedicated keychain. Builds unlock only that keychain and lock it after signing.

Current macOS can reject an imported self-signed identity as `CSSMERR_TP_NOT_TRUSTED` even when its certificate and private key match. Apple's [certificate guidance](https://developer.apple.com/documentation/technotes/tn3161-inside-code-signing-certificates) explains that `codesign` searches for an identity with a trusted certificate chain. In that case, provisioning alone does not make it usable for signing.

An **optional, separately approved** local workaround is to trust only the newly retained public certificate for the user-domain `codeSign` policy, constrained to `/usr/bin/codesign`:

```sh
signing_directory="$HOME/Library/Application Support/Atelier Build Signing"
security add-trusted-cert -r trustRoot -p codeSign -a /usr/bin/codesign \
  -k "$signing_directory/atelier-local-signing.keychain-db" \
  "$signing_directory/certificate.pem"
```

This writes a user trust-policy entry for that certificate. It may require a one-time macOS authorization. It is not automatic provisioning: obtain approval for this exact change before running it. It does not modify System/login certificates, existing Keychain items, TLS trust, or the keychain search list. An Apple-issued signing identity is the alternative if this local policy exception is not desired. Keep the retained certificate; regenerating it changes the application's identity. After an approved configuration has passed a native signing probe, build with `npm run desktop:build`.

Packaged macOS builds automatically reuse a configured local identity. To require it rather than allowing the existing ad-hoc CI/release-candidate fallback:

```sh
ATELIER_MAC_LOCAL_SIGNING=1 npm run desktop:build
```

An explicit `ATELIER_MAC_SIGN_IDENTITY` still takes priority and uses the existing hardened Developer ID/notarization configuration. A local self-signed build is labelled `local-development`, contains only its public certificate fingerprint, uses no notarization/timestamp service, and is **not** a Developer ID distribution build. It retains the existing local build's runtime baseline; renderer sandboxing, context isolation and encrypted storage remain enabled. Public distribution requires an Apple-issued Developer ID and notarization.

Do not delete or regenerate an established signing identity between builds. The provision command reuses it; incomplete setup resumes with the retained certificate. Invalid or missing retained material causes an error instead of silently generating a replacement. Back up the whole private signing directory securely if continuity across build machines is needed. It is separate from the app's project vault and portable project backups.

The first transition from an ad-hoc build to this certificate may still need normal macOS authorization for the **existing** Safe Storage item. Keep the existing app name, bundle ID and vault files. Denying authorization must leave existing encrypted projects intact. A locked Keychain, a changed certificate, or a different runtime identity may also require authorization; zero prompts cannot be guaranteed. `desktop:dev` still uses the development Electron runtime, so use the signed packaged app when verifying repeat launches.

Tests exercise signing-policy selection, production-profile preservation, certificate-pinned verification, scoped key access and sanitized process errors without provisioning any real Keychain or reading the user's app vault. Native continuity verification requires two packaged builds signed by the retained certificate and a user-authorized existing-vault launch.

References: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Apple Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html), [Apple private-keychain search-list implementation](https://raw.githubusercontent.com/apple-oss-distributions/Security/main/OSX/libsecurity_keychain/lib/StorageManager.cpp).

Explicit provisioning also repairs a previously interrupted setup using the same retained certificate. It checks the imported private-key label and applies the access rule before recording completion. Builds reject an incomplete setup; retry `--provision` to resume without replacing the identity.
