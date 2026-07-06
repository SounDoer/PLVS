# PLVS CLI PATH Integration - Design

## Problem

`plvs-cli.exe` is installed next to `plvs.exe`, `ffmpeg.exe`, and `ffprobe.exe`, but a fresh terminal cannot discover it as `plvs-cli` unless the caller already knows the full install path. That is acceptable for local verification, but weak for unfamiliar agents that need to discover PLVS on a user's machine.

## Goals

- Make `plvs-cli` discoverable from a normal Windows terminal after installation.
- Add only the PLVS install directory to the current user's `PATH`.
- Keep the installer current-user scoped; do not require Administrator access.
- Make the install hook idempotent.
- Remove only PLVS' own install directory from the user `PATH` on uninstall.
- Verify the behavior in the existing Windows installer smoke script.

## Non-Goals

- Do not edit the system-wide `PATH`.
- Do not add PATH integration on macOS in this slice.
- Do not create shims in unrelated directories.
- Do not add a user-facing installer option yet.

## Behavior

After installing PLVS, a new terminal should be able to run:

```powershell
plvs-cli doctor --json
plvs-cli analyze "C:\path\file.wav" --json
```

The installer writes the install directory, not the executable path, to the current user's `Path` environment variable.

On uninstall, the installer removes the exact PLVS install directory entry. Other user `PATH` entries must be preserved.

## Implementation

Use Tauri's NSIS `installerHooks` support rather than replacing the full NSIS template. The hook runs:

- `NSIS_HOOK_POSTINSTALL`: add `$INSTDIR` to the user `Path`.
- `NSIS_HOOK_POSTUNINSTALL`: remove `$INSTDIR` from the user `Path`.

The hook uses PowerShell's `[Environment]` API for path manipulation because it handles user environment variables directly and avoids fragile NSIS string parsing. NSIS broadcasts `WM_SETTINGCHANGE` after changes so newly launched processes can observe the updated environment.

## Verification

The Windows installer smoke test should:

- install to a temporary directory;
- assert `plvs-cli.exe` exists;
- assert the temporary install directory was added to user `Path`;
- run `plvs-cli doctor --json` by command name after composing a process PATH from the registry value;
- uninstall;
- assert the temporary install directory was removed from user `Path`;
- restore the original user `Path` at the end of the test.
