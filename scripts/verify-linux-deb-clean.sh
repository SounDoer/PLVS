#!/usr/bin/env bash
# Boot a fresh Ubuntu userspace in private mount/PID namespaces, then discard it.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo on Ubuntu 24.04.' >&2; exit 2; }
package="$(realpath "${1:?Usage: verify-linux-deb-clean.sh package.deb output-directory}")"
output="$(realpath -m "${2:?Output directory is required}")"
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v debootstrap >/dev/null
[[ -f "$package" ]]
mkdir -p "$output"
rig="$(mktemp -d /var/tmp/plvs-deb-rig.XXXXXX)"
cleanup() {
  if [[ -d "$rig/var/tmp/plvs-package-verification" ]]; then
    cp -a "$rig/var/tmp/plvs-package-verification/." "$output/"
  fi
  # mktemp owns this exact directory; the child PID namespace has exited and its mounts are gone.
  [[ "$rig" == /var/tmp/plvs-deb-rig.* ]] && rm -rf -- "$rig"
}
trap cleanup EXIT
debootstrap --variant=minbase noble "$rig" http://archive.ubuntu.com/ubuntu > "$output/bootstrap.log" 2>&1
# mktemp starts at 0700; after pivot_root this becomes /, which normal users must traverse.
chmod 0755 "$rig"
mkdir -p "$rig/opt/plvs-package-tests"
cp "$package" "$rig/tmp/plvs-preview.deb"
cp "$scripts/verify-linux-deb.sh" "$scripts/verify-linux-desktop.py" "$rig/opt/plvs-package-tests/"
unshare --mount --pid --fork bash -s -- "$rig" > "$output/verification.log" 2>&1 <<'RIG'
set -euo pipefail
rig=$1
mount --make-rprivate /
mount --bind "$rig" "$rig"
mount -t proc proc "$rig/proc"
mount --rbind /dev "$rig/dev"
mount --make-rslave "$rig/dev"
cd "$rig"
mkdir .old-root
pivot_root . .old-root
umount -l /.old-root
cat > /etc/apt/sources.list <<'SOURCES'
deb http://archive.ubuntu.com/ubuntu noble main universe
deb http://archive.ubuntu.com/ubuntu noble-updates main universe
deb http://security.ubuntu.com/ubuntu noble-security main universe
SOURCES
printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
chmod +x /usr/sbin/policy-rc.d
touch /etc/plvs-disposable-package-rig
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  python3 xvfb xauth dbus-x11 pulseaudio desktop-file-utils fonts-dejavu-core libgl1-mesa-dri
bash /opt/plvs-package-tests/verify-linux-deb.sh /tmp/plvs-preview.deb /var/tmp/plvs-package-verification
RIG
echo "PASS: fresh Ubuntu installation verification; evidence in $output"
