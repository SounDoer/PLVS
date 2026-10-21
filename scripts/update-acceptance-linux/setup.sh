#!/bin/bash
# One-time authorization for unattended Linux update acceptance (ADR 0038, CONTRIBUTING
# "Linux update acceptance runner").
#
#   sudo bash scripts/update-acceptance-linux/setup.sh install   as the runner account, with sudo
#   bash scripts/update-acceptance-linux/setup.sh verify         as the runner account, no sudo
#   sudo bash scripts/update-acceptance-linux/setup.sh remove    undo install
#
# install writes exactly three root-owned files and changes nothing else:
#   /usr/local/libexec/plvs-update-acceptance-package             package install/restore tool
#   /usr/share/polkit-1/actions/com.soundoer.plvs.update-acceptance.policy  its Polkit action
#   /etc/polkit-1/rules.d/49-plvs-update-acceptance.rules         lets one account run the PLVS
#     update installer and that tool without a password; every other request is unchanged
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOL=/usr/local/libexec/plvs-update-acceptance-package
POLICY=/usr/share/polkit-1/actions/com.soundoer.plvs.update-acceptance.policy
RULE=/etc/polkit-1/rules.d/49-plvs-update-acceptance.rules
STATE_DIR=/var/lib/plvs-update-acceptance

fail() {
  echo "$*" >&2
  exit 1
}

rule_for() {
  cat <<EOF
// PLVS update acceptance (ADR 0038). Lets the runner account "$1" run the PLVS update installer
// and the acceptance package tool without a password prompt. Remove with:
//   sudo bash scripts/update-acceptance-linux/setup.sh remove
polkit.addRule(function (action, subject) {
  if (
    (action.id == "com.soundoer.plvs.update" ||
      action.id == "com.soundoer.plvs.update-acceptance") &&
    subject.user == "$1"
  ) {
    return polkit.Result.YES;
  }
});
EOF
}

install_files() {
  [[ $EUID -eq 0 ]] || fail "Run install with sudo."
  local user=${SUDO_USER:-}
  [[ -n $user && $user != root ]] || fail "Run install with sudo from the runner's own account."
  [[ $user =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "Unexpected account name: $user"
  [[ -d /etc/polkit-1/rules.d ]] || fail "Polkit rules are unavailable. Install polkitd first."
  install -D -o root -g root -m 0755 "$HERE/plvs-update-acceptance-package" "$TOOL"
  install -D -o root -g root -m 0644 "$HERE/com.soundoer.plvs.update-acceptance.policy" "$POLICY"
  rule_for "$user" >"$RULE.tmp"
  chown root:root "$RULE.tmp"
  chmod 0644 "$RULE.tmp"
  mv "$RULE.tmp" "$RULE"
  echo "Installed for account '$user'. Now run, without sudo:"
  echo "  bash scripts/update-acceptance-linux/setup.sh verify"
}

verify() {
  [[ $EUID -ne 0 ]] || fail "Run verify as the runner account, without sudo."
  local ok=true
  for file in "$TOOL" "$POLICY" "$RULE"; do
    if [[ $(stat -c %U "$file" 2>/dev/null) != root ]]; then
      echo "missing or not root-owned: $file"
      ok=false
    fi
  done
  if pkcheck --action-id com.soundoer.plvs.update-acceptance --process $$ >/dev/null 2>&1; then
    echo "ok: this account may change the PLVS test package without a password"
  else
    echo "not authorized: com.soundoer.plvs.update-acceptance"
    ok=false
  fi
  if pkaction --action-id com.soundoer.plvs.update >/dev/null 2>&1; then
    if pkcheck --action-id com.soundoer.plvs.update --process $$ >/dev/null 2>&1; then
      echo "ok: this account may run the installed PLVS update installer without a password"
    else
      echo "not authorized: com.soundoer.plvs.update"
      ok=false
    fi
  else
    echo "note: PLVS is not installed, so its update action is checked by each acceptance run"
  fi
  if dpkg-query --show --showformat='${Status}' plvs 2>/dev/null | grep -q '^install ok installed$' &&
    ! command -v dpkg-repack >/dev/null; then
    echo "missing: dpkg-repack (sudo apt install dpkg-repack), needed to restore the installed PLVS"
    ok=false
  fi
  for tool in /usr/bin/Xvfb /usr/bin/dbus-daemon; do
    [[ -x $tool ]] || {
      echo "missing: $tool (sudo apt install xvfb dbus)"
      ok=false
    }
  done
  if [[ -d $STATE_DIR ]]; then
    echo "note: $STATE_DIR exists, so an earlier run has not restored the original PLVS yet;"
    echo "      the next run restores it, or: pkexec $TOOL restore"
  fi
  $ok && echo "Linux update acceptance is ready." || fail "Linux update acceptance is not ready."
}

remove_files() {
  [[ $EUID -eq 0 ]] || fail "Run remove with sudo."
  if [[ -d $STATE_DIR ]]; then
    fail "An acceptance run still has the original PLVS to restore. Run 'sudo $TOOL restore' first."
  fi
  rm -f "$RULE" "$POLICY" "$TOOL"
  echo "Removed the PLVS update acceptance authorization."
}

case "${1:-}" in
  install) install_files ;;
  verify) verify ;;
  remove) remove_files ;;
  *) fail "Usage: setup.sh install|verify|remove" ;;
esac
