#!/usr/bin/env bash
set -euo pipefail

for name in APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dmg_dir="$repo_root/src-tauri/target/release/bundle/dmg"
dmg="${1:-}"

if [[ -z "$dmg" ]]; then
  count="$(find "$dmg_dir" -maxdepth 1 -name '*.dmg' -print | wc -l | tr -d ' ')"
  if [[ "$count" != "1" ]]; then
    echo "Expected exactly one DMG in $dmg_dir, found $count" >&2
    exit 1
  fi
  dmg="$(find "$dmg_dir" -maxdepth 1 -name '*.dmg' -print -quit)"
fi

if [[ ! -f "$dmg" ]]; then
  echo "DMG not found: $dmg" >&2
  exit 1
fi

xcrun notarytool submit "$dmg" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
codesign --verify --strict --verbose=2 "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"

echo "Notarized and stapled macOS DMG: $dmg"
