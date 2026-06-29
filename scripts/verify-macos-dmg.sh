#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dmg_dir="$repo_root/src-tauri/target/release/bundle/dmg"
dmg="$(find "$dmg_dir" -maxdepth 1 -name '*.dmg' -print -quit)"

if [[ -z "${dmg:-}" ]]; then
  echo "DMG not found in $dmg_dir" >&2
  exit 1
fi

mount_point="$(mktemp -d "${TMPDIR:-/tmp}/plvs-dmg-smoke.XXXXXX")"

cleanup() {
  hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  rm -rf "$mount_point"
}
trap cleanup EXIT

hdiutil attach "$dmg" -mountpoint "$mount_point" -nobrowse -quiet

app="$(find "$mount_point" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "${app:-}" ]]; then
  echo "No .app bundle found in DMG $dmg" >&2
  exit 1
fi

main_binary="$app/Contents/MacOS/plvs"
if [[ ! -x "$main_binary" ]]; then
  echo "Missing or non-executable app binary: $main_binary" >&2
  exit 1
fi

for sidecar in ffmpeg ffprobe; do
  path="$app/Contents/MacOS/$sidecar"
  if [[ ! -x "$path" ]]; then
    echo "Missing or non-executable sidecar: $path" >&2
    exit 1
  fi
done

if find "$app/Contents/MacOS" -maxdepth 1 -name 'vad_compare*' | grep -q .; then
  echo "Diagnostic binary should not be bundled in the app" >&2
  exit 1
fi

echo "macOS DMG smoke check passed: $dmg"
