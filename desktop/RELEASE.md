# Desktop release operations

The packaged application requires a real local identity and stores project data through AES-256-GCM. Its random data key is protected by the operating system credential service. Linux requires a supported Secret Service/KWallet provider; `basic_text` is rejected. No workspace directory, API key, or plaintext development data is included in a release.

Build with Node 24 and `npm ci`, then `npm run build`. Run `node scripts/build-desktop.mjs --package --skip-frontend --platform=darwin --arch=arm64`. Supported package targets are macOS arm64/x64, Windows x64 and Linux x64. Build on the matching operating system when signing. The script creates an application, a versioned ZIP and a SHA256 checksum in `outputs/`; the current host also receives `Atelier-release.zip`. ZIP archives for Windows/Linux contain portable applications, not platform installers.

Every package includes `THIRD_PARTY_NOTICES.txt`, exact dependency/license provenance in `third-party-licenses.json`, and the original runtime dependency LICENSE, LICENCE, NOTICE, COPYING and COPYRIGHT files under `third-party-licenses/`. Sources come from the installed package versions recorded in `package-lock.json`, including Electron and its Chromium notices. Build and ASAR inspection verify the preserved files' SHA256 hashes. Run `node scripts/third-party-notices.mjs` to generate and verify the same notices independently in `work/third-party-notices/`.

`node scripts/verify-desktop-package.mjs outputs/Atelier.app` inspects the actual ASAR for credential files, development paths, required identity, protected storage metadata and renderer security settings. `--run --smoke-test` launches the current host runtime. For isolated QA only, set `ATELIER_TEST_MODE=1` with an absolute `ATELIER_PROFILE_DIR` whose basename contains `test`, `qa`, `smoke` or `e2e`. Adding `ATELIER_TEST_PASSWORD` during a smoke run explicitly creates or signs into `qa@atelier.test` in that isolated profile; no fixture exists without both guards, and production profiles never receive a default account. These flags never bypass the OS credential service. CI verifies types, tests, production dependency advisories and each target's actual packaged archive.

## Credentials

Production API setup has two explicit choices in Settings. Saving a newly entered masked key encrypts it with the OS credential service. Choosing an existing environment file remembers only its nonsecret path; the existing key stays at that original destination and is read only in the main process. Existing keys are never returned to renderer code. Development can explicitly set `ATELIER_ENV_FILE`; that override is ignored by packaged applications.

Credential changes require a signed-in workspace administrator. Each privileged bridge request checks the live backend identity using the HttpOnly session and main-only desktop capability; renderer-supplied roles are never accepted. Choosing a file checks again after the native dialog closes.

## Legacy draft recovery

Production uses a fresh `persist:atelier-production` browser partition. If an old `persist:atelier-workspace` localStorage directory exists, startup first writes an AES-256-GCM archive under the profile's private `secure/legacy-recovery/` directory, fsyncs it, decrypts and compares every file, and verifies that the source did not change. Only then does it clear Chromium localStorage and remove the archived LevelDB directory. Other legacy browser stores are left intact. Symlinks, unsupported paths, changing files and archives above 128 MB block startup without silently discarding draft bytes.

These archives preserve the original LevelDB file tree, including unsaved pilot drafts, without loading it into the new renderer. They are retained for explicit recovery and protected by the same OS-wrapped project encryption key. `decryptLegacyArchive` in `desktop/legacy-storage.ts` returns the verified original files into memory for a local recovery tool; it never writes plaintext automatically. Keep the profile's protected key alongside the archive. For transfer to another computer, use the application's passphrase-protected project backup instead of copying an OS-bound key file.

## Signing and notarization

Without release signing inputs, macOS builds use an ad-hoc signature and Windows/Linux artifacts remain unsigned. They are suitable for local verification and are not notarized public distribution releases. No signing or notarization is claimed by default.

For macOS, provide an installed Developer ID identity through `ATELIER_MAC_SIGN_IDENTITY`. Notarization additionally uses either `ATELIER_NOTARY_KEYCHAIN_PROFILE`, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. The hardened-runtime entitlements are in `entitlements.plist`. For Windows, provide `WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD`; the build uses Authenticode timestamping. Never put certificates, certificate passwords or private update-signing keys in source or release configuration.

The manual CI `sign_release` input is false by default. When deliberately enabled, optional `APPLE_CERT_BASE64` / `APPLE_CERT_PASSWORD` and `WINDOWS_CERT_BASE64` secrets install temporary signing material for that job. Configure the signing identity and notarization secrets separately. CI removes temporary certificate material and only uploads release ZIPs and checksums.

## Trusted automatic updates

No update request runs without a configured trusted feed. Automatic installation is currently enabled only for packaged macOS builds with a valid code signature matching `APPLE_TEAM_ID`. Windows portable ZIPs and Linux builds use manual release replacement.

Configure `ATELIER_UPDATE_FEED_URL` (HTTPS), `ATELIER_UPDATE_PUBLIC_KEY` (Ed25519 PUBLIC KEY PEM), `APPLE_TEAM_ID`, and optional `ATELIER_UPDATE_DOWNLOAD_ORIGINS` (JSON array of trusted HTTPS origins) at build time. The standard Squirrel JSON feed must carry a detached Ed25519 signature of the exact response bytes in `X-Atelier-Signature`. Every release needs `version`, `updateTo.url`, `updateTo.sha256` and `updateTo.size`. Delta updates are rejected. Atelier verifies the feed signature and download origins before invoking Electron's native updater; native code-signature verification remains required. Installing an update uses the same save-before-close handshake as quitting. Publisher signing credentials and a hosted signed feed must be supplied by the release owner.
