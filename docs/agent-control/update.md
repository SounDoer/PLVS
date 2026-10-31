# Update Control

Update Control reads the update state the About page and the status entry show, and runs the About
page's Check for Updates. Installing an update, and the Auto Check / Auto Download preferences,
remain user actions.

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Inspection

`update inspect` reports whether this workbench updates itself (`enabled`), the check `status`, the
latest known version, whether a download is running and its progress from 0 to 1, the version that
is downloaded and ready to install, and the install status. `status` is `managed` in a workbench
whose updates another workbench owns, `disabled` when the running identity does not update itself,
and otherwise the last check's outcome: `idle`, `checking`, `ok` or `unavailable`. Release notes and
package locations are not reported.

## Check

`update check` runs one manual check through the same path as Check for Updates. It never downloads
or installs: with Auto Download on, staging still waits for the scheduled automatic check, as it does
for the button. A found update shows in the status entry and in `ui inspect`'s `status` list; the
Update details dialog opens only when the user asks for it. Where `enabled` is false the request fails
with `updateUnavailable`.

The check leaves the global revision unchanged but requires `--expected-revision`.
