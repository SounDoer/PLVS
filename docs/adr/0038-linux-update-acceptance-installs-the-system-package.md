# ADR 0038: Linux update acceptance installs the system package

Date: 2026-10-22

## Context

Packaged update acceptance proves the installed updater on real packages. On Windows and macOS it
builds two versions under an isolated test identity and installs them into a user-writable
directory, so a run needs no administrator rights and never touches an installed PLVS.

Linux cannot be isolated that way. [ADR 0034](0034-linux-deb-updates-use-a-privileged-installer.md)
enables in-app installation only for an APT-owned stable `/usr/bin/plvs`. Its root-owned helper
`/usr/lib/plvs/plvs-update-installer` and the Polkit action `com.soundoer.plvs.update` are bound to
those fixed paths and to the package name `plvs`, and that binding is the security boundary. A copy
somewhere else, or under another package name, reports updates as unavailable. Relaxing the paths
for testing would remove the property being tested.

Installing a system package needs root three times: the older version, the update itself, and
removal afterwards. The product action covers only the update. The runner is unattended, so nobody
can answer a password prompt.

## Decision

The Linux acceptance debs keep the stable `plvs` package name, product name and paths. They change
only the identity, version, updater key and feed, as on the other platforms. The privileged helper
embeds the same ephemeral key. The run installs them system-wide on the dedicated Ubuntu runner
machine and leaves the machine as it found it.

The maintainer authorizes the runner account once, with
`scripts/update-acceptance-linux/setup.sh`:

- a root-owned package tool, `/usr/local/libexec/plvs-update-acceptance-package`, reachable only
  through `pkexec` and its own Polkit action `com.soundoer.plvs.update-acceptance`. It installs a
  `plvs` amd64 deb offline from a root-owned copy, or restores the state it recorded before its
  first install of a series: no `plvs`, or a `dpkg-repack` copy of the installed version.
- one Polkit rule that answers yes to exactly that action and `com.soundoer.plvs.update`, for that
  one account, without a password.

The shipped policy, its `auth_admin` default and the product code stay unchanged; the product gains
no bypass. The update itself goes through the product's own `pkexec` helper and APT. Cleanup
restores the recorded state and fails the run if `dpkg-query` disagrees. A run refuses to start
while any PLVS runs. The Polkit password prompt and its cancellation remain a manual check.

## Consequences

Linux joins the update acceptance gate with the same scenarios as the other platforms, plus a
check that the product installer upgraded the APT package.

The runner account becomes root-equivalent on that machine. It builds the debs it may install, and
an installed acceptance helper trusts a key that account holds. That is why this lives only on a
dedicated test machine, why the rule names one account, and why `setup.sh remove` undoes it. The
risk is accepted for that machine only. It is not a pattern for any machine used for anything else.

A failed run that cannot restore leaves the record in `/var/lib/plvs-update-acceptance`. The next
run, or `plvs-update-acceptance-package restore`, completes the restore. A user's own PLVS
installation is never the source of the record unless the machine had it before the first run.
