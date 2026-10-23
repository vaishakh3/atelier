#!/usr/bin/env bash
set -euo pipefail
set +x
atelierKeychainPath="$RUNNER_TEMP/atelier-signing.keychain-db"
atelierCertificatePath="$RUNNER_TEMP/atelier-signing.p12"
atelierKeychainPassword="$(openssl rand -hex 24)"
node -e 'require("node:fs").writeFileSync(process.argv[1],Buffer.from(process.env.APPLE_CERT_BASE64,"base64"),{mode:0o600})' "$atelierCertificatePath"
security create-keychain -p "$atelierKeychainPassword" "$atelierKeychainPath"
security set-keychain-settings -lut 21600 "$atelierKeychainPath"
security unlock-keychain -p "$atelierKeychainPassword" "$atelierKeychainPath"
security import "$atelierCertificatePath" -P "$APPLE_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$atelierKeychainPath"
security set-key-partition-list -S apple-tool:,apple: -k "$atelierKeychainPassword" "$atelierKeychainPath"
security list-keychains -d user -s "$atelierKeychainPath"
rm -f "$atelierCertificatePath"
