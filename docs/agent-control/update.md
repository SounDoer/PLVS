# Update Control

Update Control reads the update state the About page and the status entry show, runs the About
page's Check for Updates, and installs a named update as About's Install does. The Auto Check and
Auto Download preferences belong to [Settings Control](settings.md#updates-and-crash-reports).

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Inspection

`update inspect` reports whether this workbench updates itself (`enabled`), the check `status`, the
latest known version, whether a download is running and its progress from 0 to 1, the version that
is downloaded and ready to install, whether this copy can install updates itself
(`installationSupported`), and the install status. `status` is `managed` in a workbench whose
updates another workbench owns, `disabled` when the running identity does not update itself, and
otherwise the last check's outcome: `idle`, `checking`, `ok` or `unavailable`. Release notes and
package locations are not reported.

## Check

`update check` runs one manual check through the same path as Check for Updates. With Auto Download
on, a newer version found by the check is downloaded and staged in the background, as it is for the
button; with it off, nothing is downloaded. A found update shows in the status entry and in `ui
inspect`'s `status` list; the Update details dialog opens only when the user asks for it. Where
`enabled` is false the request fails with `updateUnavailable`.

The check leaves the global revision unchanged but requires `--expected-revision`.

## Install

`update install --version <version>` installs the newest known update through About's Install: it
opens the update details for that version and confirms them, so the dialog shows exactly what the
user would see. `--version` must equal the version `update inspect` reports as `latestVersion`; a
different one fails with `updateVersionMismatch` and reports `availableVersion`, so an agent never
installs a newer candidate that replaced the one it inspected. Without a known update the request
fails with `updateNotFound`; run `update check` first.

It is refused with `updateUnavailable` where `enabled` is false, `busy` while an install is already
running, `updateInstallationUnsupported` in a copy that cannot install itself (a Portable copy;
the result carries `releaseUrl`), and `editorActive` while a blocking editor is open here.

A successful result is `{ revision, accepted: true, version }`, delivered before installation
starts. Installation then follows the dialog's path: an unstaged package is downloaded and
verified, every workbench stops capture and saves, and PLVS installs and relaunches the saved
workbench set. A refusal after the response, such as an editor open in another workbench, leaves
PLVS running with the details dialog showing the error and `update inspect` reporting
`installStatus: install-error`. After a relaunch, rediscover the app with `instances`.

The command requires `--expected-revision` but leaves the revision unchanged. It can only be
exercised for real in an identity that updates itself; the dev app reports `status: disabled`.
