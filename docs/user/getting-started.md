# Getting Started

Install PLVS and get through the first launch.

## Packages

Download the package for your platform from
[GitHub Releases](https://github.com/SounDoer/PLVS/releases).

| Platform              | Package                            | Notes                        |
| --------------------- | ---------------------------------- | ---------------------------- |
| Windows 10/11 (x64)   | `PLVS_<version>_x64-setup.exe`     | Installer                    |
| Windows 10/11 (x64)   | `PLVS-v<version>-x64-portable.zip` | Portable, no installation    |
| macOS (Apple Silicon) | `PLVS-v<version>-aarch64.dmg`      | Requires macOS 14.2 or later |

## Windows

Run the installer, or extract the portable ZIP and launch `plvs.exe`. Keep all extracted portable
files together. Both builds use the WebView2 runtime that ships with Windows.

PLVS isn't code-signed yet, so Windows SmartScreen may warn on first run — choose **More info**, then
**Run anyway**.

## macOS

Open the DMG and drag PLVS into Applications. Official macOS builds are signed with the PLVS
Developer ID and notarized by Apple, so Gatekeeper can verify them normally. If Gatekeeper reports
that an official download is damaged or cannot be verified, delete it and download the DMG again
from the PLVS GitHub Releases page instead of bypassing the warning.

## Experimental Linux Preview

Linux Preview packages target Ubuntu 24.04 x86_64. Published test builds are marked as GitHub
**Pre-releases**, with the source commit recorded in their notes; they are separate from official
stable releases. Install a supplied `.deb` with APT so it resolves the required
libraries and the Ubuntu FFmpeg package:

```sh
sudo apt install --reinstall ./plvs-preview.deb
```

Use the actual filename of the supplied package. Launch **PLVS Preview** from the application menu,
or run `plvs`. `plvs-cli doctor --json` checks the installed application and decoders. Audio capture
requires a running PulseAudio server or PipeWire's PulseAudio compatibility service.

Preview keeps its own settings and does not automatically update. Use `--reinstall` when switching
Preview commits: their packages can share the same base version. Remove Preview with
`sudo apt remove plvs-preview`. Removing the package preserves
your user settings and the system FFmpeg package. The initial Preview shares executable names with
the future stable Linux package, so the two packages cannot be installed together.

Native desktop and hardware acceptance is still pending. Per-application capture, live Agent
Control, screenshots, and recording are not yet supported on Linux. See
[Signal Source](signal-source.md) for the experimental capture scope.

## First launch

A new installation opens with a starter workspace and a starter Loudness Profile, both named
**Default**. The workspace is saved as the **Default** Preset, so you can return to it after
rearranging the layout. The **Default** Loudness Profile is a general starting point, not a delivery
standard: True Peak above −1 dBTP fails, while Integrated outside −30 to −16 LUFS, Short-term Max
above −12 LUFS, Momentary Max above −9 LUFS, or a Loudness Range outside 6 to 18 LU warns. Both are
ordinary saved items that you can edit, rename, or delete. Once deleted, either one stays
deleted; only **Reset PLVS to Default** brings them back. PLVS never starts capturing audio on its
own: pick a signal source (see [Signal Source](signal-source.md)) and press
Start when you're ready to monitor.

Official PLVS builds check for updates automatically and ask before installing one. The confirmation dialog
shows a progress bar while that download runs.
