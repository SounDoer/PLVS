# Getting Started

Install PLVS and get through the first launch.

## Packages

Download the package for your platform from
[GitHub Releases](https://github.com/SounDoer/PLVS/releases).

| Platform              | Package                            | Notes                                        |
| --------------------- | ---------------------------------- | -------------------------------------------- |
| Windows 10/11 (x64)   | `PLVS_<version>_x64-setup.exe`     | Installer                                    |
| Windows 10/11 (x64)   | `PLVS-v<version>-x64-portable.zip` | Portable, no installation                    |
| macOS (Apple Silicon) | `PLVS-v<version>-aarch64.dmg`      | Requires macOS 14.2 or later                 |

## Windows

Run the installer, or extract the portable ZIP and launch `plvs.exe`. Keep all extracted portable
files together. Both builds use the WebView2 runtime that ships with Windows.

PLVS isn't code-signed yet, so Windows SmartScreen may warn on first run — choose **More info**, then
**Run anyway**.

## macOS

Open the DMG and drag PLVS into Applications. The build isn't notarized, so Gatekeeper blocks the
first launch. Remove the quarantine attribute once:

```bash
xattr -cr /Applications/PLVS.app
```

Alternatively, move PLVS.app to the Trash and immediately move it back.

## First launch

A new installation opens with a starter workspace and a starter Loudness Profile. PLVS never starts
capturing audio on its own: pick a signal source (see [Signal Source](signal-source.md)) and press
Start when you're ready to monitor.

PLVS checks for updates automatically and asks before installing one.
