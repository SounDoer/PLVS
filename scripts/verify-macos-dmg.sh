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
doctor_output="$(mktemp "${TMPDIR:-/tmp}/plvs-cli-doctor.XXXXXX.json")"

cleanup() {
  hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  rm -rf "$mount_point"
  rm -f "$doctor_output"
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

cli_binary="$app/Contents/MacOS/plvs-cli"
if [[ ! -x "$cli_binary" ]]; then
  echo "Missing or non-executable CLI binary: $cli_binary" >&2
  exit 1
fi

agent_manifest="$app/Contents/Resources/plvs-agent.json"
if [[ ! -f "$agent_manifest" ]]; then
  echo "Missing agent discovery manifest: $agent_manifest" >&2
  exit 1
fi
if ! grep -q '"relativePath": "Contents/MacOS/plvs-cli"' "$agent_manifest"; then
  echo "Agent discovery manifest does not point to plvs-cli" >&2
  cat "$agent_manifest" >&2
  exit 1
fi
if ! grep -q '"doctor"' "$agent_manifest" || ! grep -q '"--json"' "$agent_manifest"; then
  echo "Agent discovery manifest does not include doctor --json" >&2
  cat "$agent_manifest" >&2
  exit 1
fi

for sidecar in ffmpeg ffprobe; do
  path="$app/Contents/MacOS/$sidecar"
  if [[ ! -x "$path" ]]; then
    echo "Missing or non-executable sidecar: $path" >&2
    exit 1
  fi
done

unexpected_binaries="$(find "$app/Contents/MacOS" -maxdepth 1 -type f \
  ! -name plvs \
  ! -name plvs-cli \
  ! -name ffmpeg \
  ! -name ffprobe \
  -print)"
if [[ -n "$unexpected_binaries" ]]; then
  echo "App bundle contains unexpected executable(s):" >&2
  echo "$unexpected_binaries" >&2
  exit 1
fi

"$cli_binary" doctor --json >"$doctor_output"
if ! grep -q '"schemaVersion":1' "$doctor_output"; then
  echo "CLI doctor returned unexpected JSON" >&2
  cat "$doctor_output" >&2
  exit 1
fi

echo "macOS DMG smoke check passed: $dmg"
