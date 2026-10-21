# Linux update acceptance: first runs (2026-10-22)

Context: adding a Linux producer to packaged update acceptance (ADR 0038). Before the maintainer's
Ubuntu runner was set up, the complete run was exercised in the local WSL Ubuntu 24.04 distribution
`PLVS-Ubuntu-24.04`. Polkit was installed there, `setup.sh install` was run for its `plvs` account,
and acceptance ran headless with `DISPLAY`, `WAYLAND_DISPLAY` and the session bus unset.

## Findings

Two product defects meant that 0.23.0 could not complete any in-app Linux installation:

1. The update worker runs from a copy in the update cache (`plvs-update-worker`), but
   `linux_update::availability()` compared the worker's own `current_exe()` with `/usr/bin/plvs`.
   Every attempt therefore failed with "Install the stable PLVS .deb with APT to enable automatic
   updates" before `pkexec` ran. Fix: judge the ticket's installed target.
2. The privileged installer ran `apt-get --no-download ... install /var/tmp/.../plvs.deb`. apt 2.8.3
   (Ubuntu 24.04) rejects every local deb under `--no-download`: "E: Internal Error, Pathname to
   install is not absolute 'plvs_X_amd64.deb'". The same command without that flag works. Fix:
   give APT an empty source list and source-parts directory. That keeps it offline: an upgrade
   succeeds, and a deb whose dependency is not installed fails with "held broken packages" instead
   of downloading it (checked with a dummy package depending on `sl`).

Users of 0.23.0 need one manual `.deb` installation to reach a release with both fixes.

## WSL results

- Before the fixes (`6f875fb9`): every scenario up to the final install passed, and restore removed
  the package. The installer retry failed with defect 1.
- With both fixes (prototype `268475fc`): `update:acceptance:verify` reported `complete`, with only
  `polkit-prompt-and-cancellation` left as a manual gap. Afterwards `plvs` was absent again.
- Package tool with a pre-installed dummy `plvs` 0.0.1: the tool installed 0.0.2, a second install
  kept the original record, restore brought back the exact 0.0.1 files through `dpkg-repack`, a
  repeated restore was a no-op, and a relative path was rejected.

WSL-only obstacle: WSLg leaves `/tmp/.X11-unix` unusable for a new X server, so the harness's own
private Xvfb could not start there. The WSL runs used `Xvfb :77 -nolisten unix` with `DISPLAY` set
in advance. The real runner has no WSLg, and release-package smoke already starts the private
Xvfb on it.
