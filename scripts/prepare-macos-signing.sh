#!/usr/bin/env bash
set -euo pipefail

for name in \
  APPLE_CERTIFICATE \
  APPLE_CERTIFICATE_PASSWORD \
  APPLE_API_PRIVATE_KEY_BASE64 \
  APPLE_API_KEY \
  RUNNER_TEMP \
  GITHUB_ENV; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

keychain="$RUNNER_TEMP/plvs-signing.keychain-db"
certificate="$RUNNER_TEMP/plvs-developer-id.p12"
intermediate="$RUNNER_TEMP/DeveloperIDG2CA.cer"
api_key="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY}.p8"
keychain_password="$(openssl rand -base64 32)"

printf '%s' "$APPLE_CERTIFICATE" | openssl base64 -d -A >"$certificate"
printf '%s' "$APPLE_API_PRIVATE_KEY_BASE64" | openssl base64 -d -A >"$api_key"
chmod 600 "$certificate" "$api_key"

curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --proto '=https' \
  --tlsv1.2 \
  https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer \
  --output "$intermediate"
echo "f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a  $intermediate" |
  shasum -a 256 --check

echo "::add-mask::$keychain_password"
security create-keychain -p "$keychain_password" "$keychain"
security default-keychain -s "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security import "$intermediate" -k "$keychain"
security import "$certificate" \
  -k "$keychain" \
  -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain"

identity="$({ security find-identity -v -p codesigning "$keychain" || true; } |
  awk -F'"' '/Developer ID Application:/ { print $2 }')"
if [[ -z "$identity" || "$identity" == *$'\n'* ]]; then
  echo "Expected exactly one Developer ID Application identity" >&2
  security find-identity -v -p codesigning "$keychain" >&2
  exit 1
fi

echo "APPLE_SIGNING_IDENTITY=$identity" >>"$GITHUB_ENV"
echo "APPLE_API_KEY_PATH=$api_key" >>"$GITHUB_ENV"
echo "PLVS_SIGNING_KEYCHAIN=$keychain" >>"$GITHUB_ENV"
echo "Prepared macOS signing identity: $identity"
