# ADR 0034: Linux deb updates use a privileged installer

Date: 2026-10-19

## Context

Stable Ubuntu packages already publish a version-bound signed deb in the common update manifest,
but installing into `/usr` needs administrator authority. Tauri's generic Linux updater verifies a
package in the user's temporary directory and then runs `dpkg -i` through `pkexec`, with password
dialog and `sudo` fallbacks. That gives a privileged process a user-writable path after verification,
can leave dependencies unresolved, and makes the application responsible for password handling.

Windows and macOS already share PLVS's download, signature, cache, multi-workbench save barrier,
attempt recovery and relaunch pipeline. Linux should share that product behavior without pretending
that a distribution package has the same installation mechanism.

## Decision

The stable deb installs a minimal root-owned helper at `/usr/lib/plvs/plvs-update-installer` and a
Polkit action restricted to that exact executable. Preview installs neither and remains outside the
updater. PLVS enables installation only for an APT-owned stable `/usr/bin/plvs` whose package and
helper ownership, permissions, architecture and version match the running build. Missing support
keeps update discovery and the manual release path available.

After the ordinary worker has reverified the cached update and closed the workbench set, it invokes
the installed helper with `/usr/bin/pkexec`. There is no password collection or `sudo` fallback in
PLVS. Authentication cancellation is a recoverable update result, not an application failure.

The privileged helper assumes that both its JSON ticket and the cached deb are hostile. It reads
the package bytes once, checks their SHA-256 and version-bound minisign signature using the same key
as the application, and requires a target version newer than the helper and currently installed
package. It writes those authenticated bytes itself into a mode-0600 file inside a root-only
temporary directory. Only that copy is inspected and installed. The deb must be package `plvs`,
architecture `amd64`, and the signed target version.

APT runs with `--no-download`, `--no-remove`, `--only-upgrade` and `--reinstall`; installation is
therefore offline and cannot solve a dependency problem by changing unrelated packages. Success is
accepted only when `dpkg-query` reports `install ok installed` and the expected version. On cancel,
missing Polkit, validation failure or APT failure, PLVS relaunches and retains the verified cache.

## Consequences

Linux reaches the same user-level update flow as installed Windows and macOS while preserving the
distribution package database and Ubuntu's authorization UI. Privileged code is isolated from the
GUI, network and application state, and the verified bytes cross the privilege boundary without a
user-writable-path time-of-check/time-of-use gap.

The first release containing the helper cannot upgrade an older Linux installation automatically;
users install that deb manually once. A system missing Polkit or required dependencies uses the
documented manual APT path. Supporting other distributions, package formats or architectures needs
a separate installer and acceptance contract rather than relaxing this one.
