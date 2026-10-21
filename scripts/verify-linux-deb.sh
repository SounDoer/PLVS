#!/usr/bin/env bash
# Install/remove only in a disposable Ubuntu root created for package verification.
# With a companion package, also prove that stable and Preview install, launch and uninstall
# side by side: install both, launch both, remove the primary, the companion still works.
set -euo pipefail
if [[ $EUID -ne 0 || ! -f /etc/plvs-disposable-package-rig ]]; then
  echo 'Run only as root in a disposable Ubuntu 24.04 rig with /etc/plvs-disposable-package-rig.' >&2
  exit 2
fi
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 && $(dpkg --print-architecture) == amd64 ]]
usage='Usage: verify-linux-deb.sh package.deb output-directory fixture-directory [companion.deb]'
package="$(realpath "${1:?$usage}")"
output="$(realpath -m "${2:?Output directory is required}")"
fixtures="$(realpath "${3:?Fixture directory is required}")"
companion="${4:+$(realpath "$4")}"
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Sets app_name, app_id, bin and cli for a package name.
identity() {
  case "$1" in
    plvs) app_name=PLVS; app_id=com.soundoer.plvs; bin=plvs; cli=plvs-cli ;;
    plvs-preview)
      app_name='PLVS Preview'; app_id=com.soundoer.plvs.preview
      bin=plvs-preview; cli=plvs-preview-cli ;;
    *) echo "Unexpected package: $1" >&2; exit 1 ;;
  esac
}

check_package_metadata() {
  [[ $(dpkg-deb -f "$1" Architecture) == amd64 ]]
  ! dpkg-deb -f "$1" Depends | grep -q ffmpeg
  # Stable and Preview install disjoint paths and must never remove each other.
  [[ -z $(dpkg-deb -f "$1" Conflicts) ]]
}

check_installed() {
  local name=$1
  identity "$name"
  for binary in "$bin" "$cli"; do
    test -x "/usr/bin/$binary"
    dpkg-query -S "/usr/bin/$binary" | grep -q "^$name:"
    if ldd "/usr/bin/$binary" | grep -q 'not found'; then
      echo "Unresolved shared library: $binary" >&2
      exit 1
    fi
  done
  local sidecar_dir="/usr/lib/$name/sidecars"
  for binary in ffmpeg ffprobe; do
    test -x "$sidecar_dir/$binary"
    if ldd "$sidecar_dir/$binary" | grep -q 'not found'; then
      echo "Unresolved sidecar library: $binary" >&2
      exit 1
    fi
    dpkg-query -S "$sidecar_dir/$binary" | grep -q "^$name:"
  done
  if [[ "$name" == plvs ]]; then
    local update_installer="/usr/lib/plvs/plvs-update-installer"
    local update_policy="/usr/share/polkit-1/actions/com.soundoer.plvs.update.policy"
    test -x "$update_installer"
    test -s "$update_policy"
    [[ $(stat -c '%u:%a' "$update_installer") == 0:755 ]]
    grep -q 'com.soundoer.plvs.update' "$update_policy"
    dpkg-query -S "$update_installer" | grep -q '^plvs:'
    dpkg-query -S "$update_policy" | grep -q '^plvs:'
  fi
  local desktop resources
  desktop="$(dpkg-query -L "$name" | grep '\.desktop$')"
  desktop-file-validate "$desktop"
  grep -qx "Name=$app_name" "$desktop"
  grep -qx "Exec=$bin" "$desktop"
  grep -qx "Icon=$bin" "$desktop"
  resources="$(dirname "$(dpkg-query -L "$name" | grep '/plvs-agent.json$')")"
  test -s "$resources/licenses/PLVS-LICENSE.txt"
  test -s "$resources/licenses/THIRD-PARTY-NOTICES.txt"
  test -s "$resources/licenses/DEPENDENCY-INVENTORY.txt"
  python3 - "$resources/plvs-agent.json" "$app_id" "usr/bin/$cli" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
if manifest['identifier'] != sys.argv[2]:
    raise RuntimeError('Packaged discovery manifest has the wrong application identity')
if manifest['cli']['relativePath']['linux'] != sys.argv[3]:
    raise RuntimeError('Packaged discovery manifest has the wrong Linux CLI path')
PY
  # A file overwritten by the other identity would show up as changed here.
  [[ -z $(dpkg --verify "$name") ]]
  dpkg-query -L "$name" > "$output/$name-files.txt"
}

