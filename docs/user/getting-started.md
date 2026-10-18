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
| Ubuntu 24.04 (x86_64) | `PLVS_<version>_amd64.deb`         | Debian package               |

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

## Linux

The Linux package targets Ubuntu 24.04 x86_64. Install it with APT so it resolves the required
system libraries:

```sh
sudo apt install ./PLVS_<version>_amd64.deb
```

Launch **PLVS** from the application menu, or run `plvs`. `plvs-cli doctor --json` checks the
installed application and decoders. Audio capture requires a running PulseAudio server or PipeWire's
PulseAudio compatibility service. PLVS installs its own FFmpeg/FFprobe copies under
`/usr/lib/plvs/sidecars`; it neither needs nor replaces a system FFmpeg installation.

On Linux, PLVS can tell you that a new version is available, but it does not download or install
it. To update, download the new `.deb` from GitHub Releases and install it the same way; your
settings are kept. Remove PLVS with
`sudo apt remove plvs`. Removing the package preserves your user settings.

Dock and per-application capture are not available on Linux. See
[Signal Source](signal-source.md) for the Linux capture scope.

### Linux Preview

Preview packages are test builds of unreleased commits, published as GitHub **Pre-releases** with
the source commit recorded in their notes. Install a supplied Preview `.deb` the same way:

```sh
sudo apt install --reinstall ./plvs-preview.deb
```

Use the actual filename of the supplied package, then launch **PLVS Preview**. Preview keeps its own
settings and never checks for updates. Use `--reinstall` when switching Preview commits: their
packages can share the same base version. Remove Preview with `sudo apt remove plvs-preview`.
Preview and the stable package share executable names, so only one of them can be installed at a
time.

## First launch

A new installation opens with a starter workspace and a starter Loudness Profile. The workspace is
saved as the **Default** Preset, while the Profile is named **PLVS Default**. The Preset lets you
return to the initial layout after rearranging it. **PLVS Default** is a general starting point, not
a delivery standard: True Peak above −1 dBTP fails, while Momentary above −6 LUFS, Short-term above
−12 LUFS, Integrated outside −30 to −16 LUFS, or Loudness Range above 18 LU warns. Both are ordinary
saved items that you can edit, rename, or delete. Once deleted, either one stays deleted; only
**Reset PLVS to Default** brings them back. PLVS never starts capturing audio on its own: pick a
signal source (see [Signal Source](signal-source.md)) and press Start when you're ready to monitor.

On a fresh first launch, **Update Preferences** offers automatic checking and automatic downloading.
The prompt links to the privacy policy.
Checking starts selected; downloading starts off. No automatic request is made before you save a
choice. **Skip** turns both off. Existing users retain checking on and downloading off without a
first-launch prompt. These preferences can be changed in Settings.

When checking is enabled, PLVS checks at startup and every 12 hours. Manual checks remain available
with automatic checking off. The footer's **Update Available · View Release Notes** link opens the
shared update details; in Dock, a dot on the toolbar arrow marks an update and the toolbar names it.

With automatic downloading enabled, PLVS verifies and keeps an update locally without interrupting
your work. On a later fresh launch, it offers **Update and Restart** or **Skip This Time**. Skipping
keeps the downloaded package. Installation always needs confirmation; there is no countdown. An
already active workbench defers the startup offer. Download completion does not open a dialog in
your current working session. Windows Portable copies use **Download Manually** on the release page;
they never run the installed-app updater. Linux packages are also updated manually. Preview builds
do not check for updates.
