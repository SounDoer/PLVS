#!/usr/bin/env bash
# Install/remove only in a disposable Ubuntu root created for package verification.
set -euo pipefail
if [[ $EUID -ne 0 || ! -f /etc/plvs-disposable-package-rig ]]; then
  echo 'Run only as root in a disposable Ubuntu 24.04 rig with /etc/plvs-disposable-package-rig.' >&2
  exit 2
fi
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 && $(dpkg --print-architecture) == amd64 ]]
package="$(realpath "${1:?Usage: verify-linux-deb.sh package.deb output-directory fixture-directory}")"
output="$(realpath -m "${2:?Output directory is required}")"
fixtures="$(realpath "${3:?Fixture directory is required}")"
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_name=$(dpkg-deb -f "$package" Package)
case "$package_name" in
  plvs) app_name=PLVS; app_id=com.soundoer.plvs; other_package=plvs-preview ;;
  plvs-preview) app_name='PLVS Preview'; app_id=com.soundoer.plvs.preview; other_package=plvs ;;
  *) echo "Unexpected package: $package_name" >&2; exit 1 ;;
esac
[[ $(dpkg-deb -f "$package" Architecture) == amd64 ]]
! dpkg-deb -f "$package" Depends | grep -q ffmpeg
dpkg-deb -f "$package" Conflicts | grep -qx "$other_package"
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
cleanup() { apt-get purge -y "$package_name" > "$output/uninstall.log" 2>&1; }
trap cleanup EXIT
DEBIAN_FRONTEND=noninteractive apt-get install -y "$package" > "$output/install.log" 2>&1
for binary in plvs plvs-cli; do
  test -x "/usr/bin/$binary"
  if ldd "/usr/bin/$binary" | grep -q 'not found'; then
    echo "Unresolved shared library: $binary" >&2
    exit 1
  fi
done
sidecar_dir="/usr/lib/$package_name/sidecars"
for binary in ffmpeg ffprobe; do
  test -x "$sidecar_dir/$binary"
  if ldd "$sidecar_dir/$binary" | grep -q 'not found'; then
    echo "Unresolved sidecar library: $binary" >&2
    exit 1
  fi
  dpkg-query -S "$sidecar_dir/$binary" | grep -q "^$package_name:"
done
if [[ "$package_name" == plvs ]]; then
  update_installer="/usr/lib/plvs/plvs-update-installer"
  update_policy="/usr/share/polkit-1/actions/com.soundoer.plvs.update.policy"
  test -x "$update_installer"
  test -s "$update_policy"
  [[ $(stat -c '%u:%a' "$update_installer") == 0:755 ]]
  grep -q 'com.soundoer.plvs.update' "$update_policy"
  dpkg-query -S "$update_installer" | grep -q '^plvs:'
  dpkg-query -S "$update_policy" | grep -q '^plvs:'
fi
desktop="$(dpkg-query -L "$package_name" | grep '\.desktop$')"
desktop-file-validate "$desktop"
grep -q "Name=$app_name" "$desktop"
grep -q 'Exec=plvs' "$desktop"
resources="$(dirname "$(dpkg-query -L "$package_name" | grep '/plvs-agent.json$')")"
test -s "$resources/licenses/PLVS-LICENSE.txt"
test -s "$resources/licenses/THIRD-PARTY-NOTICES.txt"
test -s "$resources/licenses/DEPENDENCY-INVENTORY.txt"
python3 - "$resources/plvs-agent.json" "$app_id" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
if manifest['identifier'] != sys.argv[2]:
    raise RuntimeError('Packaged discovery manifest has the wrong application identity')
if manifest['cli']['relativePath']['linux'] != 'usr/bin/plvs-cli':
    raise RuntimeError('Packaged discovery manifest has the wrong Linux CLI path')
PY
id plvs-package-test >/dev/null 2>&1 || useradd -m -s /bin/bash plvs-package-test
chown plvs-package-test:plvs-package-test "$output"
# The host runner's XDG/Pulse/DBus paths do not exist in the disposable system. Start a real
# test-user environment before creating its display/session bus, not just before launching PLVS.
runuser -u plvs-package-test -- env -i \
  HOME=/home/plvs-package-test USER=plvs-package-test LOGNAME=plvs-package-test \
  PATH=/usr/bin:/bin LANG=C.UTF-8 \
  xvfb-run -a dbus-run-session -- python3 "$scripts/verify-linux-desktop.py" \
    "$output" "$fixtures" "$package_name"
data="/home/plvs-package-test/.local/share/$app_id"
test -d "$data"
test -s "$data/multi-instance/shared/library.sqlite3"
test -s "$data/multi-instance/workspaces/default/state.json"
find "$data/multi-instance" -type f \( -name 'state.json' -o -name 'library.sqlite3' \) \
  -exec sha256sum {} + > "$output/settings.sha256"
test -s "$output/settings.sha256"
cleanup
trap - EXIT
test ! -e /usr/bin/plvs
test ! -e /usr/bin/plvs-cli
test ! -e "$desktop"
test ! -e "$resources/plvs-agent.json"
test ! -e "$sidecar_dir/ffmpeg"
test ! -e "$sidecar_dir/ffprobe"
if [[ "$package_name" == plvs ]]; then
  test ! -e "$update_installer"
  test ! -e "$update_policy"
fi
test ! -e /usr/bin/ffmpeg
test ! -e /usr/bin/ffprobe
sha256sum --check "$output/settings.sha256"
echo "PASS: $app_name package installation, bundled decoding, and removal"