# Launch the installed GUI and CLI as the unprivileged test user and check its private data.
run_desktop() {
  local name=$1 evidence=$2
  identity "$name"
  mkdir -p "$evidence"
  chown plvs-package-test:plvs-package-test "$evidence"
  # The host runner's XDG/Pulse/DBus paths do not exist in the disposable system. Start a real
  # test-user environment before creating its display/session bus, not just before launching PLVS.
  runuser -u plvs-package-test -- env -i \
    HOME=/home/plvs-package-test USER=plvs-package-test LOGNAME=plvs-package-test \
    PATH=/usr/bin:/bin LANG=C.UTF-8 \
    xvfb-run -a dbus-run-session -- python3 "$scripts/verify-linux-desktop.py" \
      "$evidence" "$fixtures" "$name"
  local data="/home/plvs-package-test/.local/share/$app_id"
  test -d "$data"
  test -s "$data/multi-instance/shared/library.sqlite3"
  test -s "$data/multi-instance/workspaces/default/state.json"
}

check_removed() {
  local name=$1
  identity "$name"
  test ! -e "/usr/bin/$bin"
  test ! -e "/usr/bin/$cli"
  while read -r path; do
    [[ -f "$path" ]] || continue
    echo "Removed package $name left $path" >&2
    exit 1
  done < <(grep -v '^/usr/share/doc' "$output/$name-files.txt")
  test ! -e "/usr/lib/$name/sidecars/ffmpeg"
  test ! -e "/usr/lib/$name/sidecars/ffprobe"
}

package_name=$(dpkg-deb -f "$package" Package)
identity "$package_name"
check_package_metadata "$package"
companion_name=
if [[ -n "$companion" ]]; then
  companion_name=$(dpkg-deb -f "$companion" Package)
  identity "$companion_name"
  [[ "$companion_name" != "$package_name" ]]
  check_package_metadata "$companion"
fi
if dpkg-query -W -f='${Status}' plvs plvs-preview 2>/dev/null | grep -q 'install ok installed'; then
  echo 'Refusing to replace an existing PLVS installation.' >&2
  exit 2
fi
if command -v ffmpeg >/dev/null || command -v ffprobe >/dev/null; then
  echo 'The clean package rig must not contain system FFmpeg/FFprobe.' >&2
  exit 2
fi
mkdir -p "$output"
dpkg-deb --info "$package" > "$output/package-info.txt"
dpkg-deb --contents "$package" > "$output/package-files.txt"
sha256sum "$package" > "$output/package.sha256"
cleanup() {
  apt-get purge -y "$package_name" > "$output/uninstall.log" 2>&1
  if [[ -n "$companion_name" ]]; then
    apt-get purge -y "$companion_name" > "$output/companion-uninstall.log" 2>&1
  fi
}
trap cleanup EXIT
id plvs-package-test >/dev/null 2>&1 || useradd -m -s /bin/bash plvs-package-test

if [[ -n "$companion_name" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$companion" \
    > "$output/companion-install.log" 2>&1
  check_installed "$companion_name"
fi
DEBIAN_FRONTEND=noninteractive apt-get install -y "$package" > "$output/install.log" 2>&1
check_installed "$package_name"
run_desktop "$package_name" "$output"
identity "$package_name"
data="/home/plvs-package-test/.local/share/$app_id"
find "$data/multi-instance" -type f \( -name 'state.json' -o -name 'library.sqlite3' \) \
  -exec sha256sum {} + > "$output/settings.sha256"
test -s "$output/settings.sha256"
if [[ -n "$companion_name" ]]; then
  check_installed "$companion_name"
  run_desktop "$companion_name" "$output/companion-alongside"
fi

apt-get purge -y "$package_name" > "$output/uninstall.log" 2>&1
check_removed "$package_name"
if [[ -n "$companion_name" ]]; then
  check_installed "$companion_name"
  run_desktop "$companion_name" "$output/companion-after-removal"
  apt-get purge -y "$companion_name" > "$output/companion-uninstall.log" 2>&1
  check_removed "$companion_name"
fi
trap - EXIT
test ! -e /usr/bin/ffmpeg
test ! -e /usr/bin/ffprobe
sha256sum --check "$output/settings.sha256"
identity "$package_name"
if [[ -n "$companion_name" ]]; then
  echo "PASS: $app_name installation, decoding and removal beside $companion_name"
else
  echo "PASS: $app_name package installation, bundled decoding, and removal"
fi
