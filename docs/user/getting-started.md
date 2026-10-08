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

## First launch

A new installation opens with a starter workspace and a starter Loudness Profile, both named
**Default**. The workspace is saved as the **Default** Preset, so you can return to it after
rearranging the layout. The **Default** Loudness Profile is a general starting point, not a delivery
standard: Integrated outside −27 to −18 LUFS or True Peak above −1 dBTP fails, while Short-term Max
above −16 LUFS, Momentary Max above −12 LUFS, or a Loudness Range outside 5 to 20 LU warns. Both are
ordinary saved items that you can edit, rename, or delete. Once deleted, either one stays
deleted; only **Reset PLVS to Default** brings them back. PLVS never starts capturing audio on its
own: pick a signal source (see [Signal Source](signal-source.md)) and press
Start when you're ready to monitor.

PLVS checks for updates automatically and asks before installing one. The confirmation dialog
shows a progress bar while that download runs.
